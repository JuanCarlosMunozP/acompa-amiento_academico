from django.utils import timezone
from rest_framework import serializers

from academico.models import Matricula, PeriodoAcademico
from academico.servicios import validar_dia_habil
from seguimiento.models import NOTA_APROBACION, NOTA_MAXIMA, NOTA_MINIMA
from usuarios.models import Asignatura, BloqueoDisponibilidadTutor, PerfilTutor, Usuario
from usuarios.roles import Rol

from .models import (
    ActividadPlan,
    AsignacionPlan,
    BitacoraSesion,
    DudaPlan,
    EntregaActividad,
    MaterialSesion,
    NotificacionAcompanamiento,
    ObservacionCoordinacion,
    PlanRefuerzo,
    RetroalimentacionEntrega,
    SesionTutoria,
)


class PlanSerializer(serializers.ModelSerializer):
    """Lectura de un plan con los nombres que la app necesita mostrar."""

    estudiante_nombre = serializers.CharField(source="estudiante.nombre_completo", read_only=True)
    asignatura_nombre = serializers.CharField(source="asignatura.nombre", read_only=True)
    periodo_nombre = serializers.CharField(source="periodo.nombre", read_only=True)
    tutor_nombre = serializers.SerializerMethodField()
    docente_nombre = serializers.SerializerMethodField()
    visto_bueno = serializers.SerializerMethodField()
    visto_bueno_por_nombre = serializers.SerializerMethodField()
    actividades_total = serializers.SerializerMethodField()
    actividades_completadas = serializers.SerializerMethodField()
    progreso = serializers.SerializerMethodField()
    atrasado = serializers.SerializerMethodField()

    class Meta:
        model = PlanRefuerzo
        fields = [
            "id",
            "estudiante",
            "estudiante_nombre",
            "periodo",
            "periodo_nombre",
            "asignatura",
            "asignatura_nombre",
            "objetivos",
            "desempenos_no_alcanzados",
            "fecha_inicio",
            "fecha_fin",
            "estado",
            "tutor",
            "tutor_nombre",
            "docente_nombre",
            "fecha_creacion",
            "resultado",
            "fecha_cierre",
            "nota_cierre",
            "nota_final",
            "visto_bueno",
            "visto_bueno_fecha",
            "visto_bueno_por_nombre",
            "actividades_total",
            "actividades_completadas",
            "progreso",
            "atrasado",
        ]
        read_only_fields = fields

    def get_tutor_nombre(self, plan):
        return plan.tutor.nombre_completo if plan.tutor_id else None

    def get_docente_nombre(self, plan):
        return self.get_tutor_nombre(plan)

    def get_visto_bueno(self, plan):
        return plan.visto_bueno_fecha is not None

    def get_visto_bueno_por_nombre(self, plan):
        return plan.visto_bueno_por.nombre_completo if plan.visto_bueno_por_id else None

    def _conteo(self, plan, nombre):
        """Usa el conteo ya calculado en la consulta; si no viene, lo calcula."""
        if hasattr(plan, f"actividades_{nombre}"):
            return getattr(plan, f"actividades_{nombre}")
        hoy = timezone.localdate()
        actividades = plan.actividades.all()
        return {
            "total": actividades.count(),
            "completadas": actividades.filter(completada=True).count(),
            "vencidas": actividades.filter(completada=False, fecha_limite__lt=hoy).count(),
        }[nombre]

    def get_actividades_total(self, plan):
        return self._conteo(plan, "total")

    def get_actividades_completadas(self, plan):
        return self._conteo(plan, "completadas")

    def get_progreso(self, plan):
        """Porcentaje de actividades completadas; `null` si el plan aún no tiene actividades."""
        total = self._conteo(plan, "total")
        if not total:
            return None
        return round(self._conteo(plan, "completadas") * 100 / total, 1)

    def get_atrasado(self, plan):
        """Plan asignado con actividades vencidas sin cumplir, o con la fecha de fin ya pasada."""
        if plan.estado != PlanRefuerzo.Estado.ASIGNADO:
            return False
        return self._conteo(plan, "vencidas") > 0 or plan.fecha_fin < timezone.localdate()


