from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone

from usuarios.roles import Rol


class Institucion(models.Model):
    """Datos de la institución. Es un registro único (siempre `pk=1`): usa `obtener()`."""

    nombre = models.CharField(max_length=200)
    nit = models.CharField("NIT", max_length=30, blank=True)
    direccion = models.CharField(max_length=200, blank=True)
    ciudad = models.CharField(max_length=100, blank=True)
    telefono = models.CharField(max_length=30, blank=True)
    correo = models.EmailField(blank=True)
    sede_unica = models.BooleanField(default=True)

    class Meta:
        verbose_name = "institución"
        verbose_name_plural = "institución"
        constraints = [
            models.CheckConstraint(condition=models.Q(pk=1), name="institucion_registro_unico"),
        ]

    def __str__(self):
        return self.nombre

    @classmethod
    def obtener(cls):
        """La institución; si aún no existe se crea con el nombre configurado en el entorno."""
        institucion, _ = cls.objects.get_or_create(
            pk=1, defaults={"nombre": settings.INSTITUCION_NOMBRE}
        )
        return institucion


class Sede(models.Model):
    """Sede o campus. Se desactiva en vez de borrarse. Solo una puede ser la principal."""

    nombre = models.CharField(max_length=100)
    nit = models.CharField("NIT", max_length=30, blank=True)
    direccion = models.CharField(max_length=200, blank=True)
    ciudad = models.CharField(max_length=100, blank=True)
    telefono = models.CharField(max_length=30, blank=True)
    correo = models.EmailField(blank=True)
    activa = models.BooleanField(default=True)
    principal = models.BooleanField(default=False)

    class Meta:
        verbose_name = "sede"
        verbose_name_plural = "sedes"
        ordering = ["-principal", "nombre"]
        constraints = [
            models.UniqueConstraint(Lower("nombre"), name="sede_nombre_ci_unico"),
            models.UniqueConstraint(
                fields=["principal"],
                condition=models.Q(principal=True),
                name="sede_principal_unica",
            ),
        ]

    def __str__(self):
        return self.nombre


class PeriodoAcademico(models.Model):
    """Periodo del año escolar (p. ej. «2026 - Periodo 1»). Los periodos no se solapan."""

    nombre = models.CharField(max_length=100)
    fecha_inicio = models.DateField()
    fecha_fin = models.DateField()

    class Meta:
        verbose_name = "periodo académico"
        verbose_name_plural = "periodos académicos"
        ordering = ["-fecha_inicio"]
        constraints = [
            models.UniqueConstraint(Lower("nombre"), name="periodo_nombre_ci_unico"),
            models.CheckConstraint(
                condition=models.Q(fecha_fin__gte=models.F("fecha_inicio")),
                name="periodo_fechas_validas",
            ),
        ]

    def __str__(self):
        return self.nombre

    @property
    def es_actual(self):
        return self.fecha_inicio <= timezone.localdate() <= self.fecha_fin

    @classmethod
    def actual(cls):
        hoy = timezone.localdate()
        return cls.objects.filter(fecha_inicio__lte=hoy, fecha_fin__gte=hoy).first()

    @classmethod
    def que_se_solapan(cls, inicio, fin, excluir_pk=None):
        solapados = cls.objects.filter(fecha_inicio__lte=fin, fecha_fin__gte=inicio)
        return solapados.exclude(pk=excluir_pk) if excluir_pk else solapados


class Matricula(models.Model):
    """Inscripción de un estudiante en un periodo y un grupo. Una por estudiante y periodo."""

    class Estado(models.TextChoices):
        ACTIVA = "activa", "Activa"
        RETIRADA = "retirada", "Retirada"

    estudiante = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="matriculas"
    )
    periodo = models.ForeignKey(
        PeriodoAcademico, on_delete=models.PROTECT, related_name="matriculas"
    )
    grupo = models.ForeignKey("usuarios.Grupo", on_delete=models.PROTECT, related_name="matriculas")
    estado = models.CharField(max_length=10, choices=Estado.choices, default=Estado.ACTIVA)
    fecha_matricula = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = "matrícula"
        verbose_name_plural = "matrículas"
        ordering = ["-periodo__fecha_inicio", "estudiante__apellidos", "estudiante__nombres"]
        constraints = [
            models.UniqueConstraint(fields=["estudiante", "periodo"], name="matricula_unica"),
        ]

    def __str__(self):
        return f"{self.estudiante} - {self.periodo} - {self.grupo}"

    def save(self, *args, **kwargs):
        if self.estudiante.rol != Rol.ESTUDIANTE:
            raise ValidationError("Solo un estudiante puede matricularse.")
        super().save(*args, **kwargs)
        # La ficha del estudiante muestra su grupo actual: el de la matrícula del periodo vigente.
        if self.estado == self.Estado.ACTIVA and self.periodo.es_actual:
            from usuarios.models import PerfilEstudiante

            PerfilEstudiante.objects.filter(usuario=self.estudiante).update(grupo=self.grupo)


class DiaNoHabil(models.Model):
    """Fecha en que la institución no opera (festivo, cierre). Sábados y domingos ya no cuentan."""

    fecha = models.DateField(unique=True)
    descripcion = models.CharField(max_length=150)

    class Meta:
        verbose_name = "día no hábil"
        verbose_name_plural = "días no hábiles"
        ordering = ["fecha"]

    def __str__(self):
        return f"{self.fecha:%Y-%m-%d} - {self.descripcion}"
