from django.urls import path

from . import views

urlpatterns = [
    path(
        "evaluaciones-posteriores/", views.evaluaciones_posteriores, name="evaluaciones-posteriores"
    ),
    path("informes-acompanamiento/", views.informes_acompanamiento, name="informes-acompanamiento"),
    # Notas
    path("notas/", views.notas, name="notas"),
    path("notas/<int:pk>/", views.nota, name="nota"),
    path("notas/<int:pk>/historial/", views.historial_de_nota, name="historial-de-nota"),
    path("mis-notas/", views.mis_notas, name="mis-notas"),
    # Asistencia
    path(
        "asistencia/grupo/<int:grupo_id>/<str:fecha>/",
        views.asistencia_del_dia,
        name="asistencia-del-dia",
    ),
    path(
        "estudiantes/<int:pk>/asistencia/",
        views.asistencia_de_estudiante,
        name="asistencia-de-estudiante",
    ),
    path("mi-asistencia/", views.mi_asistencia, name="mi-asistencia"),
    # Trabajos sin entregar
    path(
        "estudiantes/<int:pk>/trabajos/",
        views.trabajos_de_estudiante,
        name="trabajos-de-estudiante",
    ),
    path("trabajos/<int:pk>/", views.trabajo, name="trabajo"),
    path("mis-trabajos/", views.mis_trabajos, name="mis-trabajos"),
    # Reglas y evaluación
    path("reglas/", views.reglas, name="reglas"),
    path("reglas/<int:pk>/", views.regla, name="regla"),
    path("estudiantes/<int:pk>/ficha-completa/", views.ficha_completa, name="ficha-completa"),
    path(
        "estudiantes/<int:pk>/evaluacion/",
        views.evaluacion_de_estudiante,
        name="evaluacion-de-estudiante",
    ),
    path("mi-evaluacion/", views.mi_evaluacion, name="mi-evaluacion"),
    # Matriz de desempeño
    path("matriz-desempeno/", views.matriz_de_desempeno, name="matriz-de-desempeno"),
]
