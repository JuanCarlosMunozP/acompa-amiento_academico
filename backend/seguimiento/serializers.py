from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from academico.models import Matricula, PeriodoAcademico
from usuarios.models import Asignatura, Usuario
from usuarios.roles import Rol

from .models import (
    NOTA_MAXIMA,
    NOTA_MINIMA,
    Asistencia,
    CambioNota,
    EvaluacionPosterior,
    ReglaAcademica,
    Resultado,
    TrabajoPendiente,
)


def _estudiantes_activos():
    return Usuario.objects.filter(rol=Rol.ESTUDIANTE, is_active=True)


# --------------------------------------------------------------------------- notas

VALOR_NOTA = {
    "max_digits": 3,
    "decimal_places": 2,
    "min_value": NOTA_MINIMA,
    "max_value": NOTA_MAXIMA,
}


class ResultadoSerializer(serializers.ModelSerializer):
    estudiante = serializers.PrimaryKeyRelatedField(queryset=_estudiantes_activos())
    asignatura = serializers.PrimaryKeyRelatedField(queryset=Asignatura.objects.filter(activa=True))
    periodo = serializers.PrimaryKeyRelatedField(queryset=PeriodoAcademico.objects.all())
    valor = serializers.DecimalField(**VALOR_NOTA)
    estudiante_nombre = serializers.SerializerMethodField()
    asignatura_nombre = serializers.CharField(source="asignatura.nombre", read_only=True)
    periodo_nombre = serializers.CharField(source="periodo.nombre", read_only=True)

    class Meta:
        model = Resultado
        fields = [
            "id",
            "estudiante",
            "estudiante_nombre",
            "asignatura",
            "asignatura_nombre",
            "periodo",
            "periodo_nombre",
            "valor",
            "fecha_registro",
        ]
        read_only_fields = ["id", "fecha_registro"]
        validators = []  # la unicidad y la matrícula se validan abajo, con mensajes claros

    def get_estudiante_nombre(self, resultado):
        e = resultado.estudiante
        return f"{e.nombres} {e.apellidos}".strip()

    def validate(self, attrs):
        estudiante, periodo = attrs["estudiante"], attrs["periodo"]
        if not Matricula.objects.filter(
            estudiante=estudiante, periodo=periodo, estado=Matricula.Estado.ACTIVA
        ).exists():
            raise serializers.ValidationError(
                {"estudiante": "El estudiante no tiene una matrícula activa en ese periodo."}
            )
        if Resultado.objects.filter(
            estudiante=estudiante, asignatura=attrs["asignatura"], periodo=periodo
        ).exists():
            raise serializers.ValidationError(
                {"valor": "Ya hay una nota para ese estudiante, asignatura y periodo. Edítala."}
            )
        return attrs


class EditarNotaSerializer(serializers.Serializer):
    """Corrección de una nota ya registrada: exige el motivo, que queda en el historial."""

    valor = serializers.DecimalField(**VALOR_NOTA)
    motivo = serializers.CharField(max_length=300)

    def validate_motivo(self, valor):
        valor = valor.strip()
        if len(valor) < 5:
            raise serializers.ValidationError("Explica brevemente el motivo (mínimo 5 letras).")
        return valor


class CambioNotaSerializer(serializers.ModelSerializer):
    cambiado_por_email = serializers.EmailField(
        source="cambiado_por.email", read_only=True, default=None
    )

    class Meta:
        model = CambioNota
        fields = [
            "id",
            "valor_anterior",
            "valor_nuevo",
            "motivo",
            "cambiado_por_email",
            "fecha",
        ]
        read_only_fields = fields