class CrearPlanSerializer(serializers.Serializer):
    """Registra un expediente (todos los campos) o edita uno (`partial`).

    Al editar solo cambian objetivos, desempeños no alcanzados y fechas.
    """

    estudiante = serializers.PrimaryKeyRelatedField(
        queryset=Usuario.objects.filter(rol=Rol.ESTUDIANTE, is_active=True)
    )
    asignatura = serializers.PrimaryKeyRelatedField(queryset=Asignatura.objects.filter(activa=True))
    periodo = serializers.PrimaryKeyRelatedField(
        queryset=PeriodoAcademico.objects.all(), required=False
    )
    objetivos = serializers.CharField(max_length=1000, trim_whitespace=True)
    desempenos_no_alcanzados = serializers.CharField(max_length=1500, trim_whitespace=True)
    fecha_inicio = serializers.DateField()
    fecha_fin = serializers.DateField()

    def validate(self, datos):
        plan = self.instance
        if plan is not None:
            # Al editar solo cambian objetivos, desempeños y fechas.
            for campo in ("estudiante", "asignatura", "periodo"):
                datos.pop(campo, None)
            estudiante, asignatura, periodo = plan.estudiante, plan.asignatura, plan.periodo
        else:
            estudiante, asignatura = datos["estudiante"], datos["asignatura"]
            periodo = datos.get("periodo") or PeriodoAcademico.actual()
            if periodo is None:
                raise serializers.ValidationError(
                    {"periodo": ["Indica un periodo: hoy no hay uno vigente."]}
                )
            datos["periodo"] = periodo

        inicio = datos.get("fecha_inicio", plan.fecha_inicio if plan else None)
        fin = datos.get("fecha_fin", plan.fecha_fin if plan else None)
        if fin < inicio:
            raise serializers.ValidationError(
                {"fecha_fin": ["La fecha de fin no puede ser anterior a la de inicio."]}
            )
        if inicio < periodo.fecha_inicio or inicio > periodo.fecha_fin:
            raise serializers.ValidationError(
                {"fecha_inicio": [f"Debe estar dentro del periodo «{periodo.nombre}»."]}
            )
        if fin > periodo.fecha_fin:
            raise serializers.ValidationError(
                {"fecha_fin": [f"No puede superar el fin del periodo «{periodo.nombre}»."]}
            )
        if "fecha_inicio" in datos:
            validar_dia_habil(inicio, "fecha_inicio")

        if plan is None:
            if not Matricula.objects.filter(
                estudiante=estudiante, periodo=periodo, estado=Matricula.Estado.ACTIVA
            ).exists():
                raise serializers.ValidationError(
                    {"estudiante": ["El estudiante no tiene una matrícula activa en ese periodo."]}
                )
            if PlanRefuerzo.objects.filter(
                estudiante=estudiante,
                asignatura=asignatura,
                periodo=periodo,
                estado__in=PlanRefuerzo.VIGENTES,
            ).exists():
                raise serializers.ValidationError(
                    {
                        "asignatura": [
                            "El estudiante ya tiene un plan de refuerzo vigente en esta "
                            "asignatura y periodo."
                        ]
                    }
                )
        return datos

    def create(self, datos):
        return PlanRefuerzo.objects.create(**datos)

    def update(self, plan, datos):
        for campo, valor in datos.items():
            setattr(plan, campo, valor)
        plan.save()
        return plan


class TutorAsignadoSerializer(serializers.Serializer):
    tutor = serializers.PrimaryKeyRelatedField(
        queryset=Usuario.objects.filter(rol=Rol.TUTOR, is_active=True)
    )


class AsignacionSerializer(serializers.ModelSerializer):
    tutor_nombre = serializers.SerializerMethodField()
    asignado_por_nombre = serializers.SerializerMethodField()

    class Meta:
        model = AsignacionPlan
        fields = ["id", "tutor", "tutor_nombre", "asignado_por_nombre", "fecha", "notificado"]
        read_only_fields = fields

    def get_tutor_nombre(self, fila):
        return fila.tutor.nombre_completo if fila.tutor_id else None

    def get_asignado_por_nombre(self, fila):
        return fila.asignado_por.nombre_completo if fila.asignado_por_id else None


class ActividadSerializer(serializers.ModelSerializer):
    """Crea y edita actividades; la fecha se valida contra el plan (`context["plan"]`)."""

    vencida = serializers.SerializerMethodField()
    titulo = serializers.CharField(max_length=120, trim_whitespace=True)
    descripcion = serializers.CharField(
        max_length=500, required=False, allow_blank=True, trim_whitespace=True
    )

    class Meta:
        model = ActividadPlan
        fields = [
            "id",
            "titulo",
            "descripcion",
            "fecha_limite",
            "completada",
            "fecha_completada",
            "vencida",
        ]
        read_only_fields = ["id", "fecha_completada", "vencida"]

    def get_vencida(self, actividad):
        return not actividad.completada and actividad.fecha_limite < timezone.localdate()

    def validate_fecha_limite(self, fecha):
        plan = self.context["plan"]
        if fecha < plan.fecha_inicio or fecha > plan.fecha_fin:
            raise serializers.ValidationError(
                f"Debe estar entre el inicio ({plan.fecha_inicio}) y el fin ({plan.fecha_fin}) "
                "del plan."
            )
        return fecha

    def validate(self, datos):
        if "fecha_limite" in datos:
            validar_dia_habil(datos["fecha_limite"], "fecha_limite")
        return datos

    def update(self, actividad, datos):
        if "completada" in datos and datos["completada"] != actividad.completada:
            actividad.fecha_completada = timezone.now() if datos["completada"] else None
        return super().update(actividad, datos)


