"""Vistas para consultar roles y administrar usuarios con los permisos adecuados."""

from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from planes.models import PlanRefuerzo

from .gestion_estado import cambiar_estado
from .gestion_roles import asignar_rol, puede_consultar_rol
from .models import Usuario
from .permisos import (
    EsAdministrador,
    EsAdministradorOCoordinador,
    capacidad_requerida,
)
from .roles import DESCRIPCIONES, Rol, catalogo
from .serializers import (
    AsignarRolSerializer,
    CambiarEstadoSerializer,
    FiltroUsuariosSerializer,
    UsuarioListaSerializer,
)


def _datos_rol(usuario):
    rol = Rol(usuario.rol)
    return {
        "id": usuario.pk,
        "email": usuario.email,
        "rol": rol.value,
        "rol_nombre": rol.label,
        "descripcion": DESCRIPCIONES[rol],
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def listar_roles(request):
    """Catálogo de roles institucionales."""
    return Response(catalogo())


@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def rol_de_usuario(request, pk):
    """GET: consulta el rol de un usuario. PUT: lo asigna (solo administradores)."""
    objetivo = get_object_or_404(Usuario, pk=pk)

    if request.method == "GET":
        if not puede_consultar_rol(request.user, objetivo):
            raise PermissionDenied("No puedes consultar el rol de otra persona.")
        return Response(_datos_rol(objetivo))

    if not EsAdministrador().has_permission(request, None):
        raise PermissionDenied(EsAdministrador.message)
    serializer = AsignarRolSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    asignar_rol(objetivo, serializer.validated_data["rol"], por=request.user)
    objetivo.refresh_from_db()
    return Response(_datos_rol(objetivo))


class PaginaUsuarios(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 50


@api_view(["GET"])
@permission_classes([capacidad_requerida("consultar_usuarios")])
def listar_usuarios(request):
    """Lista usuarios institucionales o, para tutores, sus estudiantes asignados."""
    # partial=True: en una URL, un booleano ausente no debe interpretarse como `false`.
    filtros = FiltroUsuariosSerializer(data=request.query_params, partial=True)
    filtros.is_valid(raise_exception=True)
    q = filtros.validated_data.get("q", "").strip()
    rol = filtros.validated_data.get("rol")

    if request.user.rol == Rol.TUTOR:
        estudiantes_asignados = PlanRefuerzo.objects.filter(
            tutor=request.user,
            estado=PlanRefuerzo.Estado.ASIGNADO,
        ).values("estudiante_id")
        usuarios = Usuario.objects.filter(
            pk__in=estudiantes_asignados,
            rol=Rol.ESTUDIANTE,
            is_active=True,
        )
    else:
        usuarios = Usuario.objects.all()
    if q:
        usuarios = usuarios.filter(
            Q(email__icontains=q) | Q(nombres__icontains=q) | Q(apellidos__icontains=q)
        )
    if rol:
        usuarios = usuarios.filter(rol=rol)
    if "activo" in filtros.validated_data:
        usuarios = usuarios.filter(is_active=filtros.validated_data["activo"])

    paginador = PaginaUsuarios()
    pagina = paginador.paginate_queryset(usuarios.order_by("apellidos", "nombres", "id"), request)
    return paginador.get_paginated_response(UsuarioListaSerializer(pagina, many=True).data)


@api_view(["GET", "PUT"])
@permission_classes([EsAdministradorOCoordinador])
def estado_de_usuario(request, pk):
    """GET: estado de la cuenta. PUT: la activa o desactiva (solo administradores)."""
    objetivo = get_object_or_404(Usuario, pk=pk)

    if request.method == "PUT":
        if not EsAdministrador().has_permission(request, None):
            raise PermissionDenied(EsAdministrador.message)
        datos = CambiarEstadoSerializer(data=request.data)
        datos.is_valid(raise_exception=True)
        cambiar_estado(
            objetivo,
            datos.validated_data["activo"],
            por=request.user,
            motivo=datos.validated_data.get("motivo", "").strip(),
        )
        objetivo.refresh_from_db()

    return Response({"id": objetivo.pk, "email": objetivo.email, "activo": objetivo.is_active})
