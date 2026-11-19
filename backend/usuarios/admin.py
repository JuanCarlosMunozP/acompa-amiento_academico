from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from . import mfa
from .models import (
    Asignatura,
    BloqueoDisponibilidadTutor,
    CambioRol,
    Grado,
    Grupo,
    HorarioDisponibilidadTutor,
    PerfilEstudiante,
    PerfilTutor,
    Usuario,
    VinculoAcudiente,
)


@admin.register(Usuario)
class UsuarioAdmin(UserAdmin):
    ordering = ["email"]
    list_display = [
        "email",
        "nombre_completo",
        "rol",
        "email_verificado",
        "mfa_activo",
        "is_active",
    ]
    list_filter = ["rol", "email_verificado", "mfa_activo", "is_active"]
    search_fields = ["email", "nombres", "apellidos"]
    readonly_fields = ["mfa_activo"]
    actions = ["restablecer_mfa"]

    @admin.action(description="Restablecer verificación en dos pasos (pérdida del dispositivo)")
    def restablecer_mfa(self, request, queryset):
        """Para quien perdió el teléfono y sus códigos de recuperación. Queda auditado."""
        restablecidos = 0
        for usuario in queryset.filter(mfa_activo=True):
            mfa.restablecer(usuario, por=request.user)
            restablecidos += 1
        self.message_user(request, f"MFA restablecido en {restablecidos} cuenta(s).")

    fieldsets = [
        (None, {"fields": ["email", "password"]}),
        ("Datos", {"fields": ["nombres", "apellidos", "rol", "email_verificado", "mfa_activo"]}),
        (
            "Permisos",
            {"fields": ["is_active", "is_staff", "is_superuser", "groups", "user_permissions"]},
        ),
        ("Fechas", {"fields": ["last_login", "fecha_registro"]}),
    ]
    add_fieldsets = [
        (
            None,
            {
                "classes": ["wide"],
                "fields": ["email", "nombres", "apellidos", "rol", "password1", "password2"],
            },
        ),
    ]


@admin.register(CambioRol)
class CambioRolAdmin(admin.ModelAdmin):
    """Historial de solo lectura: los cambios se hacen por la API y quedan registrados."""

    list_display = ["fecha", "usuario", "rol_anterior", "rol_nuevo", "cambiado_por"]
    list_filter = ["rol_nuevo"]
    search_fields = ["usuario__email", "cambiado_por__email"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Asignatura)
class AsignaturaAdmin(admin.ModelAdmin):
    list_display = ["nombre", "activa"]
    list_filter = ["activa"]
    search_fields = ["nombre"]


class HorarioDisponibilidadInline(admin.TabularInline):
    model = HorarioDisponibilidadTutor
    extra = 0


class BloqueoDisponibilidadInline(admin.TabularInline):
    model = BloqueoDisponibilidadTutor
    extra = 0


@admin.register(PerfilTutor)
class PerfilTutorAdmin(admin.ModelAdmin):
    list_display = ["usuario", "disponible"]
    list_filter = ["disponible", "asignaturas"]
    search_fields = ["usuario__email", "usuario__nombres", "usuario__apellidos"]
    filter_horizontal = ["asignaturas"]
    autocomplete_fields = ["usuario"]
    inlines = [HorarioDisponibilidadInline, BloqueoDisponibilidadInline]


class GrupoInline(admin.TabularInline):
    model = Grupo
    extra = 1


@admin.register(Grado)
class GradoAdmin(admin.ModelAdmin):
    list_display = ["nombre", "orden", "activo"]
    list_filter = ["activo"]
    search_fields = ["nombre"]
    inlines = [GrupoInline]


@admin.register(Grupo)
class GrupoAdmin(admin.ModelAdmin):
    list_display = ["__str__", "grado", "activo"]
    list_filter = ["activo", "grado"]
    search_fields = ["nombre", "grado__nombre"]


@admin.register(PerfilEstudiante)
class PerfilEstudianteAdmin(admin.ModelAdmin):
    list_display = ["usuario", "grupo"]
    list_filter = ["grupo__grado", "grupo"]
    search_fields = ["usuario__email", "usuario__nombres", "usuario__apellidos"]
    autocomplete_fields = ["usuario", "grupo"]


@admin.register(VinculoAcudiente)
class VinculoAcudienteAdmin(admin.ModelAdmin):
    """Vincula acudientes con los estudiantes a su cargo (solo consulta del proceso)."""

    list_display = ["acudiente", "estudiante", "parentesco", "fecha_creacion"]
    search_fields = [
        "acudiente__email",
        "acudiente__apellidos",
        "estudiante__email",
        "estudiante__apellidos",
    ]
    autocomplete_fields = ["acudiente", "estudiante"]
