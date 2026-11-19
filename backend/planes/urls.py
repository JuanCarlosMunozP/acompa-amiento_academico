from django.urls import path

from . import views, views_nivelacion, views_plantillas

urlpatterns = [
    path("plantillas-correo/", views_plantillas.plantillas_correo, name="plantillas-correo"),
    path(
        "plantillas-correo/<str:clave>/",
        views_plantillas.plantilla_correo,
        name="plantilla-correo",
    ),
    path("mis-notificaciones/", views.mis_notificaciones, name="mis-notificaciones"),
    path(
        "mis-preferencias-notificacion/",
        views.mis_preferencias_notificacion,
        name="mis-preferencias-notificacion",
    ),
    path("notificaciones/<int:pk>/leer/", views.leer_notificacion, name="notificacion-leer"),
    path("agenda-sesiones/", views.agenda_sesiones, name="agenda-sesiones"),
    path("mi-desempeno-tutorias/", views.mi_desempeno_tutorias, name="mi-desempeno-tutorias"),
    path("informes-bitacoras/", views.informes_bitacoras, name="informes-bitacoras"),
    path(
        "informes-bitacoras/<int:pk>/",
        views.editar_informe_bitacora,
        name="editar-informe-bitacora",
    ),
    path("sesiones/<int:pk>/cerrar/", views.cerrar_sesion, name="sesion-cerrar"),
    path("sesiones/<int:pk>/materiales/", views.subir_material_sesion, name="sesion-materiales"),
    path(
        "sesiones/<int:pk>/materiales/<int:material_pk>/descargar/",
        views.descargar_material_sesion,
        name="sesion-material-descargar",
    ),
    path("sesiones/<int:pk>/cancelar/", views.cancelar_sesion, name="sesion-cancelar"),
    path("sesiones/<int:pk>/", views.reprogramar_sesion, name="sesion-reprogramar"),
    path(
        "sesiones/<int:pk>/asistencia/", views.registrar_asistencia_sesion, name="sesion-asistencia"
    ),
    path("planes/", views.planes, name="planes"),
    path("planes/contadores/", views.contadores, name="planes-contadores"),
    path("planes/<int:pk>/", views.plan, name="plan"),
    path("planes/<int:pk>/cancelar/", views.cancelar_plan, name="plan-cancelar"),
    path("planes/<int:pk>/tutores-elegibles/", views.tutores_del_plan, name="plan-tutores"),
    path("planes/<int:pk>/tutor/", views.asignar_tutor_al_plan, name="plan-tutor"),
    path("planes/<int:pk>/seguimiento/", views.seguimiento_del_plan, name="plan-seguimiento"),
    path(
        "planes/<int:pk>/disponibilidad/", views.disponibilidad_del_plan, name="plan-disponibilidad"
    ),
    path("planes/<int:pk>/sesiones/", views.sesiones_del_plan, name="plan-sesiones"),
    path("planes/<int:pk>/actividades/", views.actividades_del_plan, name="plan-actividades"),
    path("planes/<int:pk>/cerrar/", views.cerrar_plan, name="plan-cerrar"),
    path("actividades/<int:pk>/", views.actividad, name="actividad"),
    path("mis-planes/", views.mis_planes, name="mis-planes"),
    path("planes/<int:pk>/dudas/", views_nivelacion.dudas_del_plan, name="plan-dudas"),
    path(
        "planes/<int:pk>/observaciones/",
        views_nivelacion.observaciones_del_plan,
        name="plan-observaciones",
    ),
    path("planes/<int:pk>/visto-bueno/", views_nivelacion.visto_bueno, name="plan-visto-bueno"),
    path("planes/<int:pk>/reporte/", views_nivelacion.reporte_del_plan, name="plan-reporte"),
    path(
        "actividades/<int:pk>/entregas/",
        views_nivelacion.entregas_de_actividad,
        name="actividad-entregas",
    ),
    path(
        "entregas/<int:pk>/retroalimentacion/",
        views_nivelacion.retroalimentar_entrega,
        name="entrega-retroalimentacion",
    ),
    path(
        "entregas/<int:pk>/descargar/", views_nivelacion.descargar_entrega, name="entrega-descargar"
    ),
]
