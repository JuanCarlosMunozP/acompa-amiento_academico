from django.contrib import admin
from django.urls import include, path

from common.views import api_index, auth_index, favicon, health, root

handler404 = "common.exceptions.not_found"
handler500 = "common.exceptions.server_error"

api_patterns = [
    path("", api_index, name="api-index"),
    path("health/", health, name="health"),
    path("auth/", auth_index, name="auth-index"),
    path("auth/", include("usuarios.urls")),
    path("", include("usuarios.urls_roles")),
    path("", include("usuarios.urls_tutores")),
    path("", include("usuarios.urls_estudiantes")),
    path("", include("usuarios.urls_acudientes")),
    path("", include("academico.urls")),
    path("", include("seguimiento.urls")),
    path("", include("planes.urls")),
]

urlpatterns = [
    path("", root, name="root"),
    path("favicon.ico", favicon, name="favicon"),
    path("admin/", admin.site.urls),
    path("api/", include(api_patterns)),
]
