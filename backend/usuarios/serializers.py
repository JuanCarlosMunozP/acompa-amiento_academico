from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from rest_framework import serializers

from .models import (
    Asignatura,
    BloqueoDisponibilidadTutor,
    EventoAuditoria,
    Grado,
    Grupo,
    HorarioDisponibilidadTutor,
    PerfilEstudiante,
    PerfilTutor,
    Usuario,
)
from .roles import Rol


class RegistroSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, style={"input_type": "password"})
    password_confirmacion = serializers.CharField(write_only=True, style={"input_type": "password"})

    class Meta:
        model = Usuario
        fields = [
            "id",
            "email",
            "nombres",
            "apellidos",
            "password",
            "password_confirmacion",
            "rol",
            "email_verificado",
        ]
        read_only_fields = ["id", "rol", "email_verificado"]
        extra_kwargs = {"email": {"validators": []}}

    def validate_email(self, value):
        value = value.strip()
        dominios = [d.lower() for d in settings.EMAIL_DOMINIOS_PERMITIDOS]
        if dominios and value.rsplit("@", 1)[-1].lower() not in dominios:
            raise serializers.ValidationError(
                "Usa tu correo institucional (" + ", ".join(f"@{d}" for d in dominios) + ")."
            )
        if Usuario.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("Ya existe una cuenta con este correo.")
        return value

    def validate(self, attrs):
        if attrs["password"] != attrs.pop("password_confirmacion"):
            raise serializers.ValidationError(
                {"password_confirmacion": "Las contraseñas no coinciden."}
            )
        candidato = Usuario(
            email=attrs["email"], nombres=attrs["nombres"], apellidos=attrs["apellidos"]
        )
        try:
            validate_password(attrs["password"], user=candidato)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)}) from exc
        return attrs

    def create(self, validated_data):
        # El rol nunca viene del cliente: todo registro público es estudiante.
        try:
            return Usuario.objects.create_user(**validated_data)
        except IntegrityError as exc:  # registro simultáneo con el mismo correo
            raise serializers.ValidationError(
                {"email": "Ya existe una cuenta con este correo."}
            ) from exc


class LoginSerializer(serializers.Serializer):
    email = serializers.CharField()
    password = serializers.CharField(style={"input_type": "password"})
    # Identificador aleatorio del dispositivo (lo genera y guarda el cliente).
    dispositivo = serializers.CharField(required=False, allow_blank=True, max_length=128)


class DispositivoVerificarSerializer(serializers.Serializer):
    desafio_token = serializers.CharField()
    codigo = serializers.CharField(max_length=32)


class UsuarioSerializer(serializers.ModelSerializer):
    class Meta:
        model = Usuario
        fields = ["id", "email", "nombres", "apellidos", "rol", "email_verificado", "mfa_activo"]
        read_only_fields = fields


class MfaVerificarSerializer(serializers.Serializer):
    mfa_token = serializers.CharField()
    codigo = serializers.CharField(max_length=32)


class MfaCodigoSerializer(serializers.Serializer):
    codigo = serializers.CharField(max_length=32)


class MfaReautenticacionSerializer(serializers.Serializer):
    password = serializers.CharField(style={"input_type": "password"})
    codigo = serializers.CharField(max_length=32)


class VerificarCorreoSerializer(serializers.Serializer):
    token = serializers.CharField()


class ReenviarVerificacionSerializer(serializers.Serializer):
    email = serializers.CharField()


class SolicitarRecuperacionSerializer(serializers.Serializer):
    email = serializers.CharField()


class ConfirmarRecuperacionSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    password = serializers.CharField(style={"input_type": "password"})
    password_confirmacion = serializers.CharField(style={"input_type": "password"})

    def validate(self, attrs):
        if attrs["password"] != attrs.pop("password_confirmacion"):
            raise serializers.ValidationError(
                {"password_confirmacion": "Las contraseñas no coinciden."}
            )
        return attrs


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField()


class AsignarRolSerializer(serializers.Serializer):
    rol = serializers.ChoiceField(choices=Rol.choices)


class UsuarioListaSerializer(serializers.ModelSerializer):
    rol_nombre = serializers.SerializerMethodField()

    class Meta:
        model = Usuario
        fields = ["id", "email", "nombres", "apellidos", "rol", "rol_nombre", "is_active"]
        read_only_fields = fields

    def get_rol_nombre(self, usuario):
        return Rol(usuario.rol).label


