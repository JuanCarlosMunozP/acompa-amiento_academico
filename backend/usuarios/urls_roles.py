from django.urls import path

from . import views_auditoria, views_roles

urlpatterns = [
    path("auditoria/", views_auditoria.consultar_auditoria, name="auditoria"),
    path("roles/", views_roles.listar_roles, name="roles"),
    path("usuarios/", views_roles.listar_usuarios, name="usuarios"),
    path("usuarios/<int:pk>/estado/", views_roles.estado_de_usuario, name="estado-de-usuario"),
    path("usuarios/<int:pk>/rol/", views_roles.rol_de_usuario, name="rol-de-usuario"),
]
