from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import (
    FileExtensionValidator,
    MaxLengthValidator,
    MaxValueValidator,
    MinValueValidator,
)
from django.db import models
from django.utils import timezone

from academico.models import PeriodoAcademico
from seguimiento.models import NOTA_MAXIMA, NOTA_MINIMA
from usuarios.models import Asignatura
from usuarios.roles import Rol


class PlanRefuerzo(models.Model):
    """Expediente de nivelación: un estudiante, un área (asignatura) y un periodo.

    En la interfaz el «tutor» es el docente responsable. El expediente recorre tres procesos:
    registro (desempeños pendientes y datos académicos), acompañamiento (plan, dudas, entregas y
    correcciones) y cierre (valoración, nota y reporte institucional).

    Ciclo: `pendiente` (creado, sin tutor) → `asignado` (con tutor responsable) → `cerrado`;
    `cancelado` desde pendiente o asignado. Un estudiante tiene como máximo un plan vigente
    (pendiente o asignado) por asignatura y periodo.
    """

    class Estado(models.TextChoices):
        PENDIENTE = "pendiente", "Pendiente de tutor"
        ASIGNADO = "asignado", "Asignado"
        CERRADO = "cerrado", "Cerrado"
        CANCELADO = "cancelado", "Cancelado"

    VIGENTES = (Estado.PENDIENTE, Estado.ASIGNADO)

    estudiante = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="planes_refuerzo"
    )
    periodo = models.ForeignKey(PeriodoAcademico, on_delete=models.PROTECT, related_name="planes")
    asignatura = models.ForeignKey(Asignatura, on_delete=models.PROTECT, related_name="planes")
    objetivos = models.TextField(validators=[MaxLengthValidator(1000)])
    # Desempeños (logros o indicadores) que el estudiante no alcanzó en el área y el periodo.
    desempenos_no_alcanzados = models.TextField(blank=True, validators=[MaxLengthValidator(1500)])
    fecha_inicio = models.DateField()
    fecha_fin = models.DateField()
    estado = models.CharField(max_length=10, choices=Estado.choices, default=Estado.PENDIENTE)
    tutor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="planes_asignados",
    )
    creado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    fecha_creacion = models.DateTimeField(default=timezone.now)

    class Resultado(models.TextChoices):
        LOGRADO = "logrado", "Logrado (recuperado)"
        PARCIAL = "parcial", "Logrado parcialmente"
        NO_LOGRADO = "no_logrado", "No logrado"

    # Se llenan al cerrar el plan (`estado = cerrado`).
    resultado = models.CharField(max_length=10, choices=Resultado.choices, blank=True)
    fecha_cierre = models.DateField(null=True, blank=True)
    # `nota_cierre` guarda la valoración descriptiva; `nota_final` la nota cuantitativa (1,0–5,0).
    nota_cierre = models.TextField(blank=True, validators=[MaxLengthValidator(500)])
    nota_final = models.DecimalField(
        max_digits=3,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(NOTA_MINIMA), MaxValueValidator(NOTA_MAXIMA)],
    )
    # Visto bueno de coordinación sobre el expediente cerrado.
    visto_bueno_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    visto_bueno_fecha = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "plan de refuerzo"
        verbose_name_plural = "planes de refuerzo"
        ordering = ["-fecha_creacion", "-id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(fecha_fin__gte=models.F("fecha_inicio")),
                name="plan_fechas_validas",
            ),
            # Un solo plan vigente por estudiante, asignatura y periodo.
            models.UniqueConstraint(
                fields=["estudiante", "asignatura", "periodo"],
                condition=models.Q(estado__in=["pendiente", "asignado"]),
                name="plan_vigente_unico",
            ),
            # Un plan cerrado siempre tiene su resultado.
            models.CheckConstraint(
                condition=~models.Q(estado="cerrado") | ~models.Q(resultado=""),
                name="plan_cerrado_con_resultado",
            ),
            models.CheckConstraint(
                condition=models.Q(nota_final__isnull=True)
                | models.Q(nota_final__gte=NOTA_MINIMA, nota_final__lte=NOTA_MAXIMA),
                name="plan_nota_final_en_escala",
            ),
            # Un plan asignado siempre tiene tutor.
            models.CheckConstraint(
                condition=~models.Q(estado="asignado") | models.Q(tutor__isnull=False),
                name="plan_asignado_con_tutor",
            ),
        ]

    def __str__(self):
        return f"{self.estudiante} - {self.asignatura} ({self.get_estado_display()})"

    def save(self, *args, **kwargs):
        if self.estudiante.rol != Rol.ESTUDIANTE:
            raise ValidationError("Solo un estudiante puede tener un plan de refuerzo.")
        if self.tutor_id and self.tutor.rol != Rol.TUTOR:
            raise ValidationError("El responsable del plan debe ser un tutor.")
        super().save(*args, **kwargs)

    @property
    def admite_cambios(self):
        """Solo un plan asignado admite actividades, ediciones y cambios de tutor en curso.

        Al cerrarse (o cancelarse) queda bloqueado: es el candado que cualquier trabajo
        futuro del plan (actividades, sesiones...) debe consultar.
        """
        return self.estado == self.Estado.ASIGNADO


