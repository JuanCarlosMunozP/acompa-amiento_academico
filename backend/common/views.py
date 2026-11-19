from django.db import connection
from django.http import HttpResponse, HttpResponseRedirect
from django.urls import URLPattern, URLResolver, get_resolver
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


def root(request):
    """Send browser and container-root requests to the public health endpoint."""
    return HttpResponseRedirect("/api/health/")


def favicon(request):
    """Explicitly report that this API does not provide a favicon."""
    return HttpResponse(status=204)


def _rutas_api(prefijo="api/"):
    """Lista rutas registradas para que los prefijos API sean descubribles."""
    rutas = []

    def recorrer(patrones, ruta_padre=""):
        for patron in patrones:
            ruta = ruta_padre + str(patron.pattern)
            if isinstance(patron, URLResolver):
                recorrer(patron.url_patterns, ruta)
            elif isinstance(patron, URLPattern) and ruta.startswith(prefijo):
                rutas.append({"path": f"/{ruta}", "name": patron.name})

    recorrer(get_resolver().url_patterns)
    return rutas


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def api_index(request):
    """Índice de todas las rutas HTTP registradas bajo /api/."""
    return Response({"api": "/api/", "routes": _rutas_api()})


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def auth_index(request):
    """Índice de rutas de autenticación bajo /api/auth/."""
    return Response({"auth": "/api/auth/", "routes": _rutas_api("api/auth/")})


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def health(request):
    """Estado del servicio. `?db=1` además verifica la conexión a PostgreSQL."""
    body = {"status": "ok"}
    if request.query_params.get("db"):
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            body["database"] = "ok"
        except Exception:
            return Response({"status": "error", "database": "unavailable"}, status=503)
    return Response(body)
