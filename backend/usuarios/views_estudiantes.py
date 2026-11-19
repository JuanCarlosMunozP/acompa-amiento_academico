"""Vistas administrativas para consultar y gestionar estudiantes."""

from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .auditoria import registrar_evento
from .models import Grado, PerfilEstudiante, Usuario
from .permisos import EsAdministradorOCoordinador, EsEstudiante, capacidad_requerida
from .roles import Rol
from .serializers import (
    AsignarGrupoSerializer,
    FichaEstudianteSerializer,
    FiltroEstudiantesSerializer,
    GradoConGruposSerializer,
)
from .views_roles import PaginaUsuarios


def _fichas():
    return PerfilEstudiante.objects.select_related("usuario", "grupo__grado").annotate(
        trabajos_pendientes=Count("usuario__trabajos", filter=Q(usuario__trabajos__entregado=False))
    )


@api_view(["GET"])
def listar_grados(request):
    """Grados activos con sus grupos activos."""
    grados = Grado.objects.filter(activo=True).prefetch_related("grupos")
    return Response(GradoConGruposSerializer(grados, many=True).data)


@api_view(["GET"])
@permission_classes([EsEstudiante])
def mi_ficha(request):
    """Ficha del estudiante autenticado (solo lectura: el grupo lo asigna coordinación)."""
    ficha, _ = PerfilEstudiante.objects.get_or_create(usuario=request.user)
    return Response(FichaEstudianteSerializer(_fichas().get(pk=ficha.pk)).data)


@api_view(["GET", "PATCH"])
@permission_classes([EsAdministradorOCoordinador])
def ficha_de_estudiante(request, pk):
    """GET: ficha de un estudiante. PATCH `{grupo: id | null}`: le asigna o quita el grupo."""
    usuario = get_object_or_404(Usuario, pk=pk, rol=Rol.ESTUDIANTE)
    ficha, _ = PerfilEstudiante.objects.get_or_create(usuario=usuario)

    if request.method == "PATCH":
        datos = AsignarGrupoSerializer(data=request.data)
        datos.is_valid(raise_exception=True)
        ficha.grupo = datos.validated_data["grupo"]
        ficha.save(update_fields=["grupo"])
        registrar_evento(
            request.user,
            "ficha.grupo_actualizado",
            "ficha_estudiante",
            usuario.pk,
            {"grupo": ficha.grupo_id},
        )
    else:
        registrar_evento(request.user, "ficha.consultada", "ficha_estudiante", usuario.pk)

    return Response(FichaEstudianteSerializer(_fichas().get(pk=ficha.pk)).data)


@api_view(["GET"])
@permission_classes([capacidad_requerida("consultar_estudiantes")])
def listar_estudiantes(request):
    """Estudiantes activos, con búsqueda (`q`) y filtros `grado`, `grupo` y `sin_grupo`.

    El docente los consulta para identificar a quién registrar en nivelación; la ficha
    individual sigue limitada a coordinación y a quien tenga un plan con el estudiante.
    """
    # partial=True: en una URL, un booleano ausente no debe interpretarse como `false`.
    filtros = FiltroEstudiantesSerializer(data=request.query_params, partial=True)
    filtros.is_valid(raise_exception=True)
    f = filtros.validated_data

    fichas = _fichas().filter(usuario__rol=Rol.ESTUDIANTE, usuario__is_active=True)
    q = f.get("q", "").strip()
    if q:
        fichas = fichas.filter(
            Q(usuario__email__icontains=q)
            | Q(usuario__nombres__icontains=q)
            | Q(usuario__apellidos__icontains=q)
        )
    if "grado" in f:
        fichas = fichas.filter(grupo__grado_id=f["grado"])
    if "grupo" in f:
        fichas = fichas.filter(grupo_id=f["grupo"])
    if "sin_grupo" in f:
        fichas = fichas.filter(grupo__isnull=f["sin_grupo"])

    paginador = PaginaUsuarios()
    orden = fichas.order_by("usuario__apellidos", "usuario__nombres", "pk")
    pagina = paginador.paginate_queryset(orden, request)
    return paginador.get_paginated_response(FichaEstudianteSerializer(pagina, many=True).data)
