"""Vistas administrativas para consultar y gestionar perfiles de tutores."""

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .gestion_tutores import cambiar_habilitacion
from .models import (
    Asignatura,
    BloqueoDisponibilidadTutor,
    HorarioDisponibilidadTutor,
    PerfilTutor,
    Usuario,
)
from .permisos import EsAdministradorOCoordinador, EsTutor
from .roles import Rol
from .serializers import (
    ActualizarDisponibilidadTutorSerializer,
    ActualizarPerfilTutorSerializer,
    AsignaturaSerializer,
    BloqueoDisponibilidadSerializer,
    FiltroTutoresSerializer,
    HabilitacionSerializer,
    HorarioDisponibilidadSerializer,
    PerfilTutorSerializer,
)
from .views_roles import PaginaUsuarios


def _perfiles():
    return PerfilTutor.objects.select_related("usuario").prefetch_related("asignaturas")


@api_view(["GET"])
def listar_asignaturas(request):
    """Asignaturas activas que un tutor puede elegir."""
    activas = Asignatura.objects.filter(activa=True)
    return Response(AsignaturaSerializer(activas, many=True).data)


@api_view(["GET", "PATCH"])
@permission_classes([EsTutor])
def mi_perfil_tutor(request):
    """GET: el perfil del tutor autenticado. PATCH: lo actualiza (solo los campos enviados)."""
    perfil, _ = PerfilTutor.objects.get_or_create(usuario=request.user)

    if request.method == "PATCH":
        datos = ActualizarPerfilTutorSerializer(
            data=request.data, context={"perfil": perfil}, partial=True
        )
        datos.is_valid(raise_exception=True)
        cambios = datos.validated_data
        with transaction.atomic():
            for campo in ("biografia", "disponible"):
                if campo in cambios:
                    setattr(perfil, campo, cambios[campo])
            perfil.save()
            if "asignaturas" in cambios:
                perfil.asignaturas.set(cambios["asignaturas"])

    return Response(PerfilTutorSerializer(_perfiles().get(pk=perfil.pk)).data)


@api_view(["GET", "PUT"])
@permission_classes([EsTutor])
def mi_disponibilidad_tutor(request):
    """Lee o reemplaza los horarios semanales y bloqueos puntuales del tutor autenticado."""
    perfil, _ = PerfilTutor.objects.get_or_create(usuario=request.user)
    if request.method == "GET":
        return Response(_serializar_disponibilidad(perfil))

    datos = ActualizarDisponibilidadTutorSerializer(data=request.data)
    datos.is_valid(raise_exception=True)
    horarios = datos.validated_data["horarios"]
    bloqueos = datos.validated_data["bloqueos"]

    # No se permite cambiar la disponibilidad de modo que invalide sesiones futuras ya agendadas.
    from planes.models import SesionTutoria

    ahora = timezone.now()
    sesiones = SesionTutoria.objects.filter(
        tutor=request.user,
        estado=SesionTutoria.Estado.PROGRAMADA,
        fin__gt=ahora,
    )
    for sesion in sesiones:
        inicio = timezone.localtime(sesion.inicio)
        fin = timezone.localtime(sesion.fin)
        dia = inicio.weekday()
        dentro_horario = any(
            h["dia_semana"] == dia
            and h["hora_inicio"] <= inicio.time().replace(tzinfo=None)
            and h["hora_fin"] >= fin.time().replace(tzinfo=None)
            for h in horarios
        )
        bloqueada = any(
            b["fecha"] == inicio.date()
            and b["hora_inicio"] < fin.time().replace(tzinfo=None)
            and b["hora_fin"] > inicio.time().replace(tzinfo=None)
            for b in bloqueos
        )
        if not dentro_horario or bloqueada:
            raise serializers.ValidationError(
                {"horarios": ["No puedes quitar la disponibilidad de una sesión futura agendada."]}
            )

    with transaction.atomic():
        perfil.horarios_disponibilidad.all().delete()
        perfil.bloqueos_disponibilidad.all().delete()
        HorarioDisponibilidadTutor.objects.bulk_create(
            [HorarioDisponibilidadTutor(perfil=perfil, **h) for h in horarios]
        )
        BloqueoDisponibilidadTutor.objects.bulk_create(
            [BloqueoDisponibilidadTutor(perfil=perfil, **b) for b in bloqueos]
        )
    return Response(_serializar_disponibilidad(perfil))


def _serializar_disponibilidad(perfil):
    return {
        "horarios": HorarioDisponibilidadSerializer(
            perfil.horarios_disponibilidad.all(), many=True
        ).data,
        "bloqueos": BloqueoDisponibilidadSerializer(
            perfil.bloqueos_disponibilidad.all(), many=True
        ).data,
    }


@api_view(["GET"])
@permission_classes([EsAdministradorOCoordinador])
def perfil_de_tutor(request, pk):
    """Perfil de un tutor, para la asignación institucional."""
    usuario = get_object_or_404(Usuario, pk=pk, rol=Rol.TUTOR)
    perfil, _ = PerfilTutor.objects.get_or_create(usuario=usuario)
    return Response(PerfilTutorSerializer(_perfiles().get(pk=perfil.pk)).data)


@api_view(["GET"])
@permission_classes([EsAdministradorOCoordinador])
def listar_tutores(request):
    """Tutores activos, con búsqueda (`q`) y filtros `asignatura`, `disponible` y `habilitado`."""
    # partial=True: en una URL, un booleano ausente no debe interpretarse como `false`.
    filtros = FiltroTutoresSerializer(data=request.query_params, partial=True)
    filtros.is_valid(raise_exception=True)
    f = filtros.validated_data

    perfiles = _perfiles().filter(usuario__rol=Rol.TUTOR, usuario__is_active=True)
    q = f.get("q", "").strip()
    if q:
        perfiles = perfiles.filter(
            Q(usuario__email__icontains=q)
            | Q(usuario__nombres__icontains=q)
            | Q(usuario__apellidos__icontains=q)
        )
    if "asignatura" in f:
        perfiles = perfiles.filter(asignaturas__pk=f["asignatura"])
    if "disponible" in f:
        perfiles = perfiles.filter(disponible=f["disponible"])
    if "habilitado" in f:
        perfiles = perfiles.filter(habilitado=f["habilitado"])

    paginador = PaginaUsuarios()
    orden = perfiles.order_by("usuario__apellidos", "usuario__nombres", "pk")
    pagina = paginador.paginate_queryset(orden, request)
    return paginador.get_paginated_response(PerfilTutorSerializer(pagina, many=True).data)


@api_view(["PUT"])
@permission_classes([EsAdministradorOCoordinador])
def habilitacion_de_tutor(request, pk):
    """Habilita o retira la habilitación institucional de un tutor."""
    usuario = get_object_or_404(Usuario, pk=pk, rol=Rol.TUTOR)
    perfil, _ = PerfilTutor.objects.get_or_create(usuario=usuario)
    datos = HabilitacionSerializer(data=request.data)
    datos.is_valid(raise_exception=True)
    cambiar_habilitacion(perfil, datos.validated_data["habilitado"], por=request.user)
    return Response(PerfilTutorSerializer(_perfiles().get(pk=perfil.pk)).data)
