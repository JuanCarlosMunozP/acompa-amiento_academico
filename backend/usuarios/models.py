from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.core.exceptions import ValidationError
from django.core.validators import MaxLengthValidator
from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone

from .roles import ROL_POR_DEFECTO, Rol


class UsuarioManager(BaseUserManager):
    use_in_migrations = True

    def _crear(self, email, password, **extra):
        if not email:
            raise ValueError("El correo es obligatorio.")
        user = self.model(email=self.normalize_email(email), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra):
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._crear(email, password, **extra)

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("rol", Rol.SUPERADMIN)
        extra.setdefault("email_verificado", True)
        return self._crear(email, password, **extra)


class Usuario(AbstractBaseUser, PermissionsMixin):
    """Usuario de la plataforma. Se autentica con el correo institucional."""

    email = models.EmailField("correo institucional", unique=True)
    nombres = models.CharField(max_length=150)
    apellidos = models.CharField(max_length=150)
    rol = models.CharField(max_length=20, choices=Rol.choices, default=ROL_POR_DEFECTO)
    email_verificado = models.BooleanField(default=False)
    is_active = models.BooleanField("activo", default=True)
    is_staff = models.BooleanField("acceso al admin", default=False)
    fecha_registro = models.DateTimeField(default=timezone.now)
    intentos_fallidos = models.PositiveSmallIntegerField(default=0)
    bloqueado_hasta = models.DateTimeField(null=True, blank=True)
    # Autenticación multifactor (TOTP). El secreto se guarda cifrado (ver usuarios/mfa.py);
    # mientras `mfa_activo` sea falso, un secreto presente es una configuración sin confirmar.
    mfa_secreto = models.CharField(max_length=255, blank=True, default="")
    mfa_activo = models.BooleanField("MFA activo", default=False)
    # Último paso de 30 s aceptado: impide reutilizar un código ya consumido (anti-replay).
    mfa_ultimo_paso = models.BigIntegerField(default=0)

    objects = UsuarioManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["nombres", "apellidos"]

    class Meta:
        verbose_name = "usuario"
        verbose_name_plural = "usuarios"
        ordering = ["apellidos", "nombres"]
        constraints = [
            # El correo es único sin distinguir mayúsculas.
            models.UniqueConstraint(Lower("email"), name="usuario_email_ci_unico"),
            # El rol siempre pertenece al catálogo, también a nivel de base de datos.
            models.CheckConstraint(
                condition=models.Q(rol__in=Rol.values), name="usuario_rol_valido"
            ),
        ]

    def __str__(self):
        return self.email

    def esta_bloqueado(self):
        return self.bloqueado_hasta is not None and self.bloqueado_hasta > timezone.now()

    def minutos_de_bloqueo_restantes(self):
        if not self.esta_bloqueado():
            return 0
        return max(1, int((self.bloqueado_hasta - timezone.now()).total_seconds() // 60) + 1)

    def registrar_fallo(self):
        """Suma un intento fallido; al llegar al máximo bloquea la cuenta."""
        # Un bloqueo ya vencido reinicia el conteo.
        if self.bloqueado_hasta is not None and not self.esta_bloqueado():
            self.intentos_fallidos = 0
            self.bloqueado_hasta = None
        self.intentos_fallidos += 1
        if self.intentos_fallidos >= settings.LOGIN_MAX_INTENTOS:
            self.bloqueado_hasta = timezone.now() + timedelta(
                minutes=settings.LOGIN_BLOQUEO_MINUTOS
            )
        self.save(update_fields=["intentos_fallidos", "bloqueado_hasta"])

    def registrar_exito(self):
        if self.intentos_fallidos or self.bloqueado_hasta:
            self.intentos_fallidos = 0
            self.bloqueado_hasta = None
            self.save(update_fields=["intentos_fallidos", "bloqueado_hasta"])

    @property
    def nombre_completo(self):
        return f"{self.nombres} {self.apellidos}".strip()


class CodigoRecuperacionMFA(models.Model):
    """Código de un solo uso para entrar si se pierde el dispositivo con el autenticador.

    Solo se guarda su huella (HMAC): el código en claro se muestra una única vez.
    """

    usuario = models.ForeignKey(
        Usuario, on_delete=models.CASCADE, related_name="codigos_recuperacion_mfa"
    )
    huella = models.CharField(max_length=64, db_index=True)
    usado_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "código de recuperación MFA"
        verbose_name_plural = "códigos de recuperación MFA"

    def __str__(self):
        return f"Código de recuperación de {self.usuario}"


class CambioRol(models.Model):
    """Historial de asignaciones de rol (quién cambió qué y cuándo)."""

    usuario = models.ForeignKey(Usuario, on_delete=models.CASCADE, related_name="cambios_de_rol")
    rol_anterior = models.CharField(max_length=20, choices=Rol.choices)
    rol_nuevo = models.CharField(max_length=20, choices=Rol.choices)
    cambiado_por = models.ForeignKey(
        Usuario, null=True, on_delete=models.SET_NULL, related_name="roles_asignados"
    )
    fecha = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = "cambio de rol"
        verbose_name_plural = "cambios de rol"
        ordering = ["-fecha", "-id"]

    def __str__(self):
        return f"{self.usuario}: {self.rol_anterior} -> {self.rol_nuevo}"


class EventoAuditoria(models.Model):
    """Evento mínimo de acceso o cambio en información académica protegida."""

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="eventos_auditoria",
    )
    actor_rol = models.CharField(max_length=20, blank=True)
    accion = models.CharField(max_length=50)
    recurso = models.CharField(max_length=30)
    recurso_id = models.CharField(max_length=64, blank=True)
    detalles = models.JSONField(default=dict, blank=True)
    fecha = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-fecha", "-id"]
        indexes = [
            models.Index(fields=["recurso", "recurso_id", "-fecha"]),
            models.Index(fields=["accion", "-fecha"]),
        ]

    def __str__(self):
        return f"{self.accion} · {self.recurso} {self.recurso_id}"


class Asignatura(models.Model):
    """Materia que un tutor puede dictar. Se desactiva en vez de borrarse."""

    nombre = models.CharField(max_length=100)
    activa = models.BooleanField(default=True)

    class Meta:
        verbose_name = "asignatura"
        verbose_name_plural = "asignaturas"
        ordering = ["nombre"]
        constraints = [
            # El nombre es único sin distinguir mayúsculas.
            models.UniqueConstraint(Lower("nombre"), name="asignatura_nombre_ci_unico"),
        ]

    def __str__(self):
        return self.nombre


class PerfilTutor(models.Model):
    """Datos del tutor para que la institución le asigne estudiantes.

    Solo existe para usuarios con rol tutor. Al quitarle el rol el perfil se conserva
    (con su historial de asignaturas) pero deja de estar disponible.
    """

    usuario = models.OneToOneField(Usuario, on_delete=models.CASCADE, related_name="perfil_tutor")
    # En TextField, max_length no se valida en el modelo: se exige con un validador.
    biografia = models.TextField(blank=True, validators=[MaxLengthValidator(1000)])
    asignaturas = models.ManyToManyField(Asignatura, blank=True, related_name="tutores")
    disponible = models.BooleanField(
        default=False, help_text="Si acepta que la institución le asigne estudiantes."
    )
    # Habilitación institucional: la decide coordinación, no el tutor. Sin ella no puede
    # marcarse disponible. Al retirarla, `disponible` vuelve a falso.
    habilitado = models.BooleanField(default=False)
    habilitado_por = models.ForeignKey(
        Usuario, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    fecha_habilitacion = models.DateTimeField(null=True, blank=True)
    fecha_creacion = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = "perfil de tutor"
        verbose_name_plural = "perfiles de tutor"
        ordering = ["usuario__apellidos", "usuario__nombres"]

    def __str__(self):
        return f"Perfil de {self.usuario}"

    def save(self, *args, **kwargs):
        if self.usuario.rol != Rol.TUTOR:
            raise ValidationError("Solo un usuario con rol tutor puede tener perfil de tutor.")
        super().save(*args, **kwargs)


class HorarioDisponibilidadTutor(models.Model):
    """Franja semanal recurrente en la que el tutor puede dictar sesiones."""

    perfil = models.ForeignKey(
        PerfilTutor, on_delete=models.CASCADE, related_name="horarios_disponibilidad"
    )
    dia_semana = models.PositiveSmallIntegerField(help_text="Lunes=0 ... domingo=6.")
    hora_inicio = models.TimeField()
    hora_fin = models.TimeField()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["perfil", "dia_semana", "hora_inicio", "hora_fin"],
                name="tutor_horario_no_duplicado",
            ),
            models.CheckConstraint(
                condition=models.Q(dia_semana__gte=0, dia_semana__lte=6),
                name="tutor_horario_dia_valido",
            ),
            models.CheckConstraint(
                condition=models.Q(hora_fin__gt=models.F("hora_inicio")),
                name="tutor_horario_intervalo_valido",
            ),
        ]
        ordering = ["dia_semana", "hora_inicio"]

    def __str__(self):
        return f"{self.perfil.usuario}: día {self.dia_semana} {self.hora_inicio}-{self.hora_fin}"


