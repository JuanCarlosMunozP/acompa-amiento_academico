import re

from rest_framework import serializers

from .models import PlantillaCorreoPlan
from .plantillas_correo import VARIABLES_PLANTILLA, sanitizar_html

VARIABLE = re.compile(r"{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}")


class PlantillaCorreoPlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlantillaCorreoPlan
        fields = ["clave", "asunto", "cuerpo_texto", "cuerpo_html", "actualizado"]
        read_only_fields = ["clave", "actualizado"]

    def validate_asunto(self, valor):
        self._validar_variables(valor)
        return valor

    def validate_cuerpo_texto(self, valor):
        self._validar_variables(valor)
        return valor

    def validate_cuerpo_html(self, valor):
        self._validar_variables(valor)
        if sanitizar_html(valor) != valor:
            raise serializers.ValidationError(
                "El HTML solo puede usar etiquetas y enlaces seguros."
            )
        return valor

    @staticmethod
    def _validar_variables(valor):
        encontrados = set(VARIABLE.findall(valor))
        desconocidos = encontrados - VARIABLES_PLANTILLA
        if desconocidos:
            raise serializers.ValidationError(
                f"Variables no permitidas: {', '.join(sorted(desconocidos))}."
            )
        sin_variables = VARIABLE.sub("", valor)
        if "{{" in sin_variables or "}}" in sin_variables:
            raise serializers.ValidationError("Usa variables con el formato {{ nombre }}.")
