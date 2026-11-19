"""Autorización por rol en el backend.

Toda la API exige sesión por defecto (`DEFAULT_PERMISSION_CLASSES = IsAuthenticated`); los
endpoints públicos lo declaran de forma explícita con `AllowAny`. Para limitar un endpoint a
ciertos roles:

    @api_view(["POST"])
    @permission_classes([rol_requerido(Rol.TUTOR, Rol.ADMINISTRADOR)])
    def mi_vista(request): ...

El rol se lee de la base de datos en cada petición, no del token: un cambio de rol (o una
cuenta desactivada) surte efecto de inmediato.
"""

from rest_framework.permissions import SAFE_METHODS, BasePermission

from .roles import Rol

_CAPACIDADES_BASE = {
    "administrar_roles": (Rol.ADMINISTRADOR,),
    "gestionar_institucion": (Rol.ADMINISTRADOR, Rol.COORDINADOR),
    "registrar_seguimiento": (Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.TUTOR),
    "consultar_usuarios": (Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.TUTOR),
    "consultar_planes_personales": (Rol.TUTOR, Rol.ESTUDIANTE),
    "consultar_expedientes_propios": (Rol.TUTOR, Rol.ESTUDIANTE, Rol.ACUDIENTE),
    "registrar_nivelacion": (Rol.TUTOR,),
    "consultar_estudiantes": (Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.TUTOR),
    "verificar_nivelacion": (Rol.ADMINISTRADOR, Rol.COORDINADOR),
    "consultar_reporte_nivelacion": (Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.TUTOR),
    "gestionar_vinculos_acudiente": (Rol.ADMINISTRADOR,),
    "consultar_estudiantes_vinculados": (Rol.ACUDIENTE,),
    "consultar_bitacoras": (Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.TUTOR),
    "consultar_notificaciones_propias": tuple(Rol),
    "gestionar_perfil_tutor": (Rol.TUTOR,),
    "acceder_a_datos_propios_estudiante": (Rol.ESTUDIANTE,),
    "confirmar_asistencia_estudiante": (Rol.ESTUDIANTE,),
}

# El superadministrador hereda cada capacidad del administrador y tiene una propia.
ROLES_POR_CAPACIDAD = {
    capacidad: (*roles, Rol.SUPERADMIN) if Rol.ADMINISTRADOR in roles else roles
    for capacidad, roles in _CAPACIDADES_BASE.items()
}
ROLES_POR_CAPACIDAD["administrar_superadmins"] = (Rol.SUPERADMIN,)

PERMISOS_PILOTO = {
    rol: frozenset(capacidad for capacidad, roles in ROLES_POR_CAPACIDAD.items() if rol in roles)
    for rol in Rol
}


def tiene_rol(usuario, *roles):
    """True si el usuario está autenticado, activo y tiene alguno de los roles."""
    return bool(usuario and usuario.is_authenticated and usuario.is_active and usuario.rol in roles)


def tiene_capacidad(usuario, capacidad):
    """Comprueba la matriz del piloto; el alcance por recurso se valida en cada vista."""
    if capacidad not in ROLES_POR_CAPACIDAD:
        raise ValueError(f"Capacidad no definida: {capacidad}")
    return tiene_rol(usuario, *ROLES_POR_CAPACIDAD[capacidad])


def capacidad_requerida(capacidad):
    """Crea una clase DRF de permiso ligada a una capacidad declarada en la matriz."""
    if capacidad not in ROLES_POR_CAPACIDAD:
        raise ValueError(f"Capacidad no definida: {capacidad}")
    roles = ROLES_POR_CAPACIDAD[capacidad]
    nombres = ", ".join(Rol(r).label.lower() for r in roles)

    class CapacidadRequerida(BasePermission):
        message = f"Esta acción es solo para: {nombres}."

        def has_permission(self, request, view):
            return tiene_capacidad(request.user, capacidad)

    CapacidadRequerida.__name__ = "Capacidad_" + capacidad
    return CapacidadRequerida


def rol_requerido(*roles):
    """Crea una clase de permiso que solo deja pasar a usuarios con alguno de `roles`."""
    if not roles:
        raise ValueError("rol_requerido necesita al menos un rol.")
    nombres = ", ".join(Rol(r).label.lower() for r in roles)

    class RolRequerido(BasePermission):
        message = f"Esta acción es solo para: {nombres}."

        def has_permission(self, request, view):
            return tiene_rol(request.user, *roles)

    RolRequerido.__name__ = "RolRequerido_" + "_".join(roles)
    return RolRequerido


EsAdministrador = capacidad_requerida("administrar_roles")
EsAdministradorOCoordinador = capacidad_requerida("gestionar_institucion")
EsTutor = capacidad_requerida("gestionar_perfil_tutor")
EsEstudiante = capacidad_requerida("acceder_a_datos_propios_estudiante")


def permiso_por_metodo(lectura, escritura):
    """Un permiso para consultar (GET) y otro, normalmente más estricto, para modificar."""

    class PorMetodo(BasePermission):
        def has_permission(self, request, view):
            clase = lectura if request.method in SAFE_METHODS else escritura
            if clase().has_permission(request, view):
                return True
            self.message = getattr(clase, "message", "No tienes permiso para esta acción.")
            return False

    return PorMetodo