class AsignacionPlan(models.Model):
    """Historial de tutores responsables de un plan (una fila por asignación o reasignación)."""

    plan = models.ForeignKey(PlanRefuerzo, on_delete=models.CASCADE, related_name="asignaciones")
    tutor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    asignado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    fecha = models.DateTimeField(default=timezone.now)
    notificado = models.BooleanField(
        default=False, help_text="Si se pudo enviar el aviso al tutor."
    )

    class Meta:
        verbose_name = "asignación de plan"
        verbose_name_plural = "asignaciones de plan"
        ordering = ["-fecha", "-id"]

    def __str__(self):
        return f"{self.plan_id}: {self.tutor}"


class ActividadPlan(models.Model):
    """Actividad que el estudiante debe cumplir dentro de un plan, con su fecha de cierre."""

    plan = models.ForeignKey(PlanRefuerzo, on_delete=models.CASCADE, related_name="actividades")
    titulo = models.CharField(max_length=120)
    descripcion = models.TextField(blank=True, validators=[MaxLengthValidator(500)])
    fecha_limite = models.DateField()
    completada = models.BooleanField(default=False)
    fecha_completada = models.DateTimeField(null=True, blank=True)
    creado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    fecha_creacion = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = "actividad del plan"
        verbose_name_plural = "actividades del plan"
        ordering = ["completada", "fecha_limite", "id"]

    def __str__(self):
        return f"{self.titulo} ({self.fecha_limite})"


class SesionTutoria(models.Model):
    """Sesión agendada para el tutor responsable y el estudiante de un plan."""

    class Modalidad(models.TextChoices):
        PRESENCIAL = "presencial", "Presencial"
        VIRTUAL = "virtual", "Virtual"

    class Estado(models.TextChoices):
        PROGRAMADA = "programada", "Programada"
        CANCELADA = "cancelada", "Cancelada"
        REALIZADA = "realizada", "Realizada"

    class Asistencia(models.TextChoices):
        PENDIENTE = "pendiente", "Pendiente"
        PRESENTE = "presente", "Presente"
        AUSENTE = "ausente", "Ausente"
        EXCUSA = "excusa", "Ausencia justificada"

    plan = models.ForeignKey(PlanRefuerzo, on_delete=models.CASCADE, related_name="sesiones")
    tutor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="sesiones_tutoria"
    )
    inicio = models.DateTimeField()
    fin = models.DateTimeField()
    modalidad = models.CharField(max_length=12, choices=Modalidad.choices)
    lugar = models.CharField(max_length=200, blank=True)
    enlace_virtual = models.URLField(max_length=500, blank=True)
    notas = models.CharField(max_length=500, blank=True)
    estado = models.CharField(max_length=12, choices=Estado.choices, default=Estado.PROGRAMADA)
    motivo_cancelacion = models.CharField(max_length=500, blank=True)
    asistencia = models.CharField(
        max_length=10, choices=Asistencia.choices, default=Asistencia.PENDIENTE
    )
    asistencia_registrada_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="asistencias_sesion_registradas",
    )
    asistencia_fecha = models.DateTimeField(null=True, blank=True)
    creado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    fecha_creacion = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["inicio", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(fin__gt=models.F("inicio")),
                name="sesion_intervalo_valido",
            ),
        ]

    def __str__(self):
        return f"Sesión del plan {self.plan_id} ({self.inicio})"


