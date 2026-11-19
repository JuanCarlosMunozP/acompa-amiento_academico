from django.urls import path

from . import views

urlpatterns = [
    path("institucion/", views.institucion, name="institucion"),
    path("sedes/", views.sedes, name="sedes"),
    path("sedes/<int:pk>/", views.sede, name="sede"),
    path("admin/grados/", views.grados, name="admin-grados"),
    path("admin/grados/<int:pk>/", views.grado, name="admin-grado"),
    path("admin/grupos/", views.grupos, name="admin-grupos"),
    path("admin/grupos/<int:pk>/", views.grupo, name="admin-grupo"),
    path("admin/asignaturas/", views.asignaturas, name="admin-asignaturas"),
    path("admin/asignaturas/<int:pk>/", views.asignatura, name="admin-asignatura"),
    path("periodos/", views.periodos, name="periodos"),
    path("periodos/actual/", views.periodo_actual, name="periodo-actual"),
    path("periodos/<int:pk>/", views.periodo, name="periodo"),
    path("dias-no-habiles/", views.dias_no_habiles, name="dias-no-habiles"),
    path("dias-no-habiles/verificar/", views.verificar_dia, name="verificar-dia"),
    path("dias-no-habiles/<int:pk>/", views.dia_no_habil, name="dia-no-habil"),
    path("matriculas/", views.matriculas, name="matriculas"),
    path("matriculas/carga/", views.carga_de_matriculas, name="carga-de-matriculas"),
    path("matriculas/<int:pk>/", views.matricula, name="matricula"),
]