class BloqueoDisponibilidadTutor(models.Model):
    """Franja puntual en la que el tutor no estará disponible."""

    perfil = models.ForeignKey(
        PerfilTutor, on_delete=models.CASCADE, related_name="bloqueos_disponibilidad"
    )
    fecha = models.DateField()
    hora_inicio = models.TimeField()
    hora_fin = models.TimeField()
    motivo = models.CharField(max_length=200, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(hora_fin__gt=models.F("hora_inicio")),
                name="tutor_bloqueo_intervalo_valido",
            ),
        ]
        ordering = ["fecha", "hora_inicio"]

    def __str__(self):
        return f"{self.perfil.usuario}: {self.fecha} {self.hora_inicio}-{self.hora_fin}"


class Grado(models.Model):
    """Nivel escolar (p. ej. Sexto, Undécimo). `orden` fija cómo se listan."""

    nombre = models.CharField(max_length=50)
    orden = models.PositiveSmallIntegerField(default=0)
    activo = models.BooleanField(default=True)

    class Meta:
        verbose_name = "grado"
        verbose_name_plural = "grados"
        ordering = ["orden", "nombre"]
        constraints = [
            models.UniqueConstraint(Lower("nombre"), name="grado_nombre_ci_unico"),
        ]

    def __str__(self):
        return self.nombre


