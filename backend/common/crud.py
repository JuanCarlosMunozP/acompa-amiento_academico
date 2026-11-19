"""Vistas CRUD genéricas para los catálogos (sedes, grados, asignaturas, periodos...).

Genera funciones (no clases) para que el mapa de rutas y las pruebas de autorización
(`tests/test_autorizacion.py`) las traten igual que el resto de la API. No hay DELETE: los
catálogos se desactivan en vez de borrarse, para no romper el historial que los referencia.
"""

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response


def filtro_booleano(parametro, campo):
    """Filtro de lista por un booleano en la URL (`?activo=true|false`)."""

    def aplicar(consulta, params):
        valor = params.get(parametro)
        if valor is None:
            return consulta
        if valor.lower() in ("true", "1"):
            return consulta.filter(**{campo: True})
        if valor.lower() in ("false", "0"):
            return consulta.filter(**{campo: False})
        raise serializers.ValidationError({parametro: ["Debe ser true o false."]})

    return aplicar


def filtro_entero(parametro, campo):
    """Filtro de lista por un id (`?grado=3`)."""

    def aplicar(consulta, params):
        valor = params.get(parametro)
        if valor is None:
            return consulta
        if not valor.isdigit():
            raise serializers.ValidationError({parametro: ["Debe ser un número."]})
        return consulta.filter(**{campo: int(valor)})

    return aplicar


def guardar(serializador):
    """`save()` que convierte un choque de unicidad de la base en un error 400 legible."""
    try:
        with transaction.atomic():
            return serializador.save()
    except IntegrityError as exc:
        raise serializers.ValidationError(
            {"non_field_errors": ["Ya existe un registro con esos datos."]}
        ) from exc


def vistas_crud(*, modelo, serializer, permiso, ordenar=("pk",), filtros=(), consulta=None):
    """Devuelve `(lista, detalle)`: GET/POST de la colección y GET/PATCH de un elemento."""

    def base():
        return consulta() if consulta else modelo.objects.all()

    @api_view(["GET", "POST"])
    @permission_classes([permiso])
    def lista(request):
        if request.method == "POST":
            datos = serializer(data=request.data, context={"request": request})
            datos.is_valid(raise_exception=True)
            nuevo = guardar(datos)
            return Response(
                serializer(base().get(pk=nuevo.pk), context={"request": request}).data,
                status=status.HTTP_201_CREATED,
            )
        elementos = base()
        for aplicar in filtros:
            elementos = aplicar(elementos, request.query_params)
        return Response(
            serializer(elementos.order_by(*ordenar), many=True, context={"request": request}).data
        )

    @api_view(["GET", "PATCH"])
    @permission_classes([permiso])
    def detalle(request, pk):
        elemento = get_object_or_404(base(), pk=pk)
        if request.method == "PATCH":
            datos = serializer(
                elemento, data=request.data, partial=True, context={"request": request}
            )
            datos.is_valid(raise_exception=True)
            guardar(datos)
            elemento = base().get(pk=pk)
        return Response(serializer(elemento, context={"request": request}).data)

    return lista, detalle
