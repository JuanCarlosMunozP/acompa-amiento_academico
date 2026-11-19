import logging

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone

from usuarios.models import Usuario, VinculoAcudiente
from usuarios.roles import Rol

from .models import (
    AsignacionPlan,
    NotificacionAcompanamiento,
    PlanRefuerzo,
    PlantillaCorreoPlan,
    PreferenciaNotificacion,
)
from .plantillas_correo import asegurar_plantillas, enviar_correo_de_plan

registro = logging.getLogger(__name__)


def tutores_elegibles(plan):
    """Tutores a quienes se puede asignar el plan.

    Activos, habilitados por la institución, disponibles y que dictan la asignatura del plan.
    Van primero los de menor carga (planes asignados vigentes), luego por apellidos.
    """
    return (
        Usuario.objects.filter(
            rol=Rol.TUTOR,
            is_active=True,
            perfil_tutor__habilitado=True,
            perfil_tutor__disponible=True,
            perfil_tutor__asignaturas=plan.asignatura,
        )
        .annotate(
            carga=Count(
                "planes_asignados",
                filter=Q(planes_asignados__estado=PlanRefuerzo.Estado.ASIGNADO),
            )
        )
        .order_by("carga", "apellidos", "nombres")
    )


def _contexto(plan, destinatario):
    return {
        "nombres": destinatario.nombres,
        "correo": destinatario.email,
        "estudiante": plan.estudiante.nombre_completo,
        "tutor": plan.tutor.nombre_completo,
        "asignatura": plan.asignatura.nombre,
        "periodo": plan.periodo.nombre,
        "fecha_inicio": plan.fecha_inicio.isoformat(),
        "fecha_fin": plan.fecha_fin.isoformat(),
        "objetivos": plan.objetivos,
    }


def _enviar(plantilla, plan, destinatario):
    """Envía un aviso; un fallo de correo no debe deshacer la asignación."""
    try:
        claves = {
            "planes/correo/asignacion_tutor": PlantillaCorreoPlan.Clave.ASIGNACION_TUTOR,
            "planes/correo/asignacion_estudiante": PlantillaCorreoPlan.Clave.ASIGNACION_ESTUDIANTE,
        }
        clave = claves[plantilla]
        plantilla_db = next(item for item in asegurar_plantillas() if item.clave == clave)
        enviar_correo_de_plan(plantilla_db, _contexto(plan, destinatario), destinatario.email)
    except Exception:
        registro.exception("No se pudo enviar el aviso del plan %s a %s", plan.pk, destinatario.pk)
        return False
    return True


def notificar_asignacion(plan):
    """Avisa al tutor y al estudiante. Devuelve `{"tutor": bool, "estudiante": bool}`."""
    return {
        "tutor": _enviar(
            "planes/correo/asignacion_tutor",
            plan,
            plan.tutor,
        ),
        "estudiante": _enviar(
            "planes/correo/asignacion_estudiante",
            plan,
            plan.estudiante,
        ),
    }


def notificar_proceso(destinatarios, *, tipo, titulo, mensaje, plan=None, sesion=None):
    """Crea avisos internos para participantes sin duplicar ni ignorar preferencias."""
    ids = {u.pk for u in destinatarios if u and getattr(u, "is_active", True)}
    silenciados = set(
        PreferenciaNotificacion.objects.filter(
            usuario_id__in=ids, tipo=tipo, habilitada=False
        ).values_list("usuario_id", flat=True)
    )
    NotificacionAcompanamiento.objects.bulk_create(
        [
            NotificacionAcompanamiento(
                destinatario_id=uid,
                tipo=tipo,
                titulo=titulo,
                mensaje=mensaje,
                plan=plan,
                sesion=sesion,
            )
            for uid in ids
            if uid not in silenciados
        ]
    )


def asignar_tutor(plan, tutor, por):
    """Asigna (o reasigna) el tutor. Devuelve `(cambio, notificacion)`.

    Si el tutor ya era el responsable no se repite nada ni se vuelve a avisar.
    """
    if plan.estado == PlanRefuerzo.Estado.ASIGNADO and plan.tutor_id == tutor.pk:
        return False, None
    with transaction.atomic():
        plan.tutor = tutor
        plan.estado = PlanRefuerzo.Estado.ASIGNADO
        plan.save()
        asignacion = AsignacionPlan.objects.create(plan=plan, tutor=tutor, asignado_por=por)
    # El aviso va fuera de la transacción: ya está asignado aunque el correo falle.
    notificacion = notificar_asignacion(plan)
    notificar_proceso(
        [plan.tutor, plan.estudiante],
        tipo=NotificacionAcompanamiento.Tipo.PLAN,
        titulo="Tutor asignado a tu plan",
        mensaje=(
            f"{plan.asignatura.nombre}: seguimiento del {plan.fecha_inicio} al {plan.fecha_fin}."
        ),
        plan=plan,
    )
    asignacion.notificado = notificacion["tutor"]
    asignacion.save(update_fields=["notificado"])
    return True, notificacion


def consulta_de_planes():
    """Planes con los conteos de actividades ya calculados (sin una consulta por plan)."""
    hoy = timezone.localdate()
    return (
        PlanRefuerzo.objects.select_related("estudiante", "asignatura", "periodo", "tutor")
        .annotate(
            actividades_total=Count("actividades"),
            actividades_completadas=Count("actividades", filter=Q(actividades__completada=True)),
            actividades_vencidas=Count(
                "actividades",
                filter=Q(actividades__completada=False, actividades__fecha_limite__lt=hoy),
            ),
        )
        .order_by("-fecha_creacion", "-id")
    )


def es_acudiente_de(usuario, estudiante_id):
    """True si `usuario` es un acudiente activo vinculado al estudiante."""
    return (
        usuario.rol == Rol.ACUDIENTE
        and VinculoAcudiente.objects.filter(
            acudiente=usuario, estudiante_id=estudiante_id, estudiante__is_active=True
        ).exists()
    )


def puede_ver(usuario, plan):
    """Coordinación ve todo; el docente responsable, el estudiante y su acudiente, lo suyo."""
    if usuario.rol in (Rol.COORDINADOR, Rol.ADMINISTRADOR, Rol.SUPERADMIN):
        return True
    if usuario.rol == Rol.TUTOR:
        return plan.tutor_id == usuario.pk
    if usuario.rol == Rol.ACUDIENTE:
        return es_acudiente_de(usuario, plan.estudiante_id)
    return plan.estudiante_id == usuario.pk


def puede_gestionar(usuario, plan):
    """Quién registra actividades y cierra: coordinación y el tutor responsable."""
    if usuario.rol in (Rol.COORDINADOR, Rol.ADMINISTRADOR, Rol.SUPERADMIN):
        return True
    return usuario.rol == Rol.TUTOR and plan.tutor_id == usuario.pk


def responsables_institucionales():
    """Coordinación y administración activas: reciben los avisos de cierre y revisión."""
    return Usuario.objects.filter(
        is_active=True, rol__in=[Rol.COORDINADOR, Rol.ADMINISTRADOR, Rol.SUPERADMIN]
    )


def participantes(plan):
    """Quienes siguen el expediente de cerca: estudiante, acudientes vinculados y docente."""
    acudientes = Usuario.objects.filter(
        is_active=True, estudiantes_vinculados__estudiante_id=plan.estudiante_id
    )
    return [plan.estudiante, plan.tutor, *acudientes]


def es_docente_responsable(usuario, plan):
    """El docente (rol tutor) asignado al expediente; solo él evalúa, retroalimenta y cierra."""
    return usuario.rol == Rol.TUTOR and plan.tutor_id == usuario.pk
