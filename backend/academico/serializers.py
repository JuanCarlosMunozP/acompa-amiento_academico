from rest_framework import serializers

from usuarios.models import Asignatura, Grado, Grupo, Usuario
from usuarios.roles import Rol

from .models import DiaNoHabil, Institucion, Matricula, PeriodoAcademico, Sede


def validar_nombre_unico(modelo, valor, instancia, mensaje, **filtros):
    """El nombre no puede repetirse (sin distinguir mayúsculas) entre los registros comparables."""
    existentes = modelo.objects.filter(nombre__iexact=valor.strip(), **filtros)
    if instancia is not None:
        existentes = existentes.exclude(pk=instancia.pk)
    if existentes.exists():
        raise serializers.ValidationError(mensaje)
    return valor


class InstitucionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Institucion
        fields = ["nombre", "nit", "direccion", "ciudad", "telefono", "correo", "sede_unica"]

    def validate_sede_unica(self, valor):
        if valor and self.instance and not self.instance.sede_unica and Sede.objects.count() > 1:
            raise serializers.ValidationError(
                "No puedes configurar sede única mientras haya varias sedes registradas."
            )
        return valor


class SedeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Sede
        fields = [
            "id",
            "nombre",
            "nit",
            "direccion",
            "ciudad",
            "telefono",
            "correo",
            "activa",
            "principal",
        ]
        # La restricción «una sola principal» la resuelve `create/update` pasando el cargo a la
        # nueva; sin esto DRF la convertiría en un error de validación.
        extra_kwargs = {"principal": {"validators": []}}

    def validate_nombre(self, valor):
        return validar_nombre_unico(
            Sede, valor, self.instance, "Ya existe una sede con ese nombre."
        )

    def validate(self, attrs):
        if self.instance is None and Institucion.obtener().sede_unica and Sede.objects.exists():
            raise serializers.ValidationError(
                {"sede_unica": "Esta institución ya tiene su sede única registrada."}
            )
        activa = attrs.get("activa", self.instance.activa if self.instance else True)
        principal = attrs.get("principal", self.instance.principal if self.instance else False)
        if principal and not activa:
            raise serializers.ValidationError(
                {"activa": "La sede principal debe estar activa. Elige otra como principal antes."}
            )
        return attrs

    def _una_sola_principal(self, datos, instancia=None):
        if datos.get("principal"):
            otras = Sede.objects.filter(principal=True)
            if instancia is not None:
                otras = otras.exclude(pk=instancia.pk)
            otras.update(principal=False)

    def create(self, datos):
        self._una_sola_principal(datos)
        return super().create(datos)

    def update(self, instancia, datos):
        self._una_sola_principal(datos, instancia)
        return super().update(instancia, datos)


class GrupoDeGradoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Grupo
        fields = ["id", "nombre", "activo"]
        read_only_fields = fields


class GradoAdminSerializer(serializers.ModelSerializer):
    grupos = GrupoDeGradoSerializer(many=True, read_only=True)

    class Meta:
        model = Grado
        fields = ["id", "nombre", "orden", "activo", "grupos"]

    def validate_nombre(self, valor):
        return validar_nombre_unico(
            Grado, valor, self.instance, "Ya existe un grado con ese nombre."
        )


class GrupoAdminSerializer(serializers.ModelSerializer):
    grado = serializers.PrimaryKeyRelatedField(queryset=Grado.objects.all())
    grado_nombre = serializers.CharField(source="grado.nombre", read_only=True)
    estudiantes = serializers.SerializerMethodField()

    class Meta:
        model = Grupo
        fields = ["id", "grado", "grado_nombre", "nombre", "activo", "estudiantes"]

    def get_estudiantes(self, grupo):
        return grupo.matriculas.filter(estado=Matricula.Estado.ACTIVA).count()

    def validate(self, attrs):
        grado = attrs.get("grado", self.instance.grado if self.instance else None)
        nombre = attrs.get("nombre", self.instance.nombre if self.instance else None)
        if grado is not None and nombre:
            validar_nombre_unico(
                Grupo,
                nombre,
                self.instance,
                "Ese grado ya tiene un grupo con ese nombre.",
                grado=grado,
            )
        if self.instance and "grado" in attrs and attrs["grado"] != self.instance.grado:
            if self.instance.matriculas.exists() or self.instance.estudiantes.exists():
                raise serializers.ValidationError(
                    {"grado": "No se puede cambiar el grado de un grupo que ya tiene estudiantes."}
                )
        return attrs


