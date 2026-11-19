"""Vistas de consulta de los eventos de auditoría de usuarios y permisos."""

from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes

from .models import EventoAuditoria
from .permisos import EsAdministradorOCoordinador
from .serializers import EventoAuditoriaSerializer
from .views_roles import PaginaUsuarios


class FiltrosAuditoriaSerializer(serializers.Serializer):
    accion = serializers.CharField(required=False, max_length=50)
    recurso = serializers.CharField(required=False, max_length=30)
    recurso_id = serializers.CharField(required=False, max_length=64)
    actor = serializers.IntegerField(required=False, min_value=1)
    desde = serializers.DateField(required=False)
    hasta = serializers.DateField(required=False)

    def validate(self, datos):
        if datos.get("desde") and datos.get("hasta") and datos["desde"] > datos["hasta"]:
            raise serializers.ValidationError(
                {"hasta": "La fecha final debe ser igual o posterior a la inicial."}
            )
        return datos


@api_view(["GET"])
@permission_classes([EsAdministradorOCoordinador])
def consultar_auditoria(request):
    filtros = FiltrosAuditoriaSerializer(data=request.query_params, partial=True)
    filtros.is_valid(raise_exception=True)
    valores = filtros.validated_data
    consulta = EventoAuditoria.objects.select_related("actor")
    for parametro in ("accion", "recurso", "recurso_id"):
        if valores.get(parametro):
            consulta = consulta.filter(**{parametro: valores[parametro]})
    if valores.get("actor"):
        consulta = consulta.filter(actor_id=valores["actor"])
    if valores.get("desde"):
        consulta = consulta.filter(fecha__date__gte=valores["desde"])
    if valores.get("hasta"):
        consulta = consulta.filter(fecha__date__lte=valores["hasta"])
    paginador = PaginaUsuarios()
    pagina = paginador.paginate_queryset(consulta, request)
    return paginador.get_paginated_response(EventoAuditoriaSerializer(pagina, many=True).data)