class CerrarPlanSerializer(serializers.Serializer):
    """Cierre del expediente: valoración descriptiva y nota cuantitativa de 1,0 a 5,0."""

    valoracion = serializers.CharField(max_length=500, trim_whitespace=True)
    nota_final = serializers.DecimalField(
        max_digits=3, decimal_places=2, min_value=NOTA_MINIMA, max_value=NOTA_MAXIMA
    )
    # Si no se indica, se deduce de la nota: aprobatoria = logrado; menor = no logrado.
    resultado = serializers.ChoiceField(choices=PlanRefuerzo.Resultado.choices, required=False)
    # Cerrar con actividades sin cumplir exige confirmarlo expresamente.
    forzar = serializers.BooleanField(required=False, default=False)

    def validate(self, datos):
        datos.setdefault(
            "resultado",
            PlanRefuerzo.Resultado.LOGRADO
            if datos["nota_final"] >= NOTA_APROBACION
            else PlanRefuerzo.Resultado.NO_LOGRADO,
        )
        return datos


class DudaSerializer(serializers.ModelSerializer):
    autor_nombre = serializers.CharField(source="autor.nombre_completo", read_only=True)
    autor_rol = serializers.CharField(source="autor.rol", read_only=True)
    texto = serializers.CharField(max_length=1000, trim_whitespace=True)
    respuesta_a = serializers.PrimaryKeyRelatedField(
        queryset=DudaPlan.objects.all(), required=False, allow_null=True
    )

    class Meta:
        model = DudaPlan
        fields = ["id", "autor", "autor_nombre", "autor_rol", "texto", "respuesta_a", "creada"]
        read_only_fields = ["id", "autor", "autor_nombre", "autor_rol", "creada"]

    def validate_respuesta_a(self, duda):
        plan = self.context["plan"]
        if duda is not None and duda.plan_id != plan.pk:
            raise serializers.ValidationError("La duda indicada no pertenece a este expediente.")
        return duda


class RetroalimentacionSerializer(serializers.ModelSerializer):
    docente_nombre = serializers.SerializerMethodField()
    comentario = serializers.CharField(max_length=1000, trim_whitespace=True)

    class Meta:
        model = RetroalimentacionEntrega
        fields = ["id", "docente_nombre", "comentario", "requiere_correccion", "fecha"]
        read_only_fields = ["id", "docente_nombre", "fecha"]

    def get_docente_nombre(self, fila):
        return fila.docente.nombre_completo if fila.docente_id else None


class EntregaSerializer(serializers.ModelSerializer):
    retroalimentacion = serializers.SerializerMethodField()
    archivo_nombre = serializers.SerializerMethodField()

    class Meta:
        model = EntregaActividad
        fields = [
            "id",
            "actividad",
            "tipo",
            "archivo_nombre",
            "comentario",
            "fecha",
            "retroalimentacion",
        ]
        read_only_fields = fields

    def get_archivo_nombre(self, entrega):
        return entrega.archivo.name.rsplit("/", 1)[-1]

    def get_retroalimentacion(self, entrega):
        retro = getattr(entrega, "retroalimentacion", None)
        return RetroalimentacionSerializer(retro).data if retro else None


class ObservacionCoordinacionSerializer(serializers.ModelSerializer):
    autor_nombre = serializers.SerializerMethodField()
    texto = serializers.CharField(max_length=1000, trim_whitespace=True)

    class Meta:
        model = ObservacionCoordinacion
        fields = ["id", "autor_nombre", "texto", "creada"]
        read_only_fields = ["id", "autor_nombre", "creada"]

    def get_autor_nombre(self, fila):
        return fila.autor.nombre_completo if fila.autor_id else None