class EventoAuditoriaSerializer(serializers.ModelSerializer):
    actor_nombre = serializers.CharField(source="actor.nombre_completo", read_only=True)

    class Meta:
        model = EventoAuditoria
        fields = [
            "id",
            "actor",
            "actor_nombre",
            "actor_rol",
            "accion",
            "recurso",
            "recurso_id",
            "detalles",
            "fecha",
        ]
        read_only_fields = fields


class FiltroUsuariosSerializer(serializers.Serializer):
    q = serializers.CharField(required=False, allow_blank=True, max_length=100)
    rol = serializers.ChoiceField(choices=Rol.choices, required=False)
    activo = serializers.BooleanField(required=False)


class AsignaturaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Asignatura
        fields = ["id", "nombre"]
        read_only_fields = fields


class UsuarioResumenSerializer(serializers.ModelSerializer):
    class Meta:
        model = Usuario
        fields = ["id", "email", "nombres", "apellidos"]
        read_only_fields = fields


class PerfilTutorSerializer(serializers.ModelSerializer):
    usuario = UsuarioResumenSerializer(read_only=True)
    asignaturas = AsignaturaSerializer(many=True, read_only=True)

    class Meta:
        model = PerfilTutor
        fields = [
            "id",
            "usuario",
            "biografia",
            "asignaturas",
            "disponible",
            "habilitado",
            "fecha_habilitacion",
        ]
        read_only_fields = fields


class FiltroTutoresSerializer(serializers.Serializer):
    q = serializers.CharField(required=False, allow_blank=True, max_length=100)
    asignatura = serializers.IntegerField(required=False, min_value=1)
    disponible = serializers.BooleanField(required=False)
    habilitado = serializers.BooleanField(required=False)


class ActualizarPerfilTutorSerializer(serializers.Serializer):
    """Actualización parcial del perfil: solo cambian los campos que se envían."""

    biografia = serializers.CharField(required=False, allow_blank=True, max_length=1000)
    asignaturas = serializers.ListField(
        child=serializers.IntegerField(min_value=1), required=False, allow_empty=True, max_length=20
    )
    disponible = serializers.BooleanField(required=False)

    def validate_asignaturas(self, ids):
        ids = list(dict.fromkeys(ids))  # sin repetidos, conservando el orden
        validas = set(
            Asignatura.objects.filter(pk__in=ids, activa=True).values_list("pk", flat=True)
        )
        invalidas = [i for i in ids if i not in validas]
        if invalidas:
            raise serializers.ValidationError(
                f"Asignaturas inexistentes o inactivas: {', '.join(map(str, invalidas))}."
            )
        return ids

    def validate(self, attrs):
        perfil = self.context["perfil"]
        quedan = (
            attrs["asignaturas"]
            if "asignaturas" in attrs
            else list(perfil.asignaturas.values_list("pk", flat=True))
        )
        disponible = attrs.get("disponible", perfil.disponible)
        if disponible and not perfil.habilitado:
            raise serializers.ValidationError(
                {"disponible": "Tu perfil aún no está habilitado por la institución."}
            )
        if disponible and not quedan:
            raise serializers.ValidationError(
                {"disponible": "Elige al menos una asignatura para estar disponible."}
            )
        return attrs


class HorarioDisponibilidadSerializer(serializers.ModelSerializer):
    dia_semana = serializers.IntegerField(min_value=0, max_value=6)

    class Meta:
        model = HorarioDisponibilidadTutor
        fields = ["dia_semana", "hora_inicio", "hora_fin"]

    def validate(self, attrs):
        if attrs["hora_inicio"] >= attrs["hora_fin"]:
            raise serializers.ValidationError("La hora de fin debe ser posterior al inicio.")
        return attrs


class BloqueoDisponibilidadSerializer(serializers.ModelSerializer):
    class Meta:
        model = BloqueoDisponibilidadTutor
        fields = ["id", "fecha", "hora_inicio", "hora_fin", "motivo"]
        read_only_fields = ["id"]

    def validate(self, attrs):
        if attrs["hora_inicio"] >= attrs["hora_fin"]:
            raise serializers.ValidationError("La hora de fin debe ser posterior al inicio.")
        return attrs


