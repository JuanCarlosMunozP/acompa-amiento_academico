from django.db import transaction
from django.utils import timezone

from .models import PerfilTutor


def cambiar_habilitacion(perfil, habilitado, por):
    """Habilita o retira la habilitación institucional de un tutor. Devuelve True si cambió.

    Al retirarla el tutor deja de estar disponible. Quien lo cambia queda registrado.
    """
    with transaction.atomic():
        perfil = PerfilTutor.objects.select_for_update().get(pk=perfil.pk)
        if perfil.habilitado == habilitado:
            return False
        perfil.habilitado = habilitado
        if habilitado:
            perfil.habilitado_por = por
            perfil.fecha_habilitacion = timezone.now()
        else:
            perfil.habilitado_por = None
            perfil.fecha_habilitacion = None
            perfil.disponible = False
        perfil.save()
    return True