class BitacoraSesionSerializer(serializers.ModelSerializer):
    creada_por_nombre = serializers.CharField(source="creada_por.nombre_completo", read_only=True)

    class Meta:
        model = BitacoraSesion
        fields = [
            "temas",
            "desarrollo",
            "acuerdos",
            "observaciones",
            "fecha_cierre",
            "creada_por_nombre",
        ]
        read_only_fields = ["fecha_cierre", "creada_por_nombre"]


class InformeBitacoraSerializer(BitacoraSesionSerializer):
    sesion = serializers.PrimaryKeyRelatedField(read_only=True)
    estudiante = serializers.CharField(
        source="sesion.plan.estudiante.nombre_completo", read_only=True
    )
    asignatura = serializers.CharField(source="sesion.plan.asignatura.nombre", read_only=True)
    tutor = serializers.CharField(source="sesion.tutor.nombre_completo", read_only=True)
    grado = serializers.SerializerMethodField()
    fecha_sesion = serializers.DateTimeField(source="sesion.inicio", read_only=True)

    def get_grado(self, obj):
        perfil = getattr(obj.sesion.plan.estudiante, "perfil_estudiante", None)
        if perfil is None or perfil.grupo_id is None:
            return ""
        return perfil.grupo.grado.nombre

    class Meta(BitacoraSesionSerializer.Meta):
        fields = [
            "id",
            "sesion",
            "estudiante",
            "grado",
            "asignatura",
            "tutor",
            "fecha_sesion",
            "temas",
            "desarrollo",
            "acuerdos",
            "observaciones",
            "fecha_cierre",
            "creada_por_nombre",
        ]
        read_only_fields = fields


class MaterialSesionSerializer(serializers.ModelSerializer):
    class Meta:
        model = MaterialSesion
        fields = ["id", "titulo", "descripcion", "fecha_creacion"]
        read_only_fields = fields


class SesionTutoriaSerializer(serializers.ModelSerializer):
    tutor_nombre = serializers.CharField(source="tutor.nombre_completo", read_only=True)
    estudiante_nombre = serializers.CharField(
        source="plan.estudiante.nombre_completo", read_only=True
    )
    asignatura_nombre = serializers.CharField(source="plan.asignatura.nombre", read_only=True)
    inasistencias_tutorias = serializers.SerializerMethodField()
    bitacora = BitacoraSesionSerializer(read_only=True)
    materiales = MaterialSesionSerializer(many=True, read_only=True)

    class Meta:
        model = SesionTutoria
        fields = [
            "id",
            "plan",
            "tutor",
            "tutor_nombre",
            "estudiante_nombre",
            "asignatura_nombre",
            "inicio",
            "fin",
            "modalidad",
            "lugar",
            "enlace_virtual",
            "notas",
            "estado",
            "motivo_cancelacion",
            "asistencia",
            "asistencia_fecha",
            "inasistencias_tutorias",
            "bitacora",
            "materiales",
        ]
        read_only_fields = [
            "id",
            "plan",
            "tutor",
            "estado",
            "asistencia",
            "asistencia_fecha",
            "inasistencias_tutorias",
        ]

    def get_inasistencias_tutorias(self, obj):
        return SesionTutoria.objects.filter(
            plan__estudiante_id=obj.plan.estudiante_id,
            asistencia=SesionTutoria.Asistencia.AUSENTE,
        ).count()