class ActualizarDisponibilidadTutorSerializer(serializers.Serializer):
    horarios = HorarioDisponibilidadSerializer(many=True, allow_empty=True)
    bloqueos = BloqueoDisponibilidadSerializer(many=True, allow_empty=True)

    def validate_horarios(self, horarios):
        ordenados = sorted(horarios, key=lambda h: (h["dia_semana"], h["hora_inicio"]))
        for anterior, actual in zip(ordenados, ordenados[1:], strict=False):
            if (
                anterior["dia_semana"] == actual["dia_semana"]
                and actual["hora_inicio"] < anterior["hora_fin"]
            ):
                raise serializers.ValidationError("Los horarios del mismo día no pueden cruzarse.")
        return horarios

    def validate_bloqueos(self, bloqueos):
        ordenados = sorted(bloqueos, key=lambda b: (b["fecha"], b["hora_inicio"]))
        for anterior, actual in zip(ordenados, ordenados[1:], strict=False):
            if (
                anterior["fecha"] == actual["fecha"]
                and actual["hora_inicio"] < anterior["hora_fin"]
            ):
                raise serializers.ValidationError("Los bloqueos de una fecha no pueden cruzarse.")
        return bloqueos


class HabilitacionSerializer(serializers.Serializer):
    habilitado = serializers.BooleanField()


class CambiarEstadoSerializer(serializers.Serializer):
    activo = serializers.BooleanField()
    motivo = serializers.CharField(required=False, allow_blank=True, max_length=200)


def _limpiar_nombre(valor):
    return " ".join(valor.split())  # sin espacios sobrantes ni dobles


class ActualizarDatosPersonalesSerializer(serializers.Serializer):
    """Datos que la propia persona puede cambiar. El correo, el rol y el estado no se editan."""

    nombres = serializers.CharField(max_length=150)
    apellidos = serializers.CharField(max_length=150)

    def validate_nombres(self, valor):
        return self._no_vacio(_limpiar_nombre(valor))

    def validate_apellidos(self, valor):
        return self._no_vacio(_limpiar_nombre(valor))

    @staticmethod
    def _no_vacio(valor):
        if not valor:
            raise serializers.ValidationError("Este campo no puede estar vacío.")
        return valor


class GradoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Grado
        fields = ["id", "nombre"]
        read_only_fields = fields


class GrupoSerializer(serializers.ModelSerializer):
    grado = GradoSerializer(read_only=True)

    class Meta:
        model = Grupo
        fields = ["id", "nombre", "grado"]
        read_only_fields = fields


class GradoConGruposSerializer(serializers.ModelSerializer):
    grupos = serializers.SerializerMethodField()

    class Meta:
        model = Grado
        fields = ["id", "nombre", "grupos"]
        read_only_fields = fields

    def get_grupos(self, grado):
        return [{"id": g.pk, "nombre": g.nombre} for g in grado.grupos.all() if g.activo]


class FichaEstudianteSerializer(serializers.ModelSerializer):
    usuario = UsuarioResumenSerializer(read_only=True)
    grupo = GrupoSerializer(read_only=True)
    grado = GradoSerializer(read_only=True)
    trabajos_pendientes = serializers.SerializerMethodField()

    class Meta:
        model = PerfilEstudiante
        fields = ["id", "usuario", "grado", "grupo", "trabajos_pendientes"]
        read_only_fields = fields

    def get_trabajos_pendientes(self, ficha):
        # Viene anotado por la vista (una sola consulta para toda la lista).
        return getattr(ficha, "trabajos_pendientes", 0)


class FiltroEstudiantesSerializer(serializers.Serializer):
    q = serializers.CharField(required=False, allow_blank=True, max_length=100)
    grado = serializers.IntegerField(required=False, min_value=1)
    grupo = serializers.IntegerField(required=False, min_value=1)
    sin_grupo = serializers.BooleanField(required=False)


class AsignarGrupoSerializer(serializers.Serializer):
    grupo = serializers.IntegerField(min_value=1, allow_null=True)

    def validate_grupo(self, valor):
        if valor is None:
            return None
        grupo = Grupo.objects.select_related("grado").filter(pk=valor).first()
        if grupo is None or not grupo.activo or not grupo.grado.activo:
            raise serializers.ValidationError("El grupo no existe o no está activo.")
        return grupo
