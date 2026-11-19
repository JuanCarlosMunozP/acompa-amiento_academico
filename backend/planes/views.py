"""Vistas de consulta y gestión de planes, sesiones e informes de acompañamiento."""

from django.db.models import Count, Q
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from academico.models import PeriodoAcademico
from usuarios.auditoria import registrar_evento
from usuarios.permisos import (
    EsAdministradorOCoordinador,
    capacidad_requerida,
)
from usuarios.roles import Rol
from usuarios.views_roles import PaginaUsuarios

from .models import (
    ActividadPlan,
    BitacoraSesion,
    MaterialSesion,
    NotificacionAcompanamiento,
    PlanRefuerzo,
    PreferenciaNotificacion,
    SesionTutoria,
)
from .serializers import (
    ActividadSerializer,
    ActualizarPreferenciasNotificacionSerializer,
    AsignacionSerializer,
    AsistenciaSesionSerializer,
    BitacoraSesionSerializer,
    CancelarSesionSerializer,
    CerrarPlanSerializer,
    CerrarSesionSerializer,
    CrearPlanSerializer,
    CrearSesionTutoriaSerializer,
    InformeBitacoraSerializer,
    MaterialSesionSerializer,
    PlanSerializer,
    SesionTutoriaSerializer,
    TutorAsignadoSerializer,
)
from .servicios import (
    asignar_tutor,
    consulta_de_planes,
    es_docente_responsable,
    notificar_proceso,
    participantes,
    puede_gestionar,
    puede_ver,
    responsables_institucionales,
    tutores_elegibles,
)

AUTENTICADOS = capacidad_requerida("consultar_planes_personales")
EXPEDIENTES_PROPIOS = capacidad_requerida("consultar_expedientes_propios")


def _planes():
    return consulta_de_planes()


def _entero(params, nombre):
    valor = params.get(nombre)
    if valor is None:
        return None
    if not valor.isdigit():
        raise serializers.ValidationError({nombre: ["Debe ser un número."]})
    return int(valor)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def planes(request):
    """GET: expedientes con filtros (coordinación). POST: registra un expediente."""
    if request.method == "POST":
        if request.user.rol not in (Rol.TUTOR, Rol.ADMINISTRADOR, Rol.SUPERADMIN, Rol.COORDINADOR):
            raise PermissionDenied(
                "Solo el docente o coordinación registran un expediente de nivelación."
            )
        datos = CrearPlanSerializer(data=request.data)
        datos.is_valid(raise_exception=True)
        nuevo = datos.save(creado_por=request.user)
        registrar_evento(
            request.user,
            "plan.creado",
            "plan",
            nuevo.pk,
            {"estudiante": nuevo.estudiante_id, "asignatura": nuevo.asignatura_id},
        )
        if request.user.rol == Rol.TUTOR:
            # El docente que registra el expediente queda como responsable del acompañamiento.
            asignar_tutor(nuevo, request.user, request.user)
            avisar = [a for a in participantes(nuevo) if a not in (nuevo.estudiante, request.user)]
            notificar_proceso(
                avisar,
                tipo=NotificacionAcompanamiento.Tipo.PLAN,
                titulo="Nuevo plan de nivelación",
                mensaje=f"Se registró un plan de nivelación en {nuevo.asignatura.nombre}.",
                plan=nuevo,
            )
        else:
            notificar_proceso(
                [nuevo.estudiante],
                tipo=NotificacionAcompanamiento.Tipo.PLAN,
                titulo="Nuevo plan de nivelación",
                mensaje=f"Se registró un plan de nivelación en {nuevo.asignatura.nombre}.",
                plan=nuevo,
            )
        return Response(
            PlanSerializer(_planes().get(pk=nuevo.pk)).data, status=status.HTTP_201_CREATED
        )

    if request.user.rol not in (Rol.ADMINISTRADOR, Rol.SUPERADMIN, Rol.COORDINADOR):
        raise PermissionDenied("Solo coordinación puede consultar todos los planes.")

    consulta = _planes()
    for parametro, campo in (
        ("estudiante", "estudiante_id"),
        ("tutor", "tutor_id"),
        ("periodo", "periodo_id"),
        ("asignatura", "asignatura_id"),
    ):
        valor = _entero(request.query_params, parametro)
        if valor is not None:
            consulta = consulta.filter(**{campo: valor})
    if request.query_params.get("atrasado") in ("1", "true"):
        consulta = consulta.filter(estado=PlanRefuerzo.Estado.ASIGNADO).filter(
            Q(actividades_vencidas__gt=0) | Q(fecha_fin__lt=timezone.localdate())
        )
    # El resumen cuenta por estado con los demás filtros aplicados, aunque se filtre por estado.
    resumen = {e.value: 0 for e in PlanRefuerzo.Estado}
    for fila in consulta.order_by().values("estado").annotate(n=Count("id", distinct=True)):
        resumen[fila["estado"]] = fila["n"]
    estado = request.query_params.get("estado")
    if estado:
        if estado not in resumen:
            raise serializers.ValidationError({"estado": ["Estado no válido."]})
        consulta = consulta.filter(estado=estado)
    paginador = PaginaUsuarios()
    pagina = paginador.paginate_queryset(consulta, request)
    respuesta = paginador.get_paginated_response(PlanSerializer(pagina, many=True).data)
    respuesta.data["resumen"] = resumen
    return respuesta


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def plan(request, pk):
    """GET: un plan con su historial (coordinación). PATCH: edita objetivos, desempeños y fechas.

    Coordinación edita mientras no hay docente asignado; el docente responsable, mientras el
    expediente siga en acompañamiento.
    """
    registro = get_object_or_404(_planes(), pk=pk)
    es_coordinacion = request.user.rol in (Rol.ADMINISTRADOR, Rol.SUPERADMIN, Rol.COORDINADOR)
    if request.method == "GET" and not es_coordinacion:
        raise PermissionDenied(EsAdministradorOCoordinador.message)
    if request.method == "PATCH":
        if es_coordinacion:
            if registro.estado != PlanRefuerzo.Estado.PENDIENTE:
                raise serializers.ValidationError(
                    {"estado": ["Solo se edita un plan que aún no tiene docente asignado."]}
                )
        elif request.user.rol == Rol.TUTOR and registro.tutor_id == request.user.pk:
            if not registro.admite_cambios:
                raise serializers.ValidationError(
                    {"estado": ["El expediente ya no admite cambios."]}
                )
        else:
            raise PermissionDenied("Solo el docente responsable o coordinación editan el plan.")
        datos = CrearPlanSerializer(registro, data=request.data, partial=True)
        datos.is_valid(raise_exception=True)
        datos.save()
        registrar_evento(
            request.user,
            "plan.actualizado",
            "plan",
            registro.pk,
            {"campos": sorted(datos.validated_data)},
        )
        registro = get_object_or_404(_planes(), pk=pk)
    return Response(
        {
            **PlanSerializer(registro).data,
            "asignaciones": AsignacionSerializer(
                registro.asignaciones.select_related("tutor", "asignado_por"), many=True
            ).data,
        }
    )


