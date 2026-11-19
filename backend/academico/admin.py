from django.contrib import admin

from .models import DiaNoHabil, Institucion, Matricula, PeriodoAcademico, Sede


@admin.register(Institucion)
class InstitucionAdmin(admin.ModelAdmin):
    list_display = ["nombre", "ciudad", "telefono"]

    def has_add_permission(self, request):
        return not Institucion.objects.exists()  # es un registro único

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Sede)
class SedeAdmin(admin.ModelAdmin):
    list_display = ["nombre", "direccion", "activa", "principal"]
    list_filter = ["activa"]
    search_fields = ["nombre", "direccion"]


@admin.register(PeriodoAcademico)
class PeriodoAcademicoAdmin(admin.ModelAdmin):
    list_display = ["nombre", "fecha_inicio", "fecha_fin"]


@admin.register(Matricula)
class MatriculaAdmin(admin.ModelAdmin):
    list_display = ["estudiante", "periodo", "grupo", "estado"]
    list_filter = ["periodo", "estado", "grupo__grado"]
    search_fields = ["estudiante__email", "estudiante__nombres", "estudiante__apellidos"]
    autocomplete_fields = ["estudiante", "grupo"]


@admin.register(DiaNoHabil)
class DiaNoHabilAdmin(admin.ModelAdmin):
    list_display = ["fecha", "descripcion"]
    search_fields = ["descripcion"]
