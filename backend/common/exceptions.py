from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.http import Http404, JsonResponse
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler


def error_body(code, message, details=None):
    body = {"error": {"code": code, "message": message}}
    if details is not None:
        body["error"]["details"] = details
    return body


def _codigo_por_tipo(exc):
    # DRF convierte estas excepciones de Django en 404/403 pero no les deja `detail.code`.
    if isinstance(exc, Http404):
        return "not_found"
    if isinstance(exc, DjangoPermissionDenied):
        return "permission_denied"
    return "error"


def api_exception_handler(exc, context):
    """Formato único de error: {"error": {"code", "message", "details"?}}."""
    response = exception_handler(exc, context)
    if response is None:
        return None

    data = response.data
    if isinstance(exc, ValidationError):
        code, message, details = "validation_error", "Datos inválidos.", data
    else:
        message = data.get("detail", "Error.") if isinstance(data, dict) else str(data)
        code = getattr(getattr(exc, "detail", None), "code", None) or _codigo_por_tipo(exc)
        details = None
    return Response(error_body(code, str(message), details), status=response.status_code)


def not_found(request, exception=None):
    return JsonResponse(error_body("not_found", "Recurso no encontrado."), status=404)


def server_error(request):
    return JsonResponse(error_body("server_error", "Error interno del servidor."), status=500)
