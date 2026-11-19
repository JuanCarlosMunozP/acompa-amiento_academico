"""Procesos de acompañamiento y cierre del expediente de nivelación.

Dudas y aclaraciones, entregas y correcciones, retroalimentación, observaciones y visto bueno
de coordinación, y el reporte institucional imprimible.
"""

from django.db import transaction
from django.http import FileResponse, Http404, HttpResponse
from django.shortcuts import get_object_or_404
from django.template.loader import render_to_string
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, parser_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from academico.models import Institucion, Matricula
from usuarios.auditoria import registrar_evento
from usuarios.models import PerfilEstudiante
from usuarios.roles import Rol

from .models import (
    ActividadPlan,
    EntregaActividad,
    NotificacionAcompanamiento,
    PlanRefuerzo,
)
from .serializers import (
    DudaSerializer,
    EntregaSerializer,
    ObservacionCoordinacionSerializer,
    PlanSerializer,
    RetroalimentacionSerializer,
)
from .servicios import (
    consulta_de_planes,
    es_docente_responsable,
    notificar_proceso,
    participantes,
    puede_ver,
)

TAMANO_MAXIMO_ARCHIVO = 20 * 1024 * 1024
EXTENSIONES_PERMITIDAS = {"pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "jpg", "jpeg", "png"}
ES_COORDINACION = (Rol.ADMINISTRADOR, Rol.SUPERADMIN, Rol.COORDINADOR)


def _plan_visible(request, pk):
    """El expediente, o 404 si no existe o el usuario no tiene nada que ver con él."""
    plan = get_object_or_404(consulta_de_planes(), pk=pk)
    if not puede_ver(request.user, plan):
        raise Http404
    return plan


def _actividad_visible(request, pk):
    actividad = get_object_or_404(ActividadPlan.objects.select_related("plan"), pk=pk)
    plan = get_object_or_404(consulta_de_planes(), pk=actividad.plan_id)
    if not puede_ver(request.user, plan):
        raise Http404
    return actividad, plan


def _exigir_abierto(plan):
    if not plan.admite_cambios:
        raise serializers.ValidationError({"estado": ["El expediente ya no admite cambios."]})


def _validar_archivo(archivo):
    if not archivo:
        raise serializers.ValidationError({"archivo": ["Selecciona un archivo."]})
    if archivo.size > TAMANO_MAXIMO_ARCHIVO:
        raise serializers.ValidationError({"archivo": ["El archivo no puede superar 20 MB."]})
    extension = archivo.name.rsplit(".", 1)[-1].lower() if "." in archivo.name else ""
    if extension not in EXTENSIONES_PERMITIDAS:
        raise serializers.ValidationError(
            {"archivo": ["Formato no permitido. Usa PDF, Office o imagen."]}
        )


# ------------------------------------------------------------------ dudas y aclaraciones


@api_view(["GET", "POST"])
def dudas_del_plan(request, pk):
    """GET: dudas y respuestas. POST: las escriben el estudiante y el docente responsable."""
    plan = _plan_visible(request, pk)
    if request.method == "GET":
        dudas = plan.dudas.select_related("autor")
        return Response(DudaSerializer(dudas, many=True).data)

    es_estudiante = request.user.rol == Rol.ESTUDIANTE and plan.estudiante_id == request.user.pk
    if not (es_estudiante or es_docente_responsable(request.user, plan)):
        raise PermissionDenied("Solo el estudiante y el docente responsable escriben dudas.")
    _exigir_abierto(plan)
    datos = DudaSerializer(data=request.data, context={"plan": plan})
    datos.is_valid(raise_exception=True)
    duda = datos.save(plan=plan, autor=request.user)
    if es_estudiante:
        destinatarios, titulo = [plan.tutor], "Nueva duda de un estudiante"
    else:
        destinatarios = [a for a in participantes(plan) if a != request.user]
        titulo = "Respuesta del docente"
    notificar_proceso(
        destinatarios,
        tipo=NotificacionAcompanamiento.Tipo.DUDA,
        titulo=titulo,
        mensaje=f"{plan.asignatura.nombre}: {duda.texto[:200]}",
        plan=plan,
    )
    return Response(DudaSerializer(duda).data, status=status.HTTP_201_CREATED)


# ------------------------------------------------------------ entregas y retroalimentación


@api_view(["GET", "POST"])
@parser_classes([MultiPartParser, FormParser])
def entregas_de_actividad(request, pk):
    """GET: entregas y correcciones con su retroalimentación. POST: las carga el estudiante.

    La primera carga es la entrega; solo se acepta una nueva (corrección) cuando el docente
    pidió corregir la última. Una actividad aceptada no admite más cargas.
    """
    actividad, plan = _actividad_visible(request, pk)
    entregas = actividad.entregas.select_related("retroalimentacion__docente")
    if request.method == "GET":
        return Response(EntregaSerializer(entregas, many=True).data)

    if request.user.rol != Rol.ESTUDIANTE or plan.estudiante_id != request.user.pk:
        raise PermissionDenied("Solo el estudiante carga las entregas de su plan.")
    _exigir_abierto(plan)
    _validar_archivo(request.FILES.get("archivo"))

    with transaction.atomic():
        # Bloquea la actividad para que dos cargas simultáneas no salten la regla de turnos.
        ActividadPlan.objects.select_for_update().get(pk=actividad.pk)
        ultima = entregas.last()
        if ultima is None:
            tipo = EntregaActividad.Tipo.ENTREGA
        elif getattr(ultima, "retroalimentacion", None) is None:
            raise serializers.ValidationError(
                {"actividad": ["Ya cargaste una entrega: espera la retroalimentación del docente."]}
            )
        elif ultima.retroalimentacion.requiere_correccion:
            tipo = EntregaActividad.Tipo.CORRECCION
        else:
            raise serializers.ValidationError(
                {"actividad": ["El docente ya aceptó esta actividad."]}
            )
        entrega = EntregaActividad(
            actividad=actividad,
            estudiante=request.user,
            tipo=tipo,
            archivo=request.FILES["archivo"],
            comentario=request.data.get("comentario", "").strip()[:1000],
        )
        entrega.full_clean(exclude=["archivo"])
        entrega.save()
    notificar_proceso(
        [plan.tutor],
        tipo=NotificacionAcompanamiento.Tipo.ENTREGA,
        titulo="Nueva entrega" if tipo == EntregaActividad.Tipo.ENTREGA else "Nueva corrección",
        mensaje=f"{plan.estudiante.nombre_completo} cargó «{actividad.titulo}».",
        plan=plan,
    )
    return Response(EntregaSerializer(entrega).data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
def retroalimentar_entrega(request, pk):
    """El docente responsable comenta una entrega; si no pide corrección, acepta la actividad."""
    entrega = get_object_or_404(
        EntregaActividad.objects.select_related("actividad__plan", "retroalimentacion"), pk=pk
    )
    plan = get_object_or_404(consulta_de_planes(), pk=entrega.actividad.plan_id)
    if not puede_ver(request.user, plan):
        raise Http404
    if not es_docente_responsable(request.user, plan):
        raise PermissionDenied("Solo el docente responsable retroalimenta las entregas.")
    _exigir_abierto(plan)
    if hasattr(entrega, "retroalimentacion"):
        raise serializers.ValidationError({"entrega": ["Esta entrega ya tiene retroalimentación."]})
    if entrega.actividad.entregas.last().pk != entrega.pk:
        raise serializers.ValidationError(
            {"entrega": ["Solo se retroalimenta la entrega más reciente de la actividad."]}
        )
    datos = RetroalimentacionSerializer(data=request.data)
    datos.is_valid(raise_exception=True)
    with transaction.atomic():
        retro = datos.save(entrega=entrega, docente=request.user)
        if not retro.requiere_correccion:
            actividad = entrega.actividad
            actividad.completada = True
            actividad.fecha_completada = timezone.now()
            actividad.save(update_fields=["completada", "fecha_completada"])
    registrar_evento(
        request.user,
        "entrega.retroalimentada",
        "plan",
        plan.pk,
        {"entrega": entrega.pk, "requiere_correccion": retro.requiere_correccion},
    )
    notificar_proceso(
        [a for a in participantes(plan) if a != request.user],
        tipo=NotificacionAcompanamiento.Tipo.ENTREGA,
        titulo="Retroalimentación del docente",
        mensaje=(
            f"«{entrega.actividad.titulo}»: "
            + ("requiere corrección." if retro.requiere_correccion else "actividad aceptada.")
        ),
        plan=plan,
    )
    return Response(RetroalimentacionSerializer(retro).data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
def descargar_entrega(request, pk):
    entrega = get_object_or_404(EntregaActividad.objects.select_related("actividad"), pk=pk)
    plan = get_object_or_404(consulta_de_planes(), pk=entrega.actividad.plan_id)
    if not puede_ver(request.user, plan):
        raise Http404
    respuesta = FileResponse(
        entrega.archivo.open("rb"),
        as_attachment=True,
        filename=entrega.archivo.name.rsplit("/", 1)[-1],
    )
    respuesta["X-Content-Type-Options"] = "nosniff"
    respuesta["Access-Control-Expose-Headers"] = "Content-Disposition"
    return respuesta


# --------------------------------------------------------- verificación de coordinación


@api_view(["GET", "POST"])
def observaciones_del_plan(request, pk):
    """GET: docente responsable y coordinación. POST: coordinación deja una observación."""
    plan = _plan_visible(request, pk)
    if request.user.rol not in ES_COORDINACION and not es_docente_responsable(request.user, plan):
        raise PermissionDenied("Las observaciones son para el docente responsable y coordinación.")
    if request.method == "GET":
        filas = plan.observaciones_coordinacion.select_related("autor")
        return Response(ObservacionCoordinacionSerializer(filas, many=True).data)

    if request.user.rol not in ES_COORDINACION:
        raise PermissionDenied("Solo coordinación registra observaciones.")
    datos = ObservacionCoordinacionSerializer(data=request.data)
    datos.is_valid(raise_exception=True)
    observacion = datos.save(plan=plan, autor=request.user)
    registrar_evento(request.user, "plan.observacion", "plan", plan.pk)
    notificar_proceso(
        [plan.tutor],
        tipo=NotificacionAcompanamiento.Tipo.PLAN,
        titulo="Observación de coordinación",
        mensaje=f"{plan.estudiante.nombre_completo} · {plan.asignatura.nombre}.",
        plan=plan,
    )
    return Response(
        ObservacionCoordinacionSerializer(observacion).data, status=status.HTTP_201_CREATED
    )


@api_view(["POST"])
def visto_bueno(request, pk):
    """Coordinación da el visto bueno a un expediente cerrado."""
    plan = _plan_visible(request, pk)
    if request.user.rol not in ES_COORDINACION:
        raise PermissionDenied("Solo coordinación da el visto bueno.")
    if plan.estado != PlanRefuerzo.Estado.CERRADO:
        raise serializers.ValidationError(
            {"estado": ["El visto bueno se da cuando el docente cierra el expediente."]}
        )
    if plan.visto_bueno_fecha:
        raise serializers.ValidationError({"estado": ["El expediente ya tiene visto bueno."]})
    plan.visto_bueno_por = request.user
    plan.visto_bueno_fecha = timezone.now()
    plan.save(update_fields=["visto_bueno_por", "visto_bueno_fecha"])
    registrar_evento(request.user, "plan.visto_bueno", "plan", plan.pk)
    notificar_proceso(
        [plan.tutor],
        tipo=NotificacionAcompanamiento.Tipo.CIERRE,
        titulo="Visto bueno de coordinación",
        mensaje=f"{plan.estudiante.nombre_completo} · {plan.asignatura.nombre}.",
        plan=plan,
    )
    return Response(PlanSerializer(consulta_de_planes().get(pk=pk)).data)


# ------------------------------------------------------------------------------ reporte


def _grupo_del_estudiante(plan):
    matricula = (
        Matricula.objects.filter(estudiante_id=plan.estudiante_id, periodo=plan.periodo)
        .select_related("grupo__grado")
        .first()
    )
    grupo = matricula.grupo if matricula else None
    if grupo is None:
        perfil = (
            PerfilEstudiante.objects.filter(usuario_id=plan.estudiante_id)
            .select_related("grupo__grado")
            .first()
        )
        grupo = perfil.grupo if perfil else None
    return grupo


def construir_reporte(plan):
    """Datos del reporte institucional del expediente: identificación, resultado y validación."""
    grupo = _grupo_del_estudiante(plan)
    actividades = []
    entregas_total = correcciones_total = retro_total = 0
    for actividad in plan.actividades.prefetch_related("entregas__retroalimentacion"):
        entregas = list(actividad.entregas.all())
        entregas_total += sum(e.tipo == EntregaActividad.Tipo.ENTREGA for e in entregas)
        correcciones_total += sum(e.tipo == EntregaActividad.Tipo.CORRECCION for e in entregas)
        retro_total += sum(hasattr(e, "retroalimentacion") for e in entregas)
        actividades.append(
            {
                "titulo": actividad.titulo,
                "fecha_limite": actividad.fecha_limite,
                "completada": actividad.completada,
                "entregas": len(entregas),
            }
        )
    observaciones = plan.observaciones_coordinacion.select_related("autor")
    return {
        "institucion": Institucion.obtener().nombre,
        "generado": timezone.localtime(),
        "expediente": plan.pk,
        "identificacion": {
            "periodo": plan.periodo.nombre,
            "fecha_inicio": plan.fecha_inicio,
            "fecha_fin": plan.fecha_fin,
            "fecha_cierre": plan.fecha_cierre,
            "estudiante": plan.estudiante.nombre_completo,
            "grado": grupo.grado.nombre if grupo else "",
            "grupo": grupo.nombre if grupo else "",
            "area": plan.asignatura.nombre,
            "docente": plan.tutor.nombre_completo if plan.tutor_id else "",
        },
        "desempenos_no_alcanzados": plan.desempenos_no_alcanzados,
        "objetivos": plan.objetivos,
        "actividades": actividades,
        "acompanamiento": {
            "dudas": plan.dudas.filter(respuesta_a__isnull=True).count(),
            "entregas": entregas_total,
            "correcciones": correcciones_total,
            "retroalimentaciones": retro_total,
        },
        "resultado": {
            "valoracion": plan.nota_cierre,
            "nota_final": plan.nota_final,
            "resultado": plan.get_resultado_display(),
        },
        "validacion": {
            "visto_bueno": plan.visto_bueno_fecha is not None,
            "visto_bueno_por": plan.visto_bueno_por.nombre_completo
            if plan.visto_bueno_por_id
            else None,
            "visto_bueno_fecha": plan.visto_bueno_fecha,
            "observaciones": [
                {"autor": o.autor.nombre_completo if o.autor_id else "", "texto": o.texto}
                for o in observaciones
            ],
        },
    }


@api_view(["GET"])
def reporte_del_plan(request, pk):
    """Reporte institucional del expediente cerrado. `?formato=html` da la versión imprimible.

    Lo consultan el docente responsable y coordinación; las firmas y el visto bueno se
    completan sobre el reporte impreso.
    """
    plan = _plan_visible(request, pk)
    if request.user.rol not in ES_COORDINACION and not es_docente_responsable(request.user, plan):
        raise PermissionDenied("El reporte es para el docente responsable y coordinación.")
    if plan.estado != PlanRefuerzo.Estado.CERRADO:
        raise serializers.ValidationError(
            {"estado": ["El reporte se genera cuando el docente cierra el expediente."]}
        )
    reporte = construir_reporte(plan)
    registrar_evento(request.user, "reporte.consultado", "plan", plan.pk)
    if request.query_params.get("formato") == "html":
        respuesta = HttpResponse(
            render_to_string("planes/reporte_nivelacion.html", {"r": reporte}),
            content_type="text/html; charset=utf-8",
        )
        respuesta["X-Content-Type-Options"] = "nosniff"
        respuesta["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'"
        return respuesta
    return Response(reporte)
