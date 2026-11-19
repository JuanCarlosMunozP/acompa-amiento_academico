from datetime import date, datetime, time, timedelta

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from academico.models import PeriodoAcademico
from planes.models import AsignacionPlan, BitacoraSesion, PlanRefuerzo, SesionTutoria
from usuarios.models import Asignatura, Usuario
from usuarios.roles import Rol


class Command(BaseCommand):
    help = "Carga expedientes de nivelación e informes ficticios en la base local de desarrollo."

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("Este comando solo se puede ejecutar con DEBUG habilitado.")

        try:
            estudiante = Usuario.objects.get(
                email="estudiante.prueba@colegio.test",
                rol=Rol.ESTUDIANTE,
            )
            tutor = Usuario.objects.get(email="tutor.prueba@colegio.test", rol=Rol.TUTOR)
            coordinacion = Usuario.objects.get(
                email="coordinador.prueba@campusucc.edu.co", rol=Rol.COORDINADOR
            )
            periodo = PeriodoAcademico.objects.get(nombre="Periodo 2026 de prueba")
            matematicas = Asignatura.objects.get(nombre="Matemáticas")
            ciencias = Asignatura.objects.get(nombre="Ciencias Naturales")
            ingles = Asignatura.objects.get(nombre="Inglés")
        except (
            Usuario.DoesNotExist,
            PeriodoAcademico.DoesNotExist,
            Asignatura.DoesNotExist,
        ) as exc:
            raise CommandError(
                "Faltan las cuentas, asignaturas o el periodo de prueba requeridos."
            ) from exc

        hoy = date(2026, 10, 20)
        fecha_inicio = max(periodo.fecha_inicio, hoy - timedelta(days=30))
        fecha_fin = max(fecha_inicio, periodo.fecha_fin)

        def plan_demo(asignatura, necesidad, asignado):
            plan, creado = PlanRefuerzo.objects.get_or_create(
                estudiante=estudiante,
                periodo=periodo,
                asignatura=asignatura,
                objetivos=f"[DEMO] {necesidad}",
                defaults={
                    "fecha_inicio": fecha_inicio,
                    "fecha_fin": fecha_fin,
                    "estado": (
                        PlanRefuerzo.Estado.ASIGNADO if asignado else PlanRefuerzo.Estado.PENDIENTE
                    ),
                    "tutor": tutor if asignado else None,
                    "creado_por": coordinacion,
                    "desempenos_no_alcanzados": f"[DEMO] Desempeños pendientes: {necesidad}"[:1500],
                },
            )
            if creado and asignado:
                AsignacionPlan.objects.get_or_create(
                    plan=plan,
                    tutor=tutor,
                    defaults={"asignado_por": coordinacion, "notificado": True},
                )
            return plan

        solicitud = plan_demo(
            ingles,
            "Solicita practicar comprensión lectora y conversación básica en inglés.",
            False,
        )
        planes_asignados = [
            plan_demo(
                matematicas,
                "Reforzar fracciones, operaciones con signos y resolución de problemas.",
                True,
            ),
            plan_demo(
                ciencias,
                "Aclarar conceptos de ecosistemas y preparar las evaluaciones del periodo.",
                True,
            ),
        ]

        temas = {
            matematicas.pk: (
                "Fracciones y operaciones con números enteros",
                "Se resolvieron ejercicios paso a paso. El estudiante identificó errores de signo "
                "y aplicó una estrategia de comprobación en problemas guiados.",
                "Practicar cinco ejercicios de fracciones antes de la próxima sesión.",
            ),
            ciencias.pk: (
                "Ecosistemas y relaciones entre los seres vivos",
                "Se construyó un mapa de relaciones tróficas y se revisaron ejemplos del entorno "
                "escolar. El estudiante explicó correctamente los conceptos principales.",
                "Completar el resumen del tema y traer una pregunta para revisar.",
            ),
        }
        base = timezone.localdate()
        for plan, dias in zip(planes_asignados, (12, 5), strict=True):
            dia = base - timedelta(days=dias)
            inicio = timezone.make_aware(datetime.combine(dia, time(15, 0)))
            fin = inicio + timedelta(minutes=50)
            sesion, _ = SesionTutoria.objects.get_or_create(
                plan=plan,
                inicio=inicio,
                defaults={
                    "tutor": tutor,
                    "fin": fin,
                    "modalidad": SesionTutoria.Modalidad.PRESENCIAL,
                    "lugar": "Aula de apoyo académico",
                    "estado": SesionTutoria.Estado.REALIZADA,
                    "asistencia": SesionTutoria.Asistencia.PRESENTE,
                    "asistencia_registrada_por": estudiante,
                    "asistencia_fecha": fin,
                    "creado_por": coordinacion,
                },
            )
            tema, desarrollo, acuerdo = temas[plan.asignatura_id]
            BitacoraSesion.objects.get_or_create(
                sesion=sesion,
                defaults={
                    "creada_por": tutor,
                    "temas": f"[DEMO] {tema}",
                    "desarrollo": desarrollo,
                    "acuerdos": acuerdo,
                    "observaciones": "Registro ficticio para demostración del piloto escolar.",
                },
            )

        plan_pendiente_informe = planes_asignados[0]
        dia = hoy - timedelta(days=7)
        inicio = timezone.make_aware(datetime.combine(dia, time(15, 0)))
        fin = inicio + timedelta(minutes=50)
        SesionTutoria.objects.get_or_create(
            plan=plan_pendiente_informe,
            inicio=inicio,
            defaults={
                "tutor": tutor,
                "fin": fin,
                "modalidad": SesionTutoria.Modalidad.PRESENCIAL,
                "lugar": "Aula de apoyo académico",
                "estado": SesionTutoria.Estado.REALIZADA,
                "asistencia": SesionTutoria.Asistencia.PRESENTE,
                "asistencia_registrada_por": estudiante,
                "asistencia_fecha": fin,
                "creado_por": coordinacion,
            },
        )

        self.stdout.write(
            self.style.SUCCESS(
                "Datos de demostración listos: "
                f"solicitud #{solicitud.pk}, {len(planes_asignados)} planes asignados y "
                f"{BitacoraSesion.objects.filter(sesion__plan__in=planes_asignados).count()} "
                "informes "
                "y una sesión terminada disponible para registrar otro informe."
            )
        )