@api_view(["POST"])
@permission_classes([EsAdministradorOCoordinador])
def cancelar_plan(request, pk):
    registro = get_object_or_404(_planes(), pk=pk)
    if registro.estado not in PlanRefuerzo.VIGENTES:
        raise serializers.ValidationError({"estado": ["Solo se cancela un plan vigente."]})
    registro.estado = PlanRefuerzo.Estado.CANCELADO
    registro.save()
    registrar_evento(
        request.user,
        "plan.cancelado",
        "plan",
        registro.pk,
        {"estado_anterior": "pendiente_o_asignado"},
    )
    registro.sesiones.filter(
        estado=SesionTutoria.Estado.PROGRAMADA, inicio__gt=timezone.now()
    ).update(estado=SesionTutoria.Estado.CANCELADA)
    notificar_proceso(
        [registro.estudiante, registro.tutor],
        tipo=NotificacionAcompanamiento.Tipo.CIERRE,
        titulo="Plan cancelado",
        mensaje="El plan de acompañamiento fue cancelado.",
        plan=registro,
    )
    return Response(PlanSerializer(registro).data)


def _tutor_resumen(tutor):
    return {
        "id": tutor.pk,
        "nombre": tutor.nombre_completo,
        "email": tutor.email,
        "carga": tutor.carga,
    }


@api_view(["GET"])
@permission_classes([EsAdministradorOCoordinador])
def tutores_del_plan(request, pk):
    """Tutores a quienes se puede asignar el plan, de menor a mayor carga."""
    registro = get_object_or_404(_planes(), pk=pk)
    return Response([_tutor_resumen(t) for t in tutores_elegibles(registro)])


