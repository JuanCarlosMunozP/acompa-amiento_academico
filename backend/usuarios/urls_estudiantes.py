from django.urls import path

from . import views_estudiantes

urlpatterns = [
    path("grados/", views_estudiantes.listar_grados, name="grados"),
    path("mi-ficha/", views_estudiantes.mi_ficha, name="mi-ficha"),
    path("estudiantes/", views_estudiantes.listar_estudiantes, name="estudiantes"),
    path(
        "estudiantes/<int:pk>/ficha/",
        views_estudiantes.ficha_de_estudiante,
        name="ficha-de-estudiante",
    ),
]