class AsignaturaAdminSerializer(serializers.ModelSerializer):
    class Meta:
        model = Asignatura
        fields = ["id", "nombre", "activa"]

    def validate_nombre(self, valor):
        return validar_nombre_unico(
            Asignatura, valor, self.instance, "Ya existe una asignatura con ese nombre."
        )


class PeriodoSerializer(serializers.ModelSerializer):
    es_actual = serializers.BooleanField(read_only=True)

    class Meta:
        model = PeriodoAcademico
        fields = ["id", "nombre", "fecha_inicio", "fecha_fin", "es_actual"]

    def validate_nombre(self, valor):
        return validar_nombre_unico(
            PeriodoAcademico, valor, self.instance, "Ya existe un periodo con ese nombre."
        )

    def validate(self, attrs):
        inicio = attrs.get("fecha_inicio", self.instance.fecha_inicio if self.instance else None)
        fin = attrs.get("fecha_fin", self.instance.fecha_fin if self.instance else None)
        if inicio and fin:
            if fin < inicio:
                raise serializers.ValidationError(
                    {"fecha_fin": "La fecha de fin no puede ser anterior a la de inicio."}
                )
            solapado = PeriodoAcademico.que_se_solapan(
                inicio, fin, self.instance.pk if self.instance else None
            ).first()
            if solapado:
                raise serializers.ValidationError(
                    {"fecha_inicio": f"Se solapa con el periodo «{solapado.nombre}»."}
                )
        return attrs


class DiaNoHabilSerializer(serializers.ModelSerializer):
    class Meta:
        model = DiaNoHabil
        fields = ["id", "fecha", "descripcion"]

    def validate_fecha(self, valor):
        repetido = DiaNoHabil.objects.filter(fecha=valor)
        if self.instance is not None:
            repetido = repetido.exclude(pk=self.instance.pk)
        if repetido.exists():
            raise serializers.ValidationError("Esa fecha ya está registrada como día no hábil.")
        return valor

    def validate_descripcion(self, valor):
        if not valor.strip():
            raise serializers.ValidationError("Describe el motivo (p. ej. «Festivo»).")
        return valor.strip()


class MatriculaSerializer(serializers.ModelSerializer):
    estudiante = serializers.PrimaryKeyRelatedField(
        queryset=Usuario.objects.filter(rol=Rol.ESTUDIANTE, is_active=True)
    )
    estudiante_nombre = serializers.SerializerMethodField()
    estudiante_email = serializers.EmailField(source="estudiante.email", read_only=True)
    periodo_nombre = serializers.CharField(source="periodo.nombre", read_only=True)
    grupo_nombre = serializers.SerializerMethodField()

    class Meta:
        model = Matricula
        fields = [
            "id",
            "estudiante",
            "estudiante_nombre",
            "estudiante_email",
            "periodo",
            "periodo_nombre",
            "grupo",
            "grupo_nombre",
            "estado",
        ]
        # La unicidad (estudiante, periodo) se valida en `validate` con un mensaje claro.
        validators = []

    def get_estudiante_nombre(self, matricula):
        return f"{matricula.estudiante.nombres} {matricula.estudiante.apellidos}".strip()

    def get_grupo_nombre(self, matricula):
        return str(matricula.grupo)

    def validate_grupo(self, grupo):
        if not grupo.activo or not grupo.grado.activo:
            raise serializers.ValidationError("El grupo no existe o no está activo.")
        return grupo

    def validate(self, attrs):
        if self.instance is not None:
            # Una matrícula no cambia de estudiante ni de periodo: se crea otra o se retira.
            for campo in ("estudiante", "periodo"):
                if campo in attrs and attrs[campo] != getattr(self.instance, campo):
                    raise serializers.ValidationError(
                        {campo: "No se puede cambiar. Retira la matrícula y crea otra."}
                    )
        elif Matricula.objects.filter(
            estudiante=attrs["estudiante"], periodo=attrs["periodo"]
        ).exists():
            raise serializers.ValidationError(
                {"estudiante": "Este estudiante ya está matriculado en ese periodo."}
            )
        return attrs