class CupoTutoria(models.Model):
    """Espacio abierto publicado por un tutor, independiente de un plan de recuperación."""

    class Modalidad(models.TextChoices):
        PRESENCIAL = "presencial", "Presencial"
        VIRTUAL = "virtual", "Virtual"

    tutor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="cupos_tutoria"
    )
    asignatura = models.ForeignKey(Asignatura, on_delete=models.PROTECT, related_name="cupos")
    inicio = models.DateTimeField()
    fin = models.DateTimeField()
    modalidad = models.CharField(max_length=12, choices=Modalidad.choices)
    lugar = models.CharField(max_length=200, blank=True)
    enlace_virtual = models.URLField(max_length=500, blank=True)
    capacidad = models.PositiveSmallIntegerField(default=1)
    publicado = models.BooleanField(default=True)
    creado = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["inicio", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(fin__gt=models.F("inicio")), name="cupo_intervalo_valido"
            ),
            models.CheckConstraint(
                condition=models.Q(capacidad__gte=1), name="cupo_capacidad_positiva"
            ),
        ]

    def __str__(self):
        return f"{self.asignatura} con {self.tutor} ({self.inicio})"


class ReservaCupoTutoria(models.Model):
    class Estado(models.TextChoices):
        CONFIRMADA = "confirmada", "Confirmada"
        LISTA_ESPERA = "lista_espera", "Lista de espera"
        CANCELADA = "cancelada", "Cancelada"

    cupo = models.ForeignKey(CupoTutoria, on_delete=models.CASCADE, related_name="reservas")
    estudiante = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reservas_tutoria"
    )
    estado = models.CharField(max_length=12, choices=Estado.choices)
    creada = models.DateTimeField(default=timezone.now)
    actualizada = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["creada", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["cupo", "estudiante"],
                condition=~models.Q(estado="cancelada"),
                name="reserva_cupo_estudiante_activa_unica",
            ),
        ]

    def __str__(self):
        return f"{self.estudiante} · {self.cupo} ({self.estado})"


class DudaPlan(models.Model):
    """Mensaje de dudas y aclaraciones vinculado a un expediente.

    Lo escriben el estudiante y el docente responsable; el acudiente y coordinación solo lo leen.
    `respuesta_a` agrupa la respuesta bajo la duda original.
    """

    plan = models.ForeignKey(PlanRefuerzo, on_delete=models.CASCADE, related_name="dudas")
    autor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    texto = models.TextField(validators=[MaxLengthValidator(1000)])
    respuesta_a = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.CASCADE, related_name="respuestas"
    )
    creada = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = "duda o aclaración"
        verbose_name_plural = "dudas y aclaraciones"
        ordering = ["creada", "id"]

    def __str__(self):
        return f"Duda {self.pk} del plan {self.plan_id}"


def entrega_upload_path(instance, filename):
    from pathlib import PurePath

    return f"entregas_actividades/{instance.actividad_id}/{PurePath(filename).name}"


