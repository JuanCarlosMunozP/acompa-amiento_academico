"""Vistas para consultar y administrar las plantillas de correo de los planes."""

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from usuarios.auditoria import registrar_evento
from usuarios.permisos import capacidad_requerida

from .models import PlantillaCorreoPlan
from .plantillas_correo import asegurar_plantillas
from .serializers_plantillas import PlantillaCorreoPlanSerializer

GESTIONAR_INSTITUCION = capacidad_requerida("gestionar_institucion")


@api_view(["GET"])
@permission_classes([GESTIONAR_INSTITUCION])
def plantillas_correo(request):
    plantillas = asegurar_plantillas()
    return Response(PlantillaCorreoPlanSerializer(plantillas, many=True).data)


@api_view(["PATCH"])
@permission_classes([GESTIONAR_INSTITUCION])
def plantilla_correo(request, clave):
    asegurar_plantillas()
    plantilla = get_object_or_404(PlantillaCorreoPlan, clave=clave)
    serializer = PlantillaCorreoPlanSerializer(plantilla, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    actualizada = serializer.save(modificado_por=request.user)
    registrar_evento(
        request.user,
        "plantilla_correo.actualizada",
        "plantilla_correo",
        actualizada.clave,
        {"campos": sorted(serializer.validated_data)},
    )
    return Response(
        PlantillaCorreoPlanSerializer(actualizada).data,
        status=status.HTTP_200_OK,
    )
