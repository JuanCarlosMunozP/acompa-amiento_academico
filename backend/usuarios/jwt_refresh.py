"""Renovación de sesión que también respeta la revocación de dispositivos."""

from rest_framework_simplejwt.exceptions import InvalidToken
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView

from .dispositivos import dispositivo_activo


class RefreshSerializerConDispositivo(TokenRefreshSerializer):
    def validate(self, attrs):
        try:
            refresh = RefreshToken(attrs["refresh"])
        except Exception:
            return super().validate(attrs)  # SimpleJWT responde su error habitual
        huella = refresh.get("did")
        if huella and not dispositivo_activo(refresh.get(api_settings.USER_ID_CLAIM), huella):
            raise InvalidToken("Este dispositivo ya no está autorizado.")
        return super().validate(attrs)


class RefreshConDispositivo(TokenRefreshView):
    serializer_class = RefreshSerializerConDispositivo
