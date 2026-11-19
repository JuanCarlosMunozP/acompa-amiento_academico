from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from planes.models import NotificacionAcompanamiento, PreferenciaNotificacion, SesionTutoria


class Command(BaseCommand):
    help = "Crea avisos internos para sesiones programadas dentro de las próximas 24 horas."

    def handle(self, *args, **options):
        ahora = timezone.now()
        sesiones = SesionTutoria.objects.filter(
            estado=SesionTutoria.Estado.PROGRAMADA,
            inicio__gt=ahora,
            inicio__lte=ahora + timedelta(hours=24),
        ).select_related("plan__estudiante", "plan__asignatura", "tutor")
        creadas = 0
        for sesion in sesiones.iterator():
            inicio = timezone.localtime(sesion.inicio)
            modalidad = sesion.get_modalidad_display().lower()
            for usuario in {sesion.plan.estudiante, sesion.tutor}:
                desactivada = PreferenciaNotificacion.objects.filter(
                    usuario=usuario,
                    tipo=NotificacionAcompanamiento.Tipo.SESION,
                    habilitada=False,
                ).exists()
                if desactivada:
                    continue
                clave = f"recordatorio-sesion:{sesion.pk}:{usuario.pk}:{sesion.inicio.isoformat()}"
                _, creada = NotificacionAcompanamiento.objects.get_or_create(
                    clave_evento=clave,
                    defaults={
                        "destinatario": usuario,
                        "tipo": NotificacionAcompanamiento.Tipo.SESION,
                        "titulo": "Recordatorio de tutoría",
                        "mensaje": (
                            f"{sesion.plan.asignatura.nombre} · "
                            f"{inicio:%d/%m/%Y %H:%M} · {modalidad}."
                        ),
                        "plan": sesion.plan,
                        "sesion": sesion,
                    },
                )
                creadas += int(creada)
        if creadas:
            self.stdout.write(self.style.SUCCESS(f"Recordatorios nuevos: {creadas}"))