class EvaluacionPosteriorSerializer(serializers.ModelSerializer):
    estudiante_nombre = serializers.CharField(
        source="plan.estudiante.nombre_completo", read_only=True
    )
    asignatura_nombre = serializers.CharField(source="plan.asignatura.nombre", read_only=True)
    grupo_nombre = serializers.SerializerMethodField()
    mejora = serializers.DecimalField(max_digits=4, decimal_places=2, read_only=True)
    recuperacion_efectiva = serializers.BooleanField(read_only=True)

    class Meta:
        model = EvaluacionPosterior
        fields = [
            "id",
            "plan",
            "estudiante_nombre",
            "asignatura_nombre",
            "grupo_nombre",
            "nota_inicial",
            "nota_posterior",
            "mejora",
            "recuperacion_efectiva",
            "observaciones",
            "fecha_registro",
        ]
        read_only_fields = [
            "id",
            "nota_inicial",
            "mejora",
            "recuperacion_efectiva",
            "fecha_registro",
        ]

    def get_grupo_nombre(self, obj):
        matricula = (
            Matricula.objects.filter(
                estudiante=obj.plan.estudiante,
                periodo=obj.plan.periodo,
                estado=Matricula.Estado.ACTIVA,
            )
            .select_related("grupo__grado")
            .first()
        )
        return (
            f"{matricula.grupo.grado.nombre} {matricula.grupo.nombre}" if matricula else "Sin grupo"
        )


# --------------------------------------------------------------------------- asistencia


class RegistroAsistenciaSerializer(serializers.Serializer):
    estudiante = serializers.IntegerField(min_value=1)
    estado = serializers.ChoiceField(choices=Asistencia.Estado.choices)


class TomaDeAsistenciaSerializer(serializers.Serializer):
    registros = RegistroAsistenciaSerializer(many=True, allow_empty=False)

    def validate_registros(self, registros):
        ids = [r["estudiante"] for r in registros]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError("Hay estudiantes repetidos en la lista.")
        return registros


# --------------------------------------------------------------------------- trabajos


class TrabajoSerializer(serializers.ModelSerializer):
    asignatura = serializers.PrimaryKeyRelatedField(queryset=Asignatura.objects.filter(activa=True))
    periodo = serializers.PrimaryKeyRelatedField(
        queryset=PeriodoAcademico.objects.all(), required=False
    )
    asignatura_nombre = serializers.CharField(source="asignatura.nombre", read_only=True)
    vencido = serializers.SerializerMethodField()

    class Meta:
        model = TrabajoPendiente
        fields = [
            "id",
            "asignatura",
            "asignatura_nombre",
            "periodo",
            "descripcion",
            "fecha_limite",
            "entregado",
            "fecha_entrega",
            "vencido",
        ]
        read_only_fields = ["id", "fecha_entrega"]

    def get_vencido(self, trabajo):
        return not trabajo.entregado and trabajo.fecha_limite < timezone.localdate()

    def validate_descripcion(self, valor):
        valor = valor.strip()
        if not valor:
            raise serializers.ValidationError("Describe el trabajo.")
        return valor


# --------------------------------------------------------------------------- reglas

RANGO_UMBRAL = {
    ReglaAcademica.Tipo.NOTA_BAJA: (NOTA_MINIMA, NOTA_MAXIMA, "entre 1 y 5"),
    ReglaAcademica.Tipo.ASISTENCIA_BAJA: (Decimal("1"), Decimal("100"), "entre 1 y 100 (%)"),
    ReglaAcademica.Tipo.TRABAJOS_PENDIENTES: (Decimal("1"), Decimal("50"), "entre 1 y 50"),
}


class ReglaSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReglaAcademica
        fields = ["id", "nombre", "tipo", "umbral", "severidad", "activa"]

    def validate_nombre(self, valor):
        valor = valor.strip()
        if not valor:
            raise serializers.ValidationError("Ponle un nombre a la regla.")
        return valor

    def validate(self, attrs):
        tipo = attrs.get("tipo", self.instance.tipo if self.instance else None)
        umbral = attrs.get("umbral", self.instance.umbral if self.instance else None)
        if tipo and umbral is not None:
            minimo, maximo, texto = RANGO_UMBRAL[tipo]
            if not minimo <= umbral <= maximo:
                raise serializers.ValidationError(
                    {"umbral": f"Para esta regla debe estar {texto}."}
                )
            if tipo == ReglaAcademica.Tipo.TRABAJOS_PENDIENTES and umbral != umbral.to_integral():
                raise serializers.ValidationError(
                    {"umbral": "Debe ser un número entero de trabajos."}
                )
        return attrs
