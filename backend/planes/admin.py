from django.contrib import admin

from .models import (
    AsignacionPlan,
    BitacoraSesion,
    MaterialSesion,
    NotificacionAcompanamiento,
    PlanRefuerzo,
    SesionTutoria,
)


class AsignacionInline(admin.TabularInline):
    model = AsignacionPlan
    extra = 0
    readonly_fields = ["tutor", "asignado_por", "fecha", "notificado"]
    can_delete = False


class SesionInline(admin.TabularInline):
    model = SesionTutoria
    extra = 0
    fields = ["tutor", "inicio", "fin", "modalidad", "estado"]


@admin.register(PlanRefuerzo)
class PlanRefuerzoAdmin(admin.ModelAdmin):
    list_display = ["estudiante", "asignatura", "periodo", "estado", "tutor", "fecha_inicio"]
    list_filter = ["estado", "periodo", "asignatura"]
    search_fields = ["estudiante__email", "estudiante__nombres", "estudiante__apellidos"]
    inlines = [AsignacionInline, SesionInline]


@admin.register(BitacoraSesion)
class BitacoraSesionAdmin(admin.ModelAdmin):
    list_display = ["sesion", "creada_por", "fecha_cierre"]
    search_fields = ["sesion__plan__estudiante__email", "desarrollo", "temas"]


@admin.register(MaterialSesion)
class MaterialSesionAdmin(admin.ModelAdmin):
    list_display = ["titulo", "sesion", "subido_por", "fecha_creacion"]
    search_fields = ["titulo", "descripcion"]


@admin.register(NotificacionAcompanamiento)
class NotificacionAcompanamientoAdmin(admin.ModelAdmin):
    list_display = ["destinatario", "tipo", "titulo", "creada", "leida"]
    list_filter = ["tipo", "leida"]
    search_fields = ["destinatario__email", "titulo", "mensaje"]
