from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone

from academico.models import PeriodoAcademico
from usuarios.models import Asignatura
from usuarios.roles import Rol

NOTA_MINIMA = Decimal("1.00")
NOTA_MAXIMA = Decimal("5.00")
NOTA_APROBACION = Decimal("3.00")


def _exigir_estudiante(usuario):
    if usuario.rol != Rol.ESTUDIANTE:
        raise ValidationError("Solo un estudiante puede tener seguimiento académico.")


class Resultado(models.Model):
    """Nota de un estudiante en una asignatura durante un periodo (escala de 1,00 a 5,00)."""

    estudiante = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="resultados"
    )
    asignatura = models.ForeignKey(Asignatura, on_delete=models.PROTECT, related_name="resultados")
    periodo = models.ForeignKey(
        PeriodoAcademico, on_delete=models.PROTECT, related_name="resultados"
    )
    valor = models.DecimalField(
        max_digits=3,
        decimal_places=2,
        validators=[MinValueValidator(NOTA_MINIMA), MaxValueValidator(NOTA_MAXIMA)],
    )
    registrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    fecha_registro = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = "resultado"
        verbose_name_plural = "resultados"
        ordering = ["-periodo__fecha_inicio", "asignatura__nombre"]
        constraints = [
            models.UniqueConstraint(
                fields=["estudiante", "asignatura", "periodo"], name="resultado_unico"
            ),
            models.CheckConstraint(
                condition=models.Q(valor__gte=NOTA_MINIMA, valor__lte=NOTA_MAXIMA),
                name="resultado_en_escala",
            ),
        ]

    def __str__(self):
        return f"{self.estudiante}: {self.asignatura} {self.valor}"

    def save(self, *args, **kwargs):
        _exigir_estudiante(self.estudiante)
        super().save(*args, **kwargs)


class CambioNota(models.Model):
    """Historial de correcciones de una nota: nada se sobrescribe sin dejar rastro."""

    resultado = models.ForeignKey(Resultado, on_delete=models.CASCADE, related_name="cambios")
    valor_anterior = models.DecimalField(max_digits=3, decimal_places=2)
    valor_nuevo = models.DecimalField(max_digits=3, decimal_places=2)
    motivo = models.CharField(max_length=300)
    cambiado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    fecha = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = "cambio de nota"
        verbose_name_plural = "cambios de nota"
        ordering = ["-fecha", "-id"]

    def __str__(self):
        return f"{self.resultado}: {self.valor_anterior} -> {self.valor_nuevo}"


class Asistencia(models.Model):
    """Asistencia de un estudiante en un día lectivo."""

    class Estado(models.TextChoices):
        PRESENTE = "presente", "Presente"
        TARDE = "tarde", "Llegó tarde"
        AUSENTE = "ausente", "Ausente"
        EXCUSA = "excusa", "Ausencia justificada"

    estudiante = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="asistencias"
    )
    fecha = models.DateField()
    estado = models.CharField(max_length=10, choices=Estado.choices)
    registrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        verbose_name = "asistencia"
        verbose_name_plural = "asistencias"
        ordering = ["-fecha", "estudiante__apellidos"]
        constraints = [
            models.UniqueConstraint(fields=["estudiante", "fecha"], name="asistencia_unica"),
        ]

    def __str__(self):
        return f"{self.estudiante} {self.fecha:%Y-%m-%d}: {self.estado}"

    def save(self, *args, **kwargs):
        _exigir_estudiante(self.estudiante)
        super().save(*args, **kwargs)


class TrabajoPendiente(models.Model):
    """Trabajo que el estudiante no ha entregado. Queda en su ficha hasta que lo entregue."""

    estudiante = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="trabajos"
    )
    asignatura = models.ForeignKey(Asignatura, on_delete=models.PROTECT, related_name="trabajos")
    periodo = models.ForeignKey(PeriodoAcademico, on_delete=models.PROTECT, related_name="trabajos")
    descripcion = models.CharField(max_length=200)
    fecha_limite = models.DateField()
    entregado = models.BooleanField(default=False)
    fecha_entrega = models.DateField(null=True, blank=True)
    registrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        verbose_name = "trabajo pendiente"
        verbose_name_plural = "trabajos pendientes"
        ordering = ["entregado", "fecha_limite"]

    def __str__(self):
        return f"{self.estudiante}: {self.descripcion}"

    def save(self, *args, **kwargs):
        _exigir_estudiante(self.estudiante)
        super().save(*args, **kwargs)


class ReglaAcademica(models.Model):
    """Umbral configurable que marca a un estudiante como en atención, riesgo o crítico."""

    class Tipo(models.TextChoices):
        NOTA_BAJA = "nota_baja", "Nota baja en una asignatura"
        ASISTENCIA_BAJA = "asistencia_baja", "Asistencia baja"
        TRABAJOS_PENDIENTES = "trabajos_pendientes", "Trabajos sin entregar"

    class Severidad(models.TextChoices):
        ATENCION = "atencion", "Atención"
        RIESGO = "riesgo", "Riesgo"
        CRITICO = "critico", "Crítico"

    nombre = models.CharField(max_length=100)
    tipo = models.CharField(max_length=25, choices=Tipo.choices)
    umbral = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0"))],
        help_text=(
            "Nota baja y asistencia baja: se activa si el valor es MENOR que el umbral. "
            "Trabajos pendientes: se activa si la cantidad es IGUAL O MAYOR que el umbral."
        ),
    )
    severidad = models.CharField(max_length=10, choices=Severidad.choices)
    activa = models.BooleanField(default=True)

    class Meta:
        verbose_name = "regla académica"
        verbose_name_plural = "reglas académicas"
        ordering = ["tipo", "-umbral"]

    def __str__(self):
        return self.nombre


class EvaluacionPosterior(models.Model):
    """Nota que mide el resultado académico después de trabajar el plan de recuperación."""

    plan = models.OneToOneField(
        "planes.PlanRefuerzo", on_delete=models.CASCADE, related_name="evaluacion_posterior"
    )
    nota_inicial = models.DecimalField(max_digits=3, decimal_places=2)
    nota_posterior = models.DecimalField(
        max_digits=3,
        decimal_places=2,
        validators=[MinValueValidator(NOTA_MINIMA), MaxValueValidator(NOTA_MAXIMA)],
    )
    observaciones = models.CharField(max_length=500, blank=True)
    registrada_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    fecha_registro = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-fecha_registro"]

    def __str__(self):
        return f"Evaluación posterior del plan {self.plan_id}: {self.nota_posterior}"

    @property
    def mejora(self):
        return self.nota_posterior - self.nota_inicial

    @property
    def recuperacion_efectiva(self):
        return self.nota_inicial < NOTA_APROBACION <= self.nota_posterior
