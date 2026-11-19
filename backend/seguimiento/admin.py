from django.contrib import admin

from .models import (
    Asistencia,
    CambioNota,
    EvaluacionPosterior,
    ReglaAcademica,
    Resultado,
    TrabajoPendiente,
)


class CambioNotaInline(admin.TabularInline):
    model = CambioNota
    extra = 0
    can_delete = False
    readonly_fields = ["valor_anterior", "valor_nuevo", "motivo", "cambiado_por", "fecha"]

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Resultado)
class ResultadoAdmin(admin.ModelAdmin):
    list_display = ["estudiante", "asignatura", "periodo", "valor"]
    list_filter = ["periodo", "asignatura"]
    search_fields = ["estudiante__email", "estudiante__apellidos"]
    autocomplete_fields = ["estudiante"]
    inlines = [CambioNotaInline]


@admin.register(Asistencia)
class AsistenciaAdmin(admin.ModelAdmin):
    list_display = ["estudiante", "fecha", "estado"]
    list_filter = ["estado", "fecha"]
    search_fields = ["estudiante__email", "estudiante__apellidos"]
    autocomplete_fields = ["estudiante"]


@admin.register(TrabajoPendiente)
class TrabajoPendienteAdmin(admin.ModelAdmin):
    list_display = ["estudiante", "asignatura", "descripcion", "fecha_limite", "entregado"]
    list_filter = ["entregado", "asignatura", "periodo"]
    search_fields = ["estudiante__email", "descripcion"]
    autocomplete_fields = ["estudiante"]


@admin.register(ReglaAcademica)
class ReglaAcademicaAdmin(admin.ModelAdmin):
    list_display = ["nombre", "tipo", "umbral", "severidad", "activa"]
    list_filter = ["tipo", "severidad", "activa"]


@admin.register(EvaluacionPosterior)
class EvaluacionPosteriorAdmin(admin.ModelAdmin):
    list_display = ["plan", "nota_inicial", "nota_posterior", "fecha_registro"]
    search_fields = ["plan__estudiante__email", "plan__asignatura__nombre"]
