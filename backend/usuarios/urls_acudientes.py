from django.urls import path

from . import views_acudientes

urlpatterns = [
    path("vinculos-acudiente/", views_acudientes.vinculos, name="vinculos-acudiente"),
    path("vinculos-acudiente/<int:pk>/", views_acudientes.vinculo, name="vinculo-acudiente"),
    path(
        "mis-estudiantes-vinculados/",
        views_acudientes.mis_estudiantes_vinculados,
        name="mis-estudiantes-vinculados",
    ),
]
