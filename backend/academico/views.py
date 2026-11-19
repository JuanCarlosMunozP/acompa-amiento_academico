"""Vistas de la API para consultar y administrar el dominio académico."""

import datetime

from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import APIException
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from common.crud import filtro_booleano, filtro_entero, guardar, vistas_crud
from usuarios.models import Asignatura, Grado, Grupo
from usuarios.permisos import EsAdministrador, EsAdministradorOCoordinador, permiso_por_metodo
from usuarios.views_roles import PaginaUsuarios

from .models import DiaNoHabil, Institucion, Matricula, PeriodoAcademico, Sede
from .serializers import (
    AsignaturaAdminSerializer,
    DiaNoHabilSerializer,
    GradoAdminSerializer,
    GrupoAdminSerializer,
    InstitucionSerializer,
    MatriculaSerializer,
    PeriodoSerializer,
    SedeSerializer,
)
from .servicios import CargaInvalida, cargar_matriculas, leer_csv, motivo_no_habil

# Cualquier persona con sesión consulta; solo el administrador modifica.
LEE_TODOS_ESCRIBE_ADMIN = permiso_por_metodo(IsAuthenticated, EsAdministrador)
# La coordinación consulta la estructura interna; solo el administrador la modifica.
LEE_COORDINACION_ESCRIBE_ADMIN = permiso_por_metodo(EsAdministradorOCoordinador, EsAdministrador)


class SinPeriodoActual(APIException):
    status_code = status.HTTP_404_NOT_FOUND
    default_detail = "Hoy no hay un periodo académico vigente."
    default_code = "sin_periodo_actual"


# --------------------------------------------------------------------------- institución


@api_view(["GET", "PATCH"])
@permission_classes([LEE_TODOS_ESCRIBE_ADMIN])
def institucion(request):
    """Datos de la institución (registro único)."""
    instancia = Institucion.obtener()
    if request.method == "PATCH":
        datos = InstitucionSerializer(instancia, data=request.data, partial=True)
        datos.is_valid(raise_exception=True)
        instancia = guardar(datos)
    return Response(InstitucionSerializer(instancia).data)


sedes, sede = vistas_crud(
    modelo=Sede,
    serializer=SedeSerializer,
    permiso=LEE_TODOS_ESCRIBE_ADMIN,
    ordenar=("-principal", "nombre"),
    filtros=[filtro_booleano("activa", "activa")],
)

# --------------------------------------------------------------------------- estructura

grados, grado = vistas_crud(
    modelo=Grado,
    serializer=GradoAdminSerializer,
    permiso=LEE_COORDINACION_ESCRIBE_ADMIN,
    ordenar=("orden", "nombre"),
    filtros=[filtro_booleano("activo", "activo")],
    consulta=lambda: Grado.objects.prefetch_related("grupos"),
)

grupos, grupo = vistas_crud(
    modelo=Grupo,
    serializer=GrupoAdminSerializer,
    permiso=LEE_COORDINACION_ESCRIBE_ADMIN,
    ordenar=("grado__orden", "grado__nombre", "nombre"),
    filtros=[filtro_booleano("activo", "activo"), filtro_entero("grado", "grado_id")],
    consulta=lambda: Grupo.objects.select_related("grado"),
)

asignaturas, asignatura = vistas_crud(
    modelo=Asignatura,
    serializer=AsignaturaAdminSerializer,
    permiso=LEE_COORDINACION_ESCRIBE_ADMIN,
    ordenar=("nombre",),
    filtros=[filtro_booleano("activa", "activa")],
)

# --------------------------------------------------------------------------- periodos

periodos, periodo = vistas_crud(
    modelo=PeriodoAcademico,
    serializer=PeriodoSerializer,
    permiso=LEE_TODOS_ESCRIBE_ADMIN,
    ordenar=("-fecha_inicio",),
)


@api_view(["GET"])
def periodo_actual(request):
    """El periodo que incluye la fecha de hoy."""
    actual = PeriodoAcademico.actual()
    if actual is None:
        raise SinPeriodoActual()
    return Response(PeriodoSerializer(actual).data)


# --------------------------------------------------------------------------- calendario


def _filtro_fecha(parametro, operador):
    def aplicar(consulta, params):
        valor = params.get(parametro)
        if valor is None:
            return consulta
        try:
            fecha = datetime.date.fromisoformat(valor)
        except ValueError:
            raise serializers.ValidationError({parametro: ["Usa el formato AAAA-MM-DD."]}) from None
        return consulta.filter(**{f"fecha__{operador}": fecha})

    return aplicar


