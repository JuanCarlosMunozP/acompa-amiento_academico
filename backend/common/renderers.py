from decimal import Decimal

from rest_framework.renderers import JSONRenderer
from rest_framework.utils.encoders import JSONEncoder


class CodificadorDecimalComoTexto(JSONEncoder):
    """Los `Decimal` se envían como texto («3.50»), igual que los campos decimales de los
    serializadores. Así notas, promedios y porcentajes llegan al cliente con el mismo formato
    y sin errores de redondeo de coma flotante."""

    def default(self, obj):
        if isinstance(obj, Decimal):
            return str(obj)
        return super().default(obj)


# En JSON `<`, `>` y `&` solo aparecen dentro de textos, así que escaparlos no cambia los
# datos (el cliente los recibe igual al parsear) pero impide que un navegador que interprete
# la respuesta como HTML ejecute un `<script>` guardado en la base.
_ESCAPES_HTML = {ord("<"): "\\u003c", ord(">"): "\\u003e", ord("&"): "\\u0026"}


class JSONRendererApi(JSONRenderer):
    encoder_class = CodificadorDecimalComoTexto

    def render(self, data, accepted_media_type=None, renderer_context=None):
        cuerpo = super().render(data, accepted_media_type, renderer_context)
        if not cuerpo:
            return cuerpo
        return cuerpo.decode("utf-8").translate(_ESCAPES_HTML).encode("utf-8")