class Grupo(models.Model):
    """Curso concreto dentro de un grado (p. ej. A, B o 601)."""

    grado = models.ForeignKey(Grado, on_delete=models.PROTECT, related_name="grupos")
    nombre = models.CharField(max_length=20)
    activo = models.BooleanField(default=True)

    class Meta:
        verbose_name = "grupo"
        verbose_name_plural = "grupos"
        ordering = ["grado__orden", "grado__nombre", "nombre"]
        constraints = [
            # Dentro de un grado el nombre del grupo no se repite.
            models.UniqueConstraint(Lower("nombre"), "grado", name="grupo_nombre_por_grado_unico"),
        ]

    def __str__(self):
        return f"{self.grado} {self.nombre}"


class PerfilEstudiante(models.Model):
    """Datos escolares del estudiante. El grado se obtiene a través del grupo."""

    usuario = models.OneToOneField(
        Usuario, on_delete=models.CASCADE, related_name="perfil_estudiante"
    )
    grupo = models.ForeignKey(
        Grupo, null=True, blank=True, on_delete=models.PROTECT, related_name="estudiantes"
    )
    fecha_creacion = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = "perfil de estudiante"
        verbose_name_plural = "perfiles de estudiante"
        ordering = ["usuario__apellidos", "usuario__nombres"]

    def __str__(self):
        return f"Perfil de {self.usuario}"

    def save(self, *args, **kwargs):
        if self.usuario.rol != Rol.ESTUDIANTE:
            raise ValidationError(
                "Solo un usuario con rol estudiante puede tener perfil de estudiante."
            )
        super().save(*args, **kwargs)

    @property
    def grado(self):
        return self.grupo.grado if self.grupo_id else None


