from django.db import transaction

from .excepciones import NoPuedesCambiarTuEstado
from .gestion_roles import exigir_superadmin_si_aplica
from .models import CambioEstado, PerfilTutor, Usuario
from .recuperacion import cerrar_todas_las_sesiones


def cambiar_estado(objetivo, activo, por, motivo=""):
    """Activa o desactiva una cuenta y deja registro. Devuelve True si hubo cambio.

    Al desactivarla se cierran todas sus sesiones y, si es tutor, deja de estar disponible.
    Nadie puede desactivar su propia cuenta (así no se pierde el último acceso de administración).
    """
    if objetivo.pk == por.pk and not activo:
        raise NoPuedesCambiarTuEstado()

    exigir_superadmin_si_aplica(objetivo, por)

    with transaction.atomic():
        objetivo = Usuario.objects.select_for_update().get(pk=objetivo.pk)
        if objetivo.is_active == activo:
            return False
        objetivo.is_active = activo
        objetivo.save(update_fields=["is_active"])
        CambioEstado.objects.create(
            usuario=objetivo, activo=activo, motivo=motivo, cambiado_por=por
        )
        if not activo:
            cerrar_todas_las_sesiones(objetivo)
            PerfilTutor.objects.filter(usuario=objetivo).update(disponible=False)
    return True