class CrearSesionTutoriaSerializer(serializers.ModelSerializer):
    class Meta:
        model = SesionTutoria
        fields = ["inicio", "fin", "modalidad", "lugar", "enlace_virtual", "notas"]

    def validate(self, attrs):
        if self.instance:
            attrs = {
                "inicio": self.instance.inicio,
                "fin": self.instance.fin,
                "modalidad": self.instance.modalidad,
                "lugar": self.instance.lugar,
                "enlace_virtual": self.instance.enlace_virtual,
                "notas": self.instance.notas,
                **attrs,
            }
        plan = self.context["plan"]
        inicio, fin = attrs["inicio"], attrs["fin"]
        if inicio >= fin:
            raise serializers.ValidationError({"fin": "Debe ser posterior al inicio."})
        if inicio <= timezone.now():
            raise serializers.ValidationError({"inicio": "La sesión debe quedar en el futuro."})
        if timezone.localtime(inicio).date() != timezone.localtime(fin).date():
            raise serializers.ValidationError(
                {"fin": "Una sesión debe comenzar y terminar el mismo día."}
            )
        if timezone.localtime(inicio).date() < plan.fecha_inicio:
            raise serializers.ValidationError({"inicio": "La sesión debe quedar dentro del plan."})
        if timezone.localtime(fin).date() > plan.fecha_fin:
            raise serializers.ValidationError({"fin": "La sesión debe quedar dentro del plan."})
        if (
            attrs["modalidad"] == SesionTutoria.Modalidad.PRESENCIAL
            and not attrs.get("lugar", "").strip()
        ):
            raise serializers.ValidationError({"lugar": "Indica el lugar de la sesión presencial."})
        if (
            attrs["modalidad"] == SesionTutoria.Modalidad.VIRTUAL
            and not attrs.get("enlace_virtual", "").strip()
        ):
            raise serializers.ValidationError(
                {"enlace_virtual": "Indica el enlace de la sesión virtual."}
            )

        perfil = PerfilTutor.objects.filter(usuario_id=plan.tutor_id).first()
        if perfil is None or not perfil.habilitado or not perfil.disponible:
            raise serializers.ValidationError(
                {"tutor": "El tutor asignado no está habilitado y disponible."}
            )

        inicio_local, fin_local = timezone.localtime(inicio), timezone.localtime(fin)
        dentro_horario = perfil.horarios_disponibilidad.filter(
            dia_semana=inicio_local.weekday(),
            hora_inicio__lte=inicio_local.time().replace(tzinfo=None),
            hora_fin__gte=fin_local.time().replace(tzinfo=None),
        ).exists()
        if not dentro_horario:
            raise serializers.ValidationError(
                {"inicio": "La sesión debe estar dentro del horario semanal del tutor."}
            )

        bloqueada = BloqueoDisponibilidadTutor.objects.filter(
            perfil=perfil,
            fecha=inicio_local.date(),
            hora_inicio__lt=fin_local.time().replace(tzinfo=None),
            hora_fin__gt=inicio_local.time().replace(tzinfo=None),
        ).exists()
        if bloqueada:
            raise serializers.ValidationError(
                {"inicio": "El tutor tiene un bloqueo en ese horario."}
            )

        otras_sesiones = (
            SesionTutoria.objects.exclude(pk=self.instance.pk)
            if self.instance
            else SesionTutoria.objects.all()
        )
        cruces_tutor = otras_sesiones.filter(
            tutor_id=plan.tutor_id,
            estado=SesionTutoria.Estado.PROGRAMADA,
            inicio__lt=fin,
            fin__gt=inicio,
        ).exists()
        cruces_estudiante = otras_sesiones.filter(
            plan__estudiante_id=plan.estudiante_id,
            estado=SesionTutoria.Estado.PROGRAMADA,
            inicio__lt=fin,
            fin__gt=inicio,
        ).exists()
        if cruces_tutor:
            raise serializers.ValidationError(
                {"inicio": "El tutor ya tiene otra sesión en ese horario."}
            )
        if cruces_estudiante:
            raise serializers.ValidationError(
                {"inicio": "El estudiante ya tiene otra sesión en ese horario."}
            )
        return attrs

    def create(self, validated_data):
        return SesionTutoria.objects.create(
            plan=self.context["plan"], tutor=self.context["plan"].tutor, **validated_data
        )


class CancelarSesionSerializer(serializers.Serializer):
    motivo = serializers.CharField(max_length=500, allow_blank=False, trim_whitespace=True)


class AsistenciaSesionSerializer(serializers.Serializer):
    estado = serializers.ChoiceField(
        choices=[
            SesionTutoria.Asistencia.PRESENTE,
            SesionTutoria.Asistencia.AUSENTE,
            SesionTutoria.Asistencia.EXCUSA,
        ]
    )


class CerrarSesionSerializer(serializers.Serializer):
    temas = serializers.CharField(max_length=2000, required=False, allow_blank=True)
    desarrollo = serializers.CharField(max_length=4000, allow_blank=False, trim_whitespace=True)
    acuerdos = serializers.CharField(max_length=2000, required=False, allow_blank=True)
    observaciones = serializers.CharField(max_length=2000, required=False, allow_blank=True)


class PreferenciaNotificacionItemSerializer(serializers.Serializer):
    tipo = serializers.ChoiceField(choices=NotificacionAcompanamiento.Tipo.choices)
    habilitada = serializers.BooleanField()


class ActualizarPreferenciasNotificacionSerializer(serializers.Serializer):
    preferencias = PreferenciaNotificacionItemSerializer(many=True, allow_empty=False)

    def validate_preferencias(self, preferencias):
        tipos = [preferencia["tipo"] for preferencia in preferencias]
        if len(tipos) != len(set(tipos)):
            raise serializers.ValidationError("No repitas el tipo de aviso.")
        return preferencias
