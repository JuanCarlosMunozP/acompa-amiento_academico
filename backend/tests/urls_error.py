"""URLs de prueba: las reales más una ruta que falla, para ejercitar el manejador de errores 500."""

from django.urls import path
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from config.urls import handler404, handler500  # noqa: F401
from config.urls import urlpatterns as urlpatterns_reales


@api_view(["GET"])
@permission_classes([AllowAny])
def falla(request):
    raise RuntimeError("dato-interno-que-no-debe-salir")


@api_view(["GET"])
@permission_classes([AllowAny])
def sin_problema(request):
    return Response({"ok": True})


urlpatterns = [
    path("api/prueba/falla/", falla),
    path("api/prueba/ok/", sin_problema),
    *urlpatterns_reales,
]
