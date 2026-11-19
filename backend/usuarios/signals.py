from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import PerfilEstudiante, PerfilTutor, Usuario
from .roles import Rol


@receiver(post_save, sender=Usuario)
def asegurar_perfil_segun_rol(sender, instance, raw=False, **kwargs):
    """Todo tutor tiene PerfilTutor y todo estudiante PerfilEstudiante, sin importar cómo se
    creó la cuenta o se cambió el rol (registro, API, panel de administración o consola)."""
    if raw:  # carga de fixtures: no se tocan otras tablas
        return
    if instance.rol == Rol.TUTOR:
        PerfilTutor.objects.get_or_create(usuario=instance)
    elif instance.rol == Rol.ESTUDIANTE:
        PerfilEstudiante.objects.get_or_create(usuario=instance)
