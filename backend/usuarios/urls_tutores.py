from django.urls import path

from . import views_tutores

urlpatterns = [
    path("asignaturas/", views_tutores.listar_asignaturas, name="asignaturas"),
    path("perfil-tutor/", views_tutores.mi_perfil_tutor, name="mi-perfil-tutor"),
    path(
        "perfil-tutor/disponibilidad/",
        views_tutores.mi_disponibilidad_tutor,
        name="mi-disponibilidad-tutor",
    ),
    path("tutores/", views_tutores.listar_tutores, name="tutores"),
    path(
        "tutores/<int:pk>/habilitacion/",
        views_tutores.habilitacion_de_tutor,
        name="habilitacion-de-tutor",
    ),
    path("tutores/<int:pk>/perfil/", views_tutores.perfil_de_tutor, name="perfil-de-tutor"),
]
