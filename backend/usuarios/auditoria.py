from .models import EventoAuditoria


def registrar_evento(actor, accion, recurso, recurso_id="", detalles=None):
    """Guarda el contexto de rol y solo los datos mínimos necesarios para trazabilidad."""
    return EventoAuditoria.objects.create(
        actor=actor,
        actor_rol=getattr(actor, "rol", "") if actor else "",
        accion=accion,
        recurso=recurso,
        recurso_id=str(recurso_id) if recurso_id else "",
        detalles=detalles or {},
    )