@api_view(["PUT"])
@permission_classes([EsAdministradorOCoordinador])
def asignar_tutor_al_plan(request, pk):
    """Asigna o reasigna el tutor `{tutor}` y avisa por correo al tutor y al estudiante."""
    registro = get_object_or_404(_planes(), pk=pk)
    if registro.estado not in PlanRefuerzo.VIGENTES:
        raise serializers.ValidationError({"estado": ["El plan no admite cambios de tutor."]})
    datos = TutorAsignadoSerializer(data=request.data)
    datos.is_valid(raise_exception=True)
    tutor = datos.validated_data["tutor"]
    if not tutores_elegibles(registro).filter(pk=tutor.pk).exists():
        return Response(
            {
                "error": {
                    "code": "tutor_no_elegible",
                    "message": (
                        "Ese tutor no puede tomar el plan: debe estar habilitado, disponible "
                        "y dictar la asignatura."
                    ),
                }
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    cambio, notificacion = asignar_tutor(registro, tutor, request.user)
    if cambio:
        registrar_evento(
            request.user,
            "plan.tutor_asignado",
            "plan",
            registro.pk,
            {"tutor": tutor.pk},
        )
    return Response(
        {
            "plan": PlanSerializer(_planes().get(pk=pk)).data,
            "cambio": cambio,
            "notificacion": notificacion,
        }
    )


@api_view(["GET"])
@permission_classes([EXPEDIENTES_PROPIOS])
def mis_planes(request):
    """Docente: sus expedientes en acompañamiento. Estudiante: los suyos. Acudiente: los de los
    estudiantes vinculados."""
    if request.user.rol == Rol.TUTOR:
        consulta = _planes().filter(tutor=request.user, estado=PlanRefuerzo.Estado.ASIGNADO)
    elif request.user.rol == Rol.ACUDIENTE:
        consulta = _planes().filter(
            estudiante__acudientes_vinculados__acudiente=request.user,
            estudiante__is_active=True,
        )
    else:
        consulta = _planes().filter(estudiante=request.user)
    return Response(PlanSerializer(consulta, many=True).data)


# --------------------------------------------------------------------------- seguimiento


def _plan_visible(request, pk):
    """El plan, o 404 si no existe o el usuario no tiene nada que ver con él."""
    plan = get_object_or_404(_planes(), pk=pk)
    if not puede_ver(request.user, plan):
        raise Http404
    return plan


def _progreso(plan):
    actividades = plan.actividades.all()
    return ActividadSerializer(actividades, many=True, context={"plan": plan}).data


@api_view(["GET"])
def seguimiento_del_plan(request, pk):
    """Plan en curso con sus actividades y su avance. Lo ve quien participa o coordina."""
    plan = _plan_visible(request, pk)
    return Response(
        {
            **PlanSerializer(plan).data,
            "puede_gestionar": puede_gestionar(request.user, plan),
            "actividades": _progreso(plan),
            "sesiones": SesionTutoriaSerializer(
                plan.sesiones.select_related("tutor").all(), many=True
            ).data,
        }
    )


@api_view(["GET", "POST"])
def sesiones_del_plan(request, pk):
    """Lista o programa sesiones del plan; las crea el tutor responsable o coordinación."""
    plan = _plan_visible(request, pk)
    if request.method == "GET":
        return Response(
            SesionTutoriaSerializer(
                plan.sesiones.select_related("tutor", "plan__estudiante", "plan__asignatura"),
                many=True,
            ).data
        )
    if not puede_gestionar(request.user, plan):
        raise PermissionDenied("Solo el tutor responsable o coordinación programan sesiones.")
    if plan.estado != PlanRefuerzo.Estado.ASIGNADO or not plan.tutor_id:
        raise serializers.ValidationError(
            {"plan": ["Solo se programan sesiones para un plan con tutor asignado."]}
        )

    # Serializa las altas por tutor para reducir el riesgo de aceptar dos cruces simultáneos.
    from django.contrib.auth import get_user_model
    from django.db import transaction

    with transaction.atomic():
        get_user_model().objects.select_for_update().get(pk=plan.tutor_id)
        datos = CrearSesionTutoriaSerializer(data=request.data, context={"plan": plan})
        datos.is_valid(raise_exception=True)
        nueva = datos.save(creado_por=request.user)
    notificar_proceso(
        [plan.estudiante, plan.tutor],
        tipo=NotificacionAcompanamiento.Tipo.SESION,
        titulo="Nueva sesión de tutoría",
        mensaje=f"Se programó una sesión para {nueva.inicio:%d/%m/%Y %H:%M}.",
        plan=plan,
        sesion=nueva,
    )
    return Response(SesionTutoriaSerializer(nueva).data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
def disponibilidad_del_plan(request, pk):
    """Devuelve la disponibilidad y bloqueos del tutor asignado a un plan visible."""
    plan = _plan_visible(request, pk)
    if not plan.tutor_id:
        return Response({"horarios": [], "bloqueos": []})
    from usuarios.serializers import HorarioDisponibilidadSerializer

    perfil = getattr(plan.tutor, "perfil_tutor", None)
    if perfil is None:
        return Response({"horarios": [], "bloqueos": []})
    return Response(
        {
            "horarios": HorarioDisponibilidadSerializer(
                perfil.horarios_disponibilidad.all(), many=True
            ).data,
            "bloqueos": list(
                perfil.bloqueos_disponibilidad.values("id", "fecha", "hora_inicio", "hora_fin")
            ),
        }
    )


@api_view(["GET"])
@permission_classes([capacidad_requerida("consultar_planes_personales")])
def agenda_sesiones(request):
    """Agenda personal del tutor o sesiones a las que debe asistir el estudiante."""
    sesiones = SesionTutoria.objects.select_related("tutor", "plan__estudiante", "plan__asignatura")
    if request.user.rol == Rol.TUTOR:
        sesiones = sesiones.filter(tutor_id=request.user.pk)
    else:  # la capacidad solo la tienen tutores y estudiantes
        sesiones = sesiones.filter(
            plan__estudiante=request.user,
            estado__in=[SesionTutoria.Estado.PROGRAMADA, SesionTutoria.Estado.REALIZADA],
        )
    return Response(SesionTutoriaSerializer(sesiones, many=True).data)


@api_view(["GET"])
@permission_classes([capacidad_requerida("consultar_planes_personales")])
def mi_desempeno_tutorias(request):
    """Resumen personal: asistencia del estudiante o encuentros realizados por el docente."""
    sesiones = SesionTutoria.objects.all()
    if request.user.rol == Rol.ESTUDIANTE:
        propias = sesiones.filter(plan__estudiante=request.user)
        realizadas = propias.filter(estado=SesionTutoria.Estado.REALIZADA)
        presentes = realizadas.filter(asistencia=SesionTutoria.Asistencia.PRESENTE).count()
        total = realizadas.count()
        return Response(
            {
                "rol": "estudiante",
                "tutorias_programadas": propias.filter(
                    estado=SesionTutoria.Estado.PROGRAMADA
                ).count(),
                "tutorias_realizadas": total,
                "asistencias": presentes,
                "porcentaje_asistencia": round(presentes * 100 / total, 1) if total else None,
            }
        )

    propias = sesiones.filter(tutor=request.user)
    return Response(
        {
            "rol": "tutor",
            "tutorias_realizadas": propias.filter(estado=SesionTutoria.Estado.REALIZADA).count(),
        }
    )


@api_view(["GET"])
@permission_classes([capacidad_requerida("consultar_bitacoras")])
def informes_bitacoras(request):
    """El tutor consulta sus informes; rectoría y coordinación consultan los institucionales."""
    informes = BitacoraSesion.objects.select_related(
        "sesion__plan__estudiante__perfil_estudiante__grupo__grado",
        "sesion__plan__asignatura",
        "sesion__tutor",
        "creada_por",
    )
    if request.user.rol == Rol.TUTOR:
        informes = informes.filter(
            creada_por_id=request.user.pk,
            sesion__tutor_id=request.user.pk,
        )
    filtros_nombres = (
        ("docente", "sesion__tutor"),
        ("estudiante", "sesion__plan__estudiante"),
    )
    for campo, prefijo in filtros_nombres:
        for termino in request.query_params.get(campo, "").split():
            informes = informes.filter(
                Q(**{f"{prefijo}__nombres__icontains": termino})
                | Q(**{f"{prefijo}__apellidos__icontains": termino})
            )
    grado = request.query_params.get("grado", "").strip()
    if grado:
        informes = informes.filter(
            sesion__plan__estudiante__perfil_estudiante__grupo__grado__nombre__icontains=grado
        )
    materia = request.query_params.get("materia", "").strip()
    if materia:
        informes = informes.filter(sesion__plan__asignatura__nombre__icontains=materia)
    return Response(InformeBitacoraSerializer(informes, many=True).data)


@api_view(["PATCH"])
@permission_classes([EsAdministradorOCoordinador])
def editar_informe_bitacora(request, pk):
    """Rectoría y coordinación corrigen informes guardados; no pueden crear informes."""
    informe = get_object_or_404(BitacoraSesion, pk=pk)
    datos = BitacoraSesionSerializer(informe, data=request.data, partial=True)
    datos.is_valid(raise_exception=True)
    informe = datos.save()
    informe = BitacoraSesion.objects.select_related(
        "sesion__plan__estudiante", "sesion__plan__asignatura", "sesion__tutor", "creada_por"
    ).get(pk=informe.pk)
    return Response(InformeBitacoraSerializer(informe).data)


@api_view(["PATCH"])
def reprogramar_sesion(request, pk):
    sesion = get_object_or_404(SesionTutoria.objects.select_related("plan", "tutor"), pk=pk)
    if not puede_ver(request.user, sesion.plan):
        raise Http404
    if not puede_gestionar(request.user, sesion.plan):
        raise PermissionDenied("Solo el tutor responsable o coordinación reprograman sesiones.")
    if sesion.estado != SesionTutoria.Estado.PROGRAMADA:
        raise serializers.ValidationError({"estado": ["Solo se reprograman sesiones activas."]})
    from django.contrib.auth import get_user_model
    from django.db import transaction

    with transaction.atomic():
        get_user_model().objects.select_for_update().get(pk=sesion.tutor_id)
        datos = CrearSesionTutoriaSerializer(
            sesion, data=request.data, partial=True, context={"plan": sesion.plan}
        )
        datos.is_valid(raise_exception=True)
        actualizada = datos.save()
    notificar_proceso(
        [sesion.plan.estudiante, sesion.tutor],
        tipo=NotificacionAcompanamiento.Tipo.SESION,
        titulo="Sesión reprogramada",
        mensaje=f"La sesión quedó para {actualizada.inicio:%d/%m/%Y %H:%M}.",
        plan=sesion.plan,
        sesion=actualizada,
    )
    return Response(SesionTutoriaSerializer(actualizada).data)


@api_view(["POST"])
def cancelar_sesion(request, pk):
    sesion = get_object_or_404(SesionTutoria.objects.select_related("plan", "tutor"), pk=pk)
    if not puede_ver(request.user, sesion.plan):
        raise Http404
    if not puede_gestionar(request.user, sesion.plan):
        raise PermissionDenied("Solo el tutor responsable o coordinación cancelan sesiones.")
    if sesion.estado != SesionTutoria.Estado.PROGRAMADA:
        raise serializers.ValidationError({"estado": ["La sesión ya no está programada."]})
    datos = CancelarSesionSerializer(data=request.data)
    datos.is_valid(raise_exception=True)
    sesion.estado = SesionTutoria.Estado.CANCELADA
    sesion.motivo_cancelacion = datos.validated_data["motivo"]
    sesion.save(update_fields=["estado", "motivo_cancelacion"])
    notificar_proceso(
        [sesion.plan.estudiante, sesion.tutor],
        tipo=NotificacionAcompanamiento.Tipo.SESION,
        titulo="Sesión cancelada",
        mensaje=sesion.motivo_cancelacion,
        plan=sesion.plan,
        sesion=sesion,
    )
    return Response(SesionTutoriaSerializer(sesion).data)


@api_view(["PATCH"])
@permission_classes([capacidad_requerida("confirmar_asistencia_estudiante")])
def registrar_asistencia_sesion(request, pk):
    sesion = get_object_or_404(SesionTutoria.objects.select_related("plan", "tutor"), pk=pk)
    if sesion.plan.estudiante_id != request.user.pk:
        raise Http404
    if sesion.estado == SesionTutoria.Estado.CANCELADA:
        raise serializers.ValidationError({"estado": ["Una sesión cancelada no tiene asistencia."]})
    if sesion.estado != SesionTutoria.Estado.PROGRAMADA:
        raise serializers.ValidationError({"estado": ["La asistencia ya fue registrada."]})
    if sesion.fin > timezone.now():
        raise serializers.ValidationError(
            {"asistencia": ["Registra la asistencia al finalizar la sesión."]}
        )
    datos = AsistenciaSesionSerializer(data=request.data)
    datos.is_valid(raise_exception=True)
    sesion.asistencia = datos.validated_data["estado"]
    sesion.asistencia_registrada_por = request.user
    sesion.asistencia_fecha = timezone.now()
    sesion.estado = SesionTutoria.Estado.REALIZADA
    from django.db import transaction

    with transaction.atomic():
        sesion.save(
            update_fields=["asistencia", "asistencia_registrada_por", "asistencia_fecha", "estado"]
        )
    return Response(SesionTutoriaSerializer(sesion).data)


@api_view(["POST"])
def cerrar_sesion(request, pk):
    """El tutor guarda la bitácora; el estudiante confirma la asistencia por separado."""
    sesion = get_object_or_404(SesionTutoria.objects.select_related("plan", "tutor"), pk=pk)
    if not puede_ver(request.user, sesion.plan):
        raise Http404
    if request.user.rol != Rol.TUTOR or sesion.tutor_id != request.user.pk:
        raise PermissionDenied("Solo el tutor responsable puede crear el informe de la sesión.")
    if sesion.estado == SesionTutoria.Estado.CANCELADA or hasattr(sesion, "bitacora"):
        raise serializers.ValidationError({"estado": ["La sesión ya fue cerrada o cancelada."]})
    if sesion.estado not in (  # pragma: no cover - defensivo: los 3 estados ya están cubiertos
        SesionTutoria.Estado.PROGRAMADA,
        SesionTutoria.Estado.REALIZADA,
    ):
        raise serializers.ValidationError({"estado": ["La sesión no se puede cerrar."]})
    if sesion.plan.estado != PlanRefuerzo.Estado.ASIGNADO:
        raise serializers.ValidationError({"plan": ["El plan ya no está activo."]})
    if sesion.fin > timezone.now():
        raise serializers.ValidationError({"sesion": ["Solo se cierra una sesión que ya terminó."]})
    datos = CerrarSesionSerializer(data=request.data)
    datos.is_valid(raise_exception=True)
    valores = datos.validated_data
    from django.db import transaction

    with transaction.atomic():
        BitacoraSesion.objects.create(
            sesion=sesion,
            creada_por=request.user,
            **{k: valores.get(k, "") for k in ("temas", "desarrollo", "acuerdos", "observaciones")},
        )
    notificar_proceso(
        [sesion.plan.estudiante],
        tipo=NotificacionAcompanamiento.Tipo.CIERRE,
        titulo="Informe de tutoría registrado",
        mensaje="El tutor registró el informe de la sesión.",
        plan=sesion.plan,
        sesion=sesion,
    )
    return Response(SesionTutoriaSerializer(sesion).data)


@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser])
def subir_material_sesion(request, pk):
    sesion = get_object_or_404(SesionTutoria.objects.select_related("plan"), pk=pk)
    if not puede_ver(request.user, sesion.plan):
        raise Http404
    if not puede_gestionar(request.user, sesion.plan):
        raise PermissionDenied("Solo el tutor responsable o coordinación comparten materiales.")
    if sesion.estado == SesionTutoria.Estado.CANCELADA or not sesion.plan.admite_cambios:
        raise serializers.ValidationError(
            {"sesion": ["No se pueden agregar materiales a esta sesión."]}
        )
    archivo = request.FILES.get("archivo")
    if not archivo:
        raise serializers.ValidationError({"archivo": ["Selecciona un archivo."]})
    if archivo.size > 20 * 1024 * 1024:
        raise serializers.ValidationError({"archivo": ["El archivo no puede superar 20 MB."]})
    extensiones = {"pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "jpg", "jpeg", "png"}
    extension = archivo.name.rsplit(".", 1)[-1].lower() if "." in archivo.name else ""
    if extension not in extensiones:
        raise serializers.ValidationError(
            {"archivo": ["Formato no permitido. Usa PDF, Office o imagen."]}
        )
    material = MaterialSesion(
        sesion=sesion,
        titulo=request.data.get("titulo", "").strip() or archivo.name,
        descripcion=request.data.get("descripcion", "").strip(),
        archivo=archivo,
        subido_por=request.user,
    )
    material.full_clean(exclude=["archivo"])
    material.save()
    destinatarios = [sesion.plan.estudiante]
    if request.user != sesion.tutor:
        destinatarios.append(sesion.tutor)
    notificar_proceso(
        destinatarios,
        tipo=NotificacionAcompanamiento.Tipo.MATERIAL,
        titulo="Nuevo material de tutoría",
        mensaje=f"Se compartió: {material.titulo}.",
        plan=sesion.plan,
        sesion=sesion,
    )
    return Response(MaterialSesionSerializer(material).data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
def descargar_material_sesion(request, pk, material_pk):
    material = get_object_or_404(
        MaterialSesion.objects.select_related("sesion__plan"), pk=material_pk, sesion_id=pk
    )
    if not puede_ver(request.user, material.sesion.plan):
        raise Http404
    respuesta = FileResponse(
        material.archivo.open("rb"),
        as_attachment=True,
        filename=material.archivo.name.rsplit("/", 1)[-1],
    )
    respuesta["X-Content-Type-Options"] = "nosniff"
    respuesta["Access-Control-Expose-Headers"] = "Content-Disposition"
    return respuesta


@api_view(["GET", "POST"])
def actividades_del_plan(request, pk):
    """GET: actividades del plan. POST: agrega una (coordinación o tutor responsable)."""
    plan = _plan_visible(request, pk)
    if request.method == "POST":
        if not puede_gestionar(request.user, plan):
            raise PermissionDenied(
                "Solo el tutor responsable o coordinación registran actividades."
            )
        if not plan.admite_cambios:
            raise serializers.ValidationError(
                {"estado": ["Solo se agregan actividades a un plan asignado (no cerrado)."]}
            )
        datos = ActividadSerializer(data=request.data, context={"plan": plan})
        datos.is_valid(raise_exception=True)
        nueva = datos.save(plan=plan, creado_por=request.user)
        return Response(
            ActividadSerializer(nueva, context={"plan": plan}).data, status=status.HTTP_201_CREATED
        )
    return Response(_progreso(plan))


@api_view(["PATCH"])
def actividad(request, pk):
    """Edita una actividad o la marca como completada (coordinación o tutor responsable)."""
    registro = get_object_or_404(ActividadPlan.objects.select_related("plan"), pk=pk)
    plan = get_object_or_404(_planes(), pk=registro.plan_id)
    if not puede_ver(request.user, plan):
        raise Http404
    if not puede_gestionar(request.user, plan):
        raise PermissionDenied("Solo el tutor responsable o coordinación modifican actividades.")
    if not plan.admite_cambios:
        raise serializers.ValidationError({"estado": ["El plan ya no admite cambios."]})
    datos = ActividadSerializer(registro, data=request.data, partial=True, context={"plan": plan})
    datos.is_valid(raise_exception=True)
    datos.save()
    return Response(datos.data)


@api_view(["POST"])
def cerrar_plan(request, pk):
    """Cierra el expediente con `valoracion` y `nota_final` (1,0–5,0); lo hace el docente.

    Con actividades sin cumplir exige `forzar`. Tras el cierre, coordinación da el visto bueno.
    """
    plan = _plan_visible(request, pk)
    if not es_docente_responsable(request.user, plan):
        raise PermissionDenied("Solo el docente responsable cierra el expediente.")
    if plan.estado != PlanRefuerzo.Estado.ASIGNADO:
        raise serializers.ValidationError({"estado": ["Solo se cierra un plan asignado."]})
    datos = CerrarPlanSerializer(data=request.data)
    datos.is_valid(raise_exception=True)
    pendientes = plan.actividades.filter(completada=False).count()
    if pendientes and not datos.validated_data["forzar"]:
        return Response(
            {
                "error": {
                    "code": "actividades_pendientes",
                    "message": (
                        f"Quedan {pendientes} actividad(es) sin cumplir. "
                        "Confirma el cierre para continuar."
                    ),
                }
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    plan.estado = PlanRefuerzo.Estado.CERRADO
    plan.resultado = datos.validated_data["resultado"]
    plan.fecha_cierre = timezone.localdate()
    plan.nota_cierre = datos.validated_data["valoracion"]
    plan.nota_final = datos.validated_data["nota_final"]
    plan.save()
    registrar_evento(
        request.user,
        "plan.cerrado",
        "plan",
        plan.pk,
        {"resultado": plan.resultado, "nota_final": str(plan.nota_final)},
    )
    notificar_proceso(
        participantes(plan),
        tipo=NotificacionAcompanamiento.Tipo.CIERRE,
        titulo="Plan de nivelación cerrado",
        mensaje=f"Resultado: {plan.get_resultado_display()}. Nota: {plan.nota_final}.",
        plan=plan,
    )
    notificar_proceso(
        responsables_institucionales(),
        tipo=NotificacionAcompanamiento.Tipo.CIERRE,
        titulo="Expediente pendiente de visto bueno",
        mensaje=(
            f"{plan.estudiante.nombre_completo} · {plan.asignatura.nombre}: "
            "el docente cerró el proceso y espera la verificación de coordinación."
        ),
        plan=plan,
    )
    plan.sesiones.filter(estado=SesionTutoria.Estado.PROGRAMADA, inicio__gt=timezone.now()).update(
        estado=SesionTutoria.Estado.CANCELADA
    )
    return Response(PlanSerializer(_planes().get(pk=pk)).data)


@api_view(["GET"])
@permission_classes([EsAdministradorOCoordinador])
def contadores(request):
    """Contadores de planes (`?periodo=`; por defecto el vigente, o todos si no hay).

    `en_curso` son los asignados; `recuperados` los cerrados con resultado logrado, y
    `tasa_recuperacion` el porcentaje de recuperados entre los cerrados (`null` si no hay).
    """
    periodo = _entero(request.query_params, "periodo")
    if periodo is None:
        vigente = PeriodoAcademico.actual()
        periodo = vigente.pk if vigente else None
    consulta = _planes().order_by()
    if periodo is not None:
        consulta = consulta.filter(periodo_id=periodo)
    por_estado = {e.value: 0 for e in PlanRefuerzo.Estado}
    for fila in consulta.values("estado").annotate(n=Count("id", distinct=True)):
        por_estado[fila["estado"]] = fila["n"]
    por_resultado = {r.value: 0 for r in PlanRefuerzo.Resultado}
    cerrados = consulta.filter(estado=PlanRefuerzo.Estado.CERRADO)
    for fila in cerrados.values("resultado").annotate(n=Count("id", distinct=True)):
        por_resultado[fila["resultado"]] = fila["n"]
    atrasados = (
        consulta.filter(estado=PlanRefuerzo.Estado.ASIGNADO)
        .filter(Q(actividades_vencidas__gt=0) | Q(fecha_fin__lt=timezone.localdate()))
        .count()
    )
    total_cerrados = por_estado["cerrado"]
    return Response(
        {
            "periodo": periodo,
            "total": sum(por_estado.values()),
            "pendientes": por_estado["pendiente"],
            "en_curso": por_estado["asignado"],
            "atrasados": atrasados,
            "cerrados": total_cerrados,
            "cancelados": por_estado["cancelado"],
            "recuperados": por_resultado["logrado"],
            "parciales": por_resultado["parcial"],
            "no_logrados": por_resultado["no_logrado"],
            "tasa_recuperacion": (
                round(por_resultado["logrado"] * 100 / total_cerrados, 1)
                if total_cerrados
                else None
            ),
        }
    )


@api_view(["GET"])
@permission_classes([capacidad_requerida("consultar_notificaciones_propias")])
def mis_notificaciones(request):
    consulta = NotificacionAcompanamiento.objects.filter(destinatario=request.user)
    tipo = request.query_params.get("tipo")
    if tipo:
        if tipo not in NotificacionAcompanamiento.Tipo.values:
            raise serializers.ValidationError({"tipo": ["Tipo de aviso no válido."]})
        consulta = consulta.filter(tipo=tipo)
    return Response(
        {
            "no_leidas": consulta.filter(leida__isnull=True).count(),
            "resultados": [
                {
                    "id": n.id,
                    "tipo": n.tipo,
                    "titulo": n.titulo,
                    "mensaje": n.mensaje,
                    "creada": n.creada,
                    "leida": n.leida,
                    "plan": n.plan_id,
                    "sesion": n.sesion_id,
                }
                for n in consulta[:100]
            ],
        }
    )


@api_view(["POST"])
@permission_classes([capacidad_requerida("consultar_notificaciones_propias")])
def leer_notificacion(request, pk):
    registro = get_object_or_404(NotificacionAcompanamiento, pk=pk, destinatario=request.user)
    if registro.leida is None:
        registro.leida = timezone.now()
        registro.save(update_fields=["leida"])
    return Response({"id": registro.pk, "leida": registro.leida})


@api_view(["GET", "PATCH"])
@permission_classes([capacidad_requerida("consultar_notificaciones_propias")])
def mis_preferencias_notificacion(request):
    guardadas = {
        preferencia.tipo: preferencia.habilitada
        for preferencia in PreferenciaNotificacion.objects.filter(usuario=request.user)
    }
    if request.method == "PATCH":
        datos = ActualizarPreferenciasNotificacionSerializer(data=request.data)
        datos.is_valid(raise_exception=True)
        from django.db import transaction

        with transaction.atomic():
            for preferencia in datos.validated_data["preferencias"]:
                PreferenciaNotificacion.objects.update_or_create(
                    usuario=request.user,
                    tipo=preferencia["tipo"],
                    defaults={"habilitada": preferencia["habilitada"]},
                )
        guardadas.update(
            {
                preferencia["tipo"]: preferencia["habilitada"]
                for preferencia in datos.validated_data["preferencias"]
            }
        )
    return Response(
        [
            {"tipo": tipo, "nombre": etiqueta, "habilitada": guardadas.get(tipo, True)}
            for tipo, etiqueta in NotificacionAcompanamiento.Tipo.choices
        ]
    )
