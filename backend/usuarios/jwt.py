"""JWT atado al dispositivo: revocar un dispositivo invalida su access al instante.

Este módulo se carga al leer los ajustes de DRF, por eso no importa vistas ni modelos.
"""

from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication


class JWTConDispositivo(JWTAuthentication):
    def get_user(self, validated_token):
        from .dispositivos import dispositivo_activo

        usuario = super().get_user(validated_token)
        huella = validated_token.get("did")
        if huella and not dispositivo_activo(usuario.pk, huella):
            raise AuthenticationFailed(
                "Este dispositivo ya no está autorizado.", "dispositivo_revocado"
            )
        return usuario