dias_no_habiles, dia_no_habil = vistas_crud(
    modelo=DiaNoHabil,
    serializer=DiaNoHabilSerializer,
    permiso=LEE_TODOS_ESCRIBE_ADMIN,
    ordenar=("fecha",),
    filtros=[_filtro_fecha("desde", "gte"), _filtro_fecha("hasta", "lte")],
)


@api_view(["GET"])
def verificar_dia(request):
    """¿Es hábil esta fecha (`?fecha=AAAA-MM-DD`)? Para validar antes de programar actividades."""
    try:
        fecha = datetime.date.fromisoformat(request.query_params.get("fecha", ""))
    except ValueError:
        raise serializers.ValidationError(
            {"fecha": ["Indica la fecha con el formato AAAA-MM-DD."]}
        ) from None
    motivo = motivo_no_habil(fecha)
    return Response({"fecha": fecha.isoformat(), "habil": motivo is None, "motivo": motivo})


# --------------------------------------------------------------------------- matrículas


def _matriculas():
    return Matricula.objects.select_related("estudiante", "periodo", "grupo__grado")


@api_view(["GET", "POST"])
@permission_classes([EsAdministradorOCoordinador])
def matriculas(request):
    """GET: matrículas con filtros y paginación. POST: matricula a un estudiante."""
    if request.method == "POST":
        datos = MatriculaSerializer(data=request.data)
        datos.is_valid(raise_exception=True)
        nueva = guardar(datos)
        return Response(
            MatriculaSerializer(_matriculas().get(pk=nueva.pk)).data, status=status.HTTP_201_CREATED
        )

    consulta = _matriculas()
    params = request.query_params
    for filtro in (
        filtro_entero("periodo", "periodo_id"),
        filtro_entero("grupo", "grupo_id"),
        filtro_entero("grado", "grupo__grado_id"),
        filtro_entero("estudiante", "estudiante_id"),
    ):
        consulta = filtro(consulta, params)
    estado = params.get("estado")
    if estado:
        if estado not in Matricula.Estado.values:
            raise serializers.ValidationError({"estado": ["Estado no válido."]})
        consulta = consulta.filter(estado=estado)
    q = params.get("q", "").strip()
    if q:
        consulta = consulta.filter(
            Q(estudiante__email__icontains=q)
            | Q(estudiante__nombres__icontains=q)
            | Q(estudiante__apellidos__icontains=q)
        )
    paginador = PaginaUsuarios()
    pagina = paginador.paginate_queryset(consulta, request)
    return paginador.get_paginated_response(MatriculaSerializer(pagina, many=True).data)


@api_view(["GET", "PATCH"])
@permission_classes([EsAdministradorOCoordinador])
def matricula(request, pk):
    """GET: una matrícula. PATCH: cambia el grupo o la retira/reactiva (`estado`)."""
    elemento = get_object_or_404(_matriculas(), pk=pk)
    if request.method == "PATCH":
        datos = MatriculaSerializer(elemento, data=request.data, partial=True)
        datos.is_valid(raise_exception=True)
        guardar(datos)
        elemento = _matriculas().get(pk=pk)
    return Response(MatriculaSerializer(elemento).data)


@api_view(["POST"])
@permission_classes([EsAdministradorOCoordinador])
def carga_de_matriculas(request):
    """Carga masiva: `{periodo, csv, simular?}`.

    El CSV lleva las columnas correo, nombres, apellidos, grado y grupo.

    Todo o nada: si alguna fila tiene errores no se guarda ninguna. Con `simular: true` solo
    informa qué pasaría.
    """
    periodo = PeriodoAcademico.objects.filter(pk=request.data.get("periodo")).first()
    if periodo is None:
        raise serializers.ValidationError({"periodo": ["Indica un periodo existente."]})
    simular = request.data.get("simular") in (True, "true", "1", 1)
    try:
        filas = leer_csv(request.data.get("csv", ""))
        informe = cargar_matriculas(periodo, filas, simular=simular)
    except CargaInvalida as error:
        raise serializers.ValidationError({"csv": [str(error)]}) from None

    if informe["errores"] and not simular:
        return Response(
            {
                "error": {
                    "code": "carga_invalida",
                    "message": "Hay filas con errores: no se guardó nada. Corrígelas y reintenta.",
                    "details": informe,
                }
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    return Response(informe, status=status.HTTP_200_OK if simular else status.HTTP_201_CREATED)
