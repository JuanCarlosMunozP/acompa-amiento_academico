from django.db import transaction
from rest_framework import status
from rest_framework.exceptions import APIException

from .auditoria import registrar_evento
from .models import CambioRol, PerfilTutor, Usuario
from .permisos import tiene_rol
from .roles import Rol


class NoPuedesCambiarTuRol(APIException):
    status_code = status.HTTP_403_FORBIDDEN
    default_detail = "No puedes cambiar tu propio rol. Pídeselo a otro administrador."
    default_code = "no_puedes_cambiar_tu_rol"


class SoloSuperadmin(APIException):
    status_code = status.HTTP_403_FORBIDDEN
    default_detail = "Solo un superadministrador puede otorgar, quitar o modificar ese rol."
    default_code = "solo_superadmin"


def exigir_superadmin_si_aplica(objetivo, por, rol_nuevo=None):
    """El rol de superadministrador (otorgarlo, quitarlo o tocar a quien lo tiene) es exclusivo."""
    toca_superadmin = objetivo.rol == Rol.SUPERADMIN or rol_nuevo == Rol.SUPERADMIN
    if toca_superadmin and por.rol != Rol.SUPERADMIN:
        raise SoloSuperadmin()


def puede_consultar_rol(solicitante, objetivo):
    """Cada persona ve su propio rol; administradores y coordinadores ven el de cualquiera."""
    return solicitante.pk == objetivo.pk or tiene_rol(
        solicitante, Rol.ADMINISTRADOR, Rol.SUPERADMIN, Rol.COORDINADOR
    )


def _sincronizar_perfil_tutor(usuario, anterior, nuevo):
    """Quien deja de ser tutor conserva su perfil, pero deja de estar disponible.

    Los perfiles se crean solos al asignar el rol (ver `signals.py`).
    """
    if anterior == Rol.TUTOR and nuevo != Rol.TUTOR:
        PerfilTutor.objects.filter(usuario=usuario).update(disponible=False)


def asignar_rol(objetivo, nuevo_rol, por):
    """Cambia el rol de `objetivo` y deja registro. Devuelve True si hubo cambio.

    Un administrador no puede cambiar su propio rol: así nunca se queda el sistema sin
    administradores y nadie se auto-concede privilegios sin que otro lo revise.
    """
    if objetivo.pk == por.pk:
        raise NoPuedesCambiarTuRol()
    exigir_superadmin_si_aplica(objetivo, por, nuevo_rol)

    with transaction.atomic():
        # Bloquea la fila para que dos cambios simultáneos no dejen un historial incoherente.
        objetivo = Usuario.objects.select_for_update().get(pk=objetivo.pk)
        anterior = objetivo.rol
        if anterior == nuevo_rol:
            return False
        objetivo.rol = nuevo_rol
        objetivo.save(update_fields=["rol"])
        CambioRol.objects.create(
            usuario=objetivo, rol_anterior=anterior, rol_nuevo=nuevo_rol, cambiado_por=por
        )
        registrar_evento(
            por,
            "rol.cambiado",
            "usuario",
            objetivo.pk,
            {"rol_anterior": anterior, "rol_nuevo": nuevo_rol},
        )
        _sincronizar_perfil_tutor(objetivo, anterior, nuevo_rol)
    return True