class CambioEstado(models.Model):
    """Historial de activaciones y desactivaciones de cuentas."""

    usuario = models.ForeignKey(Usuario, on_delete=models.CASCADE, related_name="cambios_de_estado")
    activo = models.BooleanField(help_text="Estado en que quedó la cuenta.")
    motivo = models.CharField(max_length=200, blank=True)
    cambiado_por = models.ForeignKey(
        Usuario, null=True, on_delete=models.SET_NULL, related_name="estados_cambiados"
    )
    fecha = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = "cambio de estado"
        verbose_name_plural = "cambios de estado"
        ordering = ["-fecha", "-id"]

    def __str__(self):
        return f"{self.usuario}: {'activada' if self.activo else 'desactivada'}"


class VinculoAcudiente(models.Model):
    """Relación entre un acudiente y un estudiante a su cargo.

    El acudiente solo consulta y acompaña el proceso de los estudiantes vinculados; el vínculo
    lo crea y lo retira la administración (o coordinación autorizada).
    """

    acudiente = models.ForeignKey(
        Usuario, on_delete=models.CASCADE, related_name="estudiantes_vinculados"
    )
    estudiante = models.ForeignKey(
        Usuario, on_delete=models.CASCADE, related_name="acudientes_vinculados"
    )
    parentesco = models.CharField(max_length=60, blank=True)
    creado_por = models.ForeignKey(
        Usuario, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    fecha_creacion = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = "vínculo de acudiente"
        verbose_name_plural = "vínculos de acudiente"
        ordering = ["estudiante__apellidos", "estudiante__nombres", "acudiente__apellidos"]
        constraints = [
            models.UniqueConstraint(
                fields=["acudiente", "estudiante"], name="vinculo_acudiente_unico"
            ),
            models.CheckConstraint(
                condition=~models.Q(acudiente=models.F("estudiante")),
                name="vinculo_acudiente_distinto_del_estudiante",
            ),
        ]

    def __str__(self):
        return f"{self.acudiente} → {self.estudiante}"

    def save(self, *args, **kwargs):
        if self.acudiente.rol != Rol.ACUDIENTE:
            raise ValidationError("Solo un usuario con rol acudiente puede vincularse.")
        if self.estudiante.rol != Rol.ESTUDIANTE:
            raise ValidationError("El vinculado debe ser un usuario con rol estudiante.")
        super().save(*args, **kwargs)


class Dispositivo(models.Model):
    """Navegador o app que el usuario ya verificó. Solo se guarda la huella (SHA-256) del
    identificador aleatorio que genera el cliente: un volcado de la base no permite
    suplantar el dispositivo."""

    usuario = models.ForeignKey(Usuario, on_delete=models.CASCADE, related_name="dispositivos")
    huella = models.CharField(max_length=64)
    nombre = models.CharField(max_length=120, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    creado = models.DateTimeField(default=timezone.now)
    ultimo_uso = models.DateTimeField(default=timezone.now)
    revocado_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-ultimo_uso"]
        constraints = [
            models.UniqueConstraint(
                fields=["usuario", "huella"], name="dispositivo_unico_por_usuario"
            )
        ]

    def __str__(self):
        return f"{self.usuario_id}:{self.nombre or self.huella[:8]}"


class DesafioDispositivo(models.Model):
    """Código de un solo uso enviado al correo para registrar un dispositivo nuevo."""

    usuario = models.ForeignKey(Usuario, on_delete=models.CASCADE, related_name="+")
    huella = models.CharField(max_length=64)
    codigo_hash = models.CharField(max_length=64)
    expira = models.DateTimeField()
    intentos = models.PositiveSmallIntegerField(default=0)
    usado = models.BooleanField(default=False)

    def __str__(self):
        return f"desafío {self.pk} de {self.usuario_id}"
