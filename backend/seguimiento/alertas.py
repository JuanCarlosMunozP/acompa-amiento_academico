"""Publicación de las alertas del motor de reglas como avisos para coordinación."""

import logging

from planes.models import NotificacionAcompanamiento, PreferenciaNotificacion
from usuarios.models import Usuario
from usuarios.roles import Rol

from .servicios import evaluar_estudiante

registro = logging.getLogger(__name__)

ROLES_DESTINATARIOS = (Rol.COORDINADOR, Rol.ADMINISTRADOR, Rol.SUPERADMIN)


def publicar_alertas(estudiante, periodo):
    """Crea un aviso por cada alerta vigente del estudiante para coordinación y administración.

    Es idempotente: cada combinación de destinatario, estudiante, periodo, regla, asignatura y
    severidad se avisa una sola vez, de modo que volver a guardar datos no repite la alerta.
    Un fallo aquí nunca debe deshacer el registro académico que lo originó.
    """
    try:
        alertas = evaluar_estudiante(estudiante, periodo)["alertas"]
        if not alertas:
            return 0
        silenciados = set(
            PreferenciaNotificacion.objects.filter(
                tipo=NotificacionAcompanamiento.Tipo.ALERTA, habilitada=False
            ).values_list("usuario_id", flat=True)
        )
        destinatarios = Usuario.objects.filter(is_active=True, rol__in=ROLES_DESTINATARIOS).exclude(
            pk__in=silenciados
        )
        creadas = 0
        for destinatario in destinatarios:
            for alerta in alertas:
                clave = (
                    f"alerta:{destinatario.pk}:{estudiante.pk}:{periodo.pk}:"
                    f"{alerta['regla']}:{alerta['severidad']}:{alerta['asignatura'] or '-'}"
                )
                _, nueva = NotificacionAcompanamiento.objects.get_or_create(
                    clave_evento=clave[:120],
                    defaults={
                        "destinatario": destinatario,
                        "tipo": NotificacionAcompanamiento.Tipo.ALERTA,
                        "titulo": (f"Alerta {alerta['severidad']}: {estudiante.nombre_completo}")[
                            :140
                        ],
                        "mensaje": alerta["explicacion"][:500],
                    },
                )
                creadas += int(nueva)
        return creadas
    except Exception:
        registro.exception("No se pudieron publicar las alertas del estudiante %s", estudiante.pk)
        return 0
