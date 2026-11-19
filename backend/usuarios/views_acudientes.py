"""Vínculos entre acudientes y estudiantes."""

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .auditoria import registrar_evento
from .models import PerfilEstudiante, Usuario, VinculoAcudiente
from .permisos import capacidad_requerida
from .roles import Rol


class VinculoSerializer(serializers.ModelSerializer):
    acudiente_nombre = serializers.CharField(source="acudiente.nombre_completo", read_only=True)
    estudiante_nombre = serializers.CharField(source="estudiante.nombre_completo", read_only=True)

    class Meta:
        model = VinculoAcudiente
        fields = [
            "id",
            "acudiente",
            "acudiente_nombre",
            "estudiante",
            "estudiante_nombre",
            "parentesco",
            "fecha_creacion",
        ]
        read_only_fields = ["id", "acudiente_nombre", "estudiante_nombre", "fecha_creacion"]

    acudiente = serializers.PrimaryKeyRelatedField(
        queryset=Usuario.objects.filter(rol=Rol.ACUDIENTE, is_active=True)
    )
    estudiante = serializers.PrimaryKeyRelatedField(
        queryset=Usuario.objects.filter(rol=Rol.ESTUDIANTE, is_active=True)
    )
    parentesco = serializers.CharField(max_length=60, required=False, allow_blank=True)


@api_view(["GET", "POST"])
@permission_classes([capacidad_requerida("gestionar_vinculos_acudiente")])
def vinculos(request):
    """GET: vínculos (filtra con `?acudiente=` o `?estudiante=`). POST: crea uno."""
    if request.method == "POST":
        datos = VinculoSerializer(data=request.data)
        datos.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                vinculo = datos.save(creado_por=request.user)
        except IntegrityError:
            raise serializers.ValidationError(
                {"estudiante": ["Ese acudiente ya está vinculado a este estudiante."]}
            ) from None
        registrar_evento(
            request.user,
            "vinculo_acudiente.creado",
            "vinculo_acudiente",
            vinculo.pk,
            {"acudiente": vinculo.acudiente_id, "estudiante": vinculo.estudiante_id},
        )
        return Response(VinculoSerializer(vinculo).data, status=status.HTTP_201_CREATED)

    consulta = VinculoAcudiente.objects.select_related("acudiente", "estudiante")
    for parametro in ("acudiente", "estudiante"):
        valor = request.query_params.get(parametro)
        if valor is not None:
            if not valor.isdigit():
                raise serializers.ValidationError({parametro: ["Debe ser un número."]})
            consulta = consulta.filter(**{f"{parametro}_id": int(valor)})
    return Response(VinculoSerializer(consulta, many=True).data)


@api_view(["DELETE"])
@permission_classes([capacidad_requerida("gestionar_vinculos_acudiente")])
def vinculo(request, pk):
    registro = get_object_or_404(VinculoAcudiente, pk=pk)
    detalles = {"acudiente": registro.acudiente_id, "estudiante": registro.estudiante_id}
    registro.delete()
    registrar_evento(request.user, "vinculo_acudiente.retirado", "vinculo_acudiente", pk, detalles)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
@permission_classes([capacidad_requerida("consultar_estudiantes_vinculados")])
def mis_estudiantes_vinculados(request):
    """Estudiantes a cargo del acudiente autenticado, con su grado y grupo."""
    filas = (
        VinculoAcudiente.objects.filter(acudiente=request.user, estudiante__is_active=True)
        .select_related("estudiante")
        .order_by("estudiante__apellidos", "estudiante__nombres")
    )
    perfiles = {
        p.usuario_id: p
        for p in PerfilEstudiante.objects.filter(
            usuario_id__in=[f.estudiante_id for f in filas]
        ).select_related("grupo__grado")
    }
    return Response(
        [
            {
                "id": f.estudiante_id,
                "nombre": f.estudiante.nombre_completo,
                "parentesco": f.parentesco,
                "grado": perfiles[f.estudiante_id].grupo.grado.nombre
                if f.estudiante_id in perfiles and perfiles[f.estudiante_id].grupo_id
                else None,
                "grupo": perfiles[f.estudiante_id].grupo.nombre
                if f.estudiante_id in perfiles and perfiles[f.estudiante_id].grupo_id
                else None,
            }
            for f in filas
        ]
    )