class EntregaActividad(models.Model):
    """Evidencia que el estudiante carga para una actividad, o la corrección posterior."""

    class Tipo(models.TextChoices):
        ENTREGA = "entrega", "Entrega"
        CORRECCION = "correccion", "Corrección"

    actividad = models.ForeignKey(ActividadPlan, on_delete=models.CASCADE, related_name="entregas")
    estudiante = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    tipo = models.CharField(max_length=10, choices=Tipo.choices, default=Tipo.ENTREGA)
    archivo = models.FileField(
        upload_to=entrega_upload_path,
        validators=[
            FileExtensionValidator(
                ["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "jpg", "jpeg", "png"]
            )
        ],
    )
    comentario = models.CharField(max_length=1000, blank=True)
    fecha = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = "entrega de actividad"
        verbose_name_plural = "entregas de actividades"
        ordering = ["fecha", "id"]

    def __str__(self):
        return f"{self.get_tipo_display()} de la actividad {self.actividad_id}"


class RetroalimentacionEntrega(models.Model):
    """Observaciones del docente sobre una entrega; puede pedir una corrección."""

    entrega = models.OneToOneField(
        EntregaActividad, on_delete=models.CASCADE, related_name="retroalimentacion"
    )
    docente = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    comentario = models.TextField(validators=[MaxLengthValidator(1000)])
    requiere_correccion = models.BooleanField(default=False)
    fecha = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = "retroalimentación"
        verbose_name_plural = "retroalimentaciones"
        ordering = ["fecha", "id"]

    def __str__(self):
        return f"Retroalimentación de la entrega {self.entrega_id}"


class ObservacionCoordinacion(models.Model):
    """Observación institucional que coordinación deja sobre un expediente."""

    plan = models.ForeignKey(
        PlanRefuerzo, on_delete=models.CASCADE, related_name="observaciones_coordinacion"
    )
    autor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    texto = models.TextField(validators=[MaxLengthValidator(1000)])
    creada = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = "observación de coordinación"
        verbose_name_plural = "observaciones de coordinación"
        ordering = ["creada", "id"]

    def __str__(self):
        return f"Observación del plan {self.plan_id}"


class BitacoraSesion(models.Model):
    """Registro pedagógico de cierre de una sesión de tutoría."""

    sesion = models.OneToOneField(SesionTutoria, on_delete=models.CASCADE, related_name="bitacora")
    temas = models.TextField(max_length=2000, blank=True)
    desarrollo = models.TextField(max_length=4000)
    acuerdos = models.TextField(max_length=2000, blank=True)
    observaciones = models.TextField(max_length=2000, blank=True)
    creada_por = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    fecha_cierre = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-fecha_cierre"]

    def __str__(self):
        return f"Bitácora de la sesión {self.sesion_id}"


def material_sesion_upload_path(instance, filename):
    from pathlib import PurePath

    return f"materiales_sesiones/{instance.sesion_id}/{PurePath(filename).name}"


class MaterialSesion(models.Model):
    """Material compartido en una sesión y descargado mediante una ruta autenticada."""

    sesion = models.ForeignKey(SesionTutoria, on_delete=models.CASCADE, related_name="materiales")
    titulo = models.CharField(max_length=120)
    descripcion = models.CharField(max_length=500, blank=True)
    archivo = models.FileField(
        upload_to=material_sesion_upload_path,
        validators=[
            FileExtensionValidator(
                ["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "jpg", "jpeg", "png"]
            )
        ],
    )
    subido_por = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    fecha_creacion = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-fecha_creacion"]

    def __str__(self):
        return f"{self.titulo} (sesión {self.sesion_id})"


class NotificacionAcompanamiento(models.Model):
    class Tipo(models.TextChoices):
        REGISTRO = "registro", "Registro de cuenta"
        SOLICITUD = "solicitud", "Solicitud de tutoría"
        PLAN = "plan", "Plan de recuperación"
        SESION = "sesion", "Sesión de tutoría"
        MATERIAL = "material", "Material de sesión"
        CIERRE = "cierre", "Cierre de acompañamiento"
        ALERTA = "alerta", "Alerta académica"
        DUDA = "duda", "Duda o aclaración"
        ENTREGA = "entrega", "Entrega y retroalimentación"

    destinatario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notificaciones_acompanamiento",
    )
    tipo = models.CharField(max_length=12, choices=Tipo.choices)
    titulo = models.CharField(max_length=140)
    mensaje = models.CharField(max_length=500)
    plan = models.ForeignKey("planes.PlanRefuerzo", null=True, blank=True, on_delete=models.CASCADE)
    sesion = models.ForeignKey(
        "planes.SesionTutoria", null=True, blank=True, on_delete=models.CASCADE
    )
    clave_evento = models.CharField(max_length=120, null=True, blank=True, unique=True)
    creada = models.DateTimeField(default=timezone.now)
    leida = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-creada", "-id"]

    def __str__(self):
        return f"{self.titulo} → {self.destinatario_id}"

    @property
    def no_leida(self):
        return self.leida is None


class PreferenciaNotificacion(models.Model):
    """Preferencia interna por tipo de aviso; sin fila equivale a habilitado."""

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="preferencias_avisos"
    )
    tipo = models.CharField(max_length=12, choices=NotificacionAcompanamiento.Tipo.choices)
    habilitada = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["usuario", "tipo"], name="preferencia_aviso_tipo_unica"
            ),
        ]
        ordering = ["tipo"]

    def __str__(self):
        return f"{self.usuario}: {self.tipo} ({self.habilitada})"


class PlantillaCorreoPlan(models.Model):
    class Clave(models.TextChoices):
        ASIGNACION_TUTOR = "asignacion_tutor", "Asignación al tutor"
        ASIGNACION_ESTUDIANTE = "asignacion_estudiante", "Asignación al estudiante"

    clave = models.CharField(max_length=32, choices=Clave.choices, unique=True)
    asunto = models.CharField(max_length=160)
    cuerpo_texto = models.TextField()
    cuerpo_html = models.TextField()
    modificado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    actualizado = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["clave"]
        verbose_name = "plantilla de correo de plan"
        verbose_name_plural = "plantillas de correo de planes"

    def __str__(self):
        return self.get_clave_display()
