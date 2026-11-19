from django.urls import path

from . import views, views_dispositivos, views_mfa
from .jwt_refresh import RefreshConDispositivo

urlpatterns = [
    path("mfa/verificar/", views_mfa.verificar, name="mfa-verificar"),
    path("mfa/configurar/", views_mfa.configurar, name="mfa-configurar"),
    path("mfa/activar/", views_mfa.activar, name="mfa-activar"),
    path("mfa/desactivar/", views_mfa.desactivar, name="mfa-desactivar"),
    path("mfa/codigos-recuperacion/", views_mfa.regenerar_codigos, name="mfa-codigos"),
    path("dispositivo/verificar/", views_dispositivos.verificar, name="dispositivo-verificar"),
    path("dispositivos/", views_dispositivos.listar, name="dispositivos"),
    path("dispositivos/<int:pk>/", views_dispositivos.revocar, name="dispositivo-revocar"),
    path("registro/", views.registro, name="registro"),
    path("login/", views.login, name="login"),
    path("verificar-correo/", views.verificar_correo_view, name="verificar-correo"),
    path("reenviar-verificacion/", views.reenviar_verificacion, name="reenviar-verificacion"),
    path("logout/", views.logout, name="logout"),
    path("me/", views.me, name="me"),
    path("recuperar/", views.solicitar_recuperacion_view, name="recuperar"),
    path("recuperar/confirmar/", views.confirmar_recuperacion_view, name="recuperar-confirmar"),
    path("refresh/", RefreshConDispositivo.as_view(), name="refresh"),
]
