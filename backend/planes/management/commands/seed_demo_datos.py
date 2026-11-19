"""Carga un conjunto completo de datos ficticios para demostrar la plataforma.

Es idempotente: se puede repetir sin duplicar registros. No modifica contraseñas ni datos de
las cuentas que ya existen; solo crea las que faltan (con la contraseña indicada o una generada).

    python manage.py seed_demo_datos [--password CLAVE]
"""

import secrets
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from academico.models import DiaNoHabil, Institucion, Matricula, PeriodoAcademico, Sede
from planes.models import (
    ActividadPlan,
    AsignacionPlan,
    BitacoraSesion,
    NotificacionAcompanamiento,
    PlanRefuerzo,
    SesionTutoria,
)
from seguimiento.models import (
    Asistencia,
    CambioNota,
    EvaluacionPosterior,
    ReglaAcademica,
    Resultado,
    TrabajoPendiente,
)
from usuarios.models import (
    Asignatura,
    Grado,
    Grupo,
    HorarioDisponibilidadTutor,
    PerfilEstudiante,
    PerfilTutor,
    Usuario,
    VinculoAcudiente,
)
from usuarios.roles import Rol

D = Decimal
DEMO = "[DEMO] "

GRADOS = [("Sexto", 6), ("Séptimo", 7), ("Octavo", 8), ("Noveno", 9), ("Décimo", 10)]

ESTUDIANTES = [
    # (correo, nombres, apellidos, grado, grupo)
    ("sofia.ramirez@tutorias.local", "Sofía", "Ramírez Cuesta", "Sexto", "A"),
    ("mateo.gomez@tutorias.local", "Mateo", "Gómez Pineda", "Séptimo", "A"),
    ("valentina.torres@tutorias.local", "Valentina", "Torres Mejía", "Séptimo", "B"),
    ("santiago.diaz@tutorias.local", "Santiago", "Díaz Arango", "Octavo", "A"),
    ("camila.herrera@tutorias.local", "Camila", "Herrera Soto", "Noveno", "A"),
    ("andres.lopez@tutorias.local", "Andrés", "López Vargas", "Décimo", "A"),
]

# (correo, nombres, apellidos, parentesco, correos de los estudiantes a cargo)
ACUDIENTES = [
    (
        "marta.ramirez@tutorias.local",
        "Marta",
        "Cuesta Ruiz",
        "Madre",
        ["sofia.ramirez@tutorias.local"],
    ),
    (
        "jorge.gomez@tutorias.local",
        "Jorge",
        "Gómez Salas",
        "Padre",
        ["mateo.gomez@tutorias.local", "valentina.torres@tutorias.local"],
    ),
    (
        "luz.lopez@tutorias.local",
        "Luz",
        "Vargas Pardo",
        "Madre",
        ["andres.lopez@tutorias.local"],
    ),
]

TUTORES = [
    ("laura.martinez@tutorias.local", "Laura", "Martínez Ortiz", ["Física", "Química", "Biología"]),
    (
        "carlos.rojas@tutorias.local",
        "Carlos",
        "Rojas Benítez",
        ["Español", "Ciencias Sociales", "Inglés"],
    ),
]

# Cuentas que ya existen en la base de demostración.
TUTORES_EXISTENTES = {
    "tutor.local@tutorias.test": ["Matemáticas", "Física"],
    "demo.tutor@tutorias.local": ["Matemáticas", "Inglés", "Ciencias Naturales"],
}
ESTUDIANTES_EXISTENTES = [
    ("estudiante.local@tutorias.test", "Séptimo", "A"),
    ("demo.estudiante@tutorias.local", "Octavo", "A"),
    ("prueba.despliegue@example.com", "Sexto", "B"),
    ("juan.munozpabon@campusucc.edu.co", "Décimo", "B"),
]

# (periodo 1, periodo 2) por asignatura. Hay notas bajas a propósito para activar las reglas.
NOTAS = {
    "sofia.ramirez@tutorias.local": {
        "Matemáticas": (4.2, 4.5),
        "Español": (3.8, 4.0),
        "Inglés": (4.6, 4.7),
    },
    "mateo.gomez@tutorias.local": {
        "Matemáticas": (2.4, 2.7),
        "Ciencias Naturales": (3.1, 2.8),
        "Español": (3.9, 4.1),
    },
    "valentina.torres@tutorias.local": {
        "Inglés": (2.6, 2.9),
        "Ciencias Sociales": (3.7, 3.6),
        "Matemáticas": (4.0, 4.2),
    },
    "santiago.diaz@tutorias.local": {
        "Física": (2.2, 2.5),
        "Química": (2.8, 2.6),
        "Matemáticas": (3.3, 3.5),
    },
    "camila.herrera@tutorias.local": {
        "Biología": (4.4, 4.6),
        "Química": (3.9, 4.1),
        "Inglés": (4.1, 4.3),
    },
    "andres.lopez@tutorias.local": {
        "Matemáticas": (1.9, 2.3),
        "Física": (2.7, 3.0),
        "Español": (3.4, 3.2),
    },
    "estudiante.local@tutorias.test": {"Matemáticas": (3.0, 2.8), "Español": (3.6, 3.8)},
    "demo.estudiante@tutorias.local": {
        "Matemáticas": (2.9, 3.4),
        "Ciencias Naturales": (3.2, 3.5),
        "Inglés": (2.7, 3.1),
    },
    "prueba.despliegue@example.com": {"Matemáticas": (3.5, 3.7), "Español": (4.0, 4.0)},
    "juan.munozpabon@campusucc.edu.co": {
        "Física": (3.1, 3.3),
        "Química": (3.5, 3.4),
        "Matemáticas": (3.8, 4.0),
    },
}


class Command(BaseCommand):
    help = "Carga datos ficticios completos (periodos, matrículas, notas, planes, sesiones...)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--password",
            help="Contraseña de las cuentas nuevas. Si se omite se genera una al azar.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("Este comando solo se puede ejecutar con DEBUG habilitado.")

        self.hoy = timezone.localdate()
        self.password = options["password"] or secrets.token_urlsafe(9)
        self.cuentas_nuevas = []

        self._cargar_base()
        self._cargar_usuarios()
        self._cargar_matriculas_y_notas()
        self._cargar_asistencias_y_trabajos()
        self._cargar_planes()

        self.stdout.write(self.style.SUCCESS("Datos de demostración listos."))
        self.stdout.write(
            f"  usuarios={Usuario.objects.count()} matrículas={Matricula.objects.count()} "
            f"resultados={Resultado.objects.count()} planes={PlanRefuerzo.objects.count()} "
            f"sesiones={SesionTutoria.objects.count()} "
            f"acudientes={VinculoAcudiente.objects.count()}"
        )
        if self.cuentas_nuevas:
            self.stdout.write(
                f"  Cuentas nuevas ({len(self.cuentas_nuevas)}), contraseña: {self.password}"
            )
            for correo in self.cuentas_nuevas:
                self.stdout.write(f"    - {correo}")

    # ------------------------------------------------------------------ utilidades
    def _usuario(self, correo, nombres, apellidos, rol):
        usuario, creado = Usuario.objects.get_or_create(
            email=correo,
            defaults={
                "nombres": nombres,
                "apellidos": apellidos,
                "rol": rol,
                "email_verificado": True,
            },
        )
        if creado:
            usuario.set_password(self.password)
            usuario.save(update_fields=["password"])
            self.cuentas_nuevas.append(correo)
        return usuario

    def _dt(self, dia, hora, minutos=0):
        return timezone.make_aware(datetime.combine(dia, time(hora, minutos)))

    def _habil(self, dia):
        return dia.weekday() < 5 and dia not in self.festivos

    # ------------------------------------------------------------------ carga por bloques
    def _cargar_base(self):
        inst = Institucion.obtener()
        inst.nombre = inst.nombre or "Institución Educativa Demo"
        inst.ciudad = inst.ciudad or "Bogotá"
        inst.direccion = inst.direccion or "Calle 45 # 12-30"
        inst.telefono = inst.telefono or "6015550100"
        inst.correo = inst.correo or "contacto@tutorias.local"
        inst.save()
        Sede.objects.get_or_create(
            nombre="Sede Principal",
            defaults={"ciudad": "Bogotá", "direccion": "Calle 45 # 12-30", "principal": True},
        )

        self.p1, _ = PeriodoAcademico.objects.get_or_create(
            nombre="2026 - Periodo 1",
            defaults={"fecha_inicio": date(2026, 1, 19), "fecha_fin": date(2026, 6, 12)},
        )
        self.p2, _ = PeriodoAcademico.objects.get_or_create(
            nombre="2026 - Periodo 2",
            defaults={"fecha_inicio": date(2026, 7, 13), "fecha_fin": date(2026, 11, 27)},
        )

        self.festivos = set()
        for dia, desc in [
            (date(2026, 11, 2), "Día de Todos los Santos (festivo)"),
            (date(2026, 11, 16), "Independencia de Cartagena (festivo)"),
            (date(2026, 12, 8), "Inmaculada Concepción (festivo)"),
        ]:
            DiaNoHabil.objects.get_or_create(fecha=dia, defaults={"descripcion": desc})
        self.festivos = set(DiaNoHabil.objects.values_list("fecha", flat=True))

        for nombre, orden in GRADOS:
            Grado.objects.get_or_create(nombre=nombre, defaults={"orden": orden})
        for nombre_grado, _o in GRADOS:
            grado = Grado.objects.get(nombre=nombre_grado)
            for grupo in ("A", "B"):
                Grupo.objects.get_or_create(grado=grado, nombre=grupo)

        self.asig = {a.nombre: a for a in Asignatura.objects.all()}
        if not ReglaAcademica.objects.exists():
            ReglaAcademica.objects.create(
                nombre="Nota baja (atención)",
                tipo=ReglaAcademica.Tipo.NOTA_BAJA,
                umbral=D("3.50"),
                severidad=ReglaAcademica.Severidad.ATENCION,
            )
            ReglaAcademica.objects.create(
                nombre="Nota baja (riesgo)",
                tipo=ReglaAcademica.Tipo.NOTA_BAJA,
                umbral=D("3.00"),
                severidad=ReglaAcademica.Severidad.RIESGO,
            )

    def _cargar_usuarios(self):
        def grupo(grado, nombre):
            return Grupo.objects.get(grado__nombre=grado, nombre=nombre)

        self.estudiantes = {}
        for correo, nombres, apellidos, grado, gr in ESTUDIANTES:
            u = self._usuario(correo, nombres, apellidos, Rol.ESTUDIANTE)
            PerfilEstudiante.objects.get_or_create(usuario=u, defaults={"grupo": grupo(grado, gr)})
            self.estudiantes[correo] = (u, grupo(grado, gr))
        for correo, grado, gr in ESTUDIANTES_EXISTENTES:
            u = Usuario.objects.filter(email=correo, rol=Rol.ESTUDIANTE).first()
            if not u:
                continue
            perfil, _ = PerfilEstudiante.objects.get_or_create(usuario=u)
            if perfil.grupo_id is None:
                perfil.grupo = grupo(grado, gr)
                perfil.save()
            self.estudiantes[correo] = (u, perfil.grupo)

        self.coordinacion = (
            Usuario.objects.filter(rol=Rol.COORDINADOR).first()
            or Usuario.objects.filter(rol=Rol.ADMINISTRADOR).first()
        )

        for correo, nombres, apellidos, parentesco, hijos in ACUDIENTES:
            acudiente = self._usuario(correo, nombres, apellidos, Rol.ACUDIENTE)
            for hijo in hijos:
                if hijo in self.estudiantes:  # pragma: no branch - todos los hijos se crean antes
                    VinculoAcudiente.objects.get_or_create(
                        acudiente=acudiente,
                        estudiante=self.estudiantes[hijo][0],
                        defaults={"parentesco": parentesco, "creado_por": self.coordinacion},
                    )

        self.tutores = {}
        horarios = [(0, 14, 16), (2, 14, 16), (3, 15, 17)]
        for correo, nombres, apellidos, materias in TUTORES:
            u = self._usuario(correo, nombres, apellidos, Rol.TUTOR)
            self._perfil_tutor(u, materias, horarios)
            self.tutores[correo] = u
        for correo, materias in TUTORES_EXISTENTES.items():
            u = Usuario.objects.filter(email=correo, rol=Rol.TUTOR).first()
            if u:
                self._perfil_tutor(u, materias, horarios)
                self.tutores[correo] = u

    def _perfil_tutor(self, usuario, materias, horarios):
        perfil, creado = PerfilTutor.objects.get_or_create(usuario=usuario)
        if creado or not perfil.habilitado:
            perfil.habilitado = True
            perfil.disponible = True
            perfil.habilitado_por = self.coordinacion
            perfil.fecha_habilitacion = timezone.now()
            if not perfil.biografia:
                perfil.biografia = "Docente con experiencia en refuerzo escolar (perfil ficticio)."
            perfil.save()
        perfil.asignaturas.add(*[self.asig[m] for m in materias if m in self.asig])
        for dia, ini, fin in horarios:
            HorarioDisponibilidadTutor.objects.get_or_create(
                perfil=perfil, dia_semana=dia, hora_inicio=time(ini), hora_fin=time(fin)
            )

    def _cargar_matriculas_y_notas(self):
        for correo, (u, grupo) in self.estudiantes.items():
            if grupo is None:  # pragma: no cover - defensivo: el perfil siempre recibe un grupo
                continue
            for periodo in (self.p1, self.p2):
                Matricula.objects.get_or_create(
                    estudiante=u,
                    periodo=periodo,
                    defaults={
                        "grupo": grupo,
                        "fecha_matricula": self._dt(periodo.fecha_inicio, 8),
                    },
                )
            for materia, (n1, n2) in NOTAS.get(correo, {}).items():
                asignatura = self.asig.get(materia)
                if not asignatura:  # pragma: no cover - defensivo: el catálogo trae estas materias
                    continue
                for periodo, nota in ((self.p1, n1), (self.p2, n2)):
                    Resultado.objects.get_or_create(
                        estudiante=u,
                        asignatura=asignatura,
                        periodo=periodo,
                        defaults={
                            "valor": D(str(nota)),
                            "registrado_por": self.coordinacion,
                            "fecha_registro": self._dt(periodo.fecha_fin - timedelta(days=3), 10),
                        },
                    )

        # Una corrección de nota con su historial.
        andres = self.estudiantes["andres.lopez@tutorias.local"][0]
        res = Resultado.objects.filter(
            estudiante=andres, asignatura=self.asig["Matemáticas"], periodo=self.p1
        ).first()
        if res and not res.cambios.exists():
            CambioNota.objects.create(
                resultado=res,
                valor_anterior=D("1.50"),
                valor_nuevo=res.valor,
                motivo=DEMO + "Corrección por error de digitación en el registro de la nota.",
                cambiado_por=self.coordinacion,
            )

    def _cargar_asistencias_y_trabajos(self):
        patron = ["presente", "presente", "tarde", "presente", "ausente", "presente", "excusa"]
        dias = []
        dia = self.hoy - timedelta(days=1)
        while len(dias) < 15:
            if self._habil(dia):
                dias.append(dia)
            dia -= timedelta(days=1)

        for i, (_correo, (u, _g)) in enumerate(self.estudiantes.items()):
            for j, dia in enumerate(dias):
                # Los primeros estudiantes faltan más, para que se vean casos de atención.
                estado = (
                    "presente" if (i + j) % (3 + (i % 4)) else patron[(i * 3 + j) % len(patron)]
                )
                Asistencia.objects.get_or_create(
                    estudiante=u,
                    fecha=dia,
                    defaults={"estado": estado, "registrado_por": self.coordinacion},
                )

        pendientes = [
            (
                "mateo.gomez@tutorias.local",
                "Ciencias Naturales",
                "Informe de laboratorio sobre densidad",
                9,
                False,
            ),
            ("santiago.diaz@tutorias.local", "Física", "Taller de movimiento uniforme", 4, False),
            (
                "santiago.diaz@tutorias.local",
                "Química",
                "Guía de balanceo de ecuaciones",
                12,
                False,
            ),
            (
                "andres.lopez@tutorias.local",
                "Matemáticas",
                "Taller de funciones lineales",
                6,
                False,
            ),
            ("andres.lopez@tutorias.local", "Física", "Problemas de cinemática", 15, True),
            (
                "valentina.torres@tutorias.local",
                "Inglés",
                "Ensayo corto: My daily routine",
                3,
                False,
            ),
        ]
        for correo, materia, desc, hace, entregado in pendientes:
            u = self.estudiantes[correo][0]
            limite = self.hoy - timedelta(days=hace)
            TrabajoPendiente.objects.get_or_create(
                estudiante=u,
                asignatura=self.asig[materia],
                descripcion=DEMO + desc,
                defaults={
                    "periodo": self.p2,
                    "fecha_limite": limite,
                    "entregado": entregado,
                    "fecha_entrega": limite + timedelta(days=1) if entregado else None,
                    "registrado_por": self.coordinacion,
                },
            )

    # ------------------------------------------------------------------ planes y sesiones
    def _plan(self, correo, materia, periodo, estado, tutor, objetivos, ini, fin, **extra):
        estudiante = self.estudiantes[correo][0]
        plan, creado = PlanRefuerzo.objects.get_or_create(
            estudiante=estudiante,
            periodo=periodo,
            asignatura=self.asig[materia],
            objetivos=DEMO + objetivos,
            defaults={
                "fecha_inicio": ini,
                "fecha_fin": fin,
                "estado": estado,
                "tutor": tutor,
                "creado_por": tutor or self.coordinacion,
                "desempenos_no_alcanzados": (
                    f"{DEMO}Desempeños pendientes en {materia}: {objetivos}"[:1500]
                ),
                "fecha_creacion": self._dt(ini, 9),
                **extra,
            },
        )
        if creado and tutor:
            AsignacionPlan.objects.create(
                plan=plan,
                tutor=tutor,
                asignado_por=self.coordinacion,
                notificado=True,
                fecha=self._dt(ini, 10),
            )
        return plan

    def _sesion(self, plan, dia, hora, estado, asistencia="pendiente", bitacora=None):
        inicio = self._dt(dia, hora)
        fin = inicio + timedelta(minutes=50)
        virtual = hora % 2 == 0
        sesion, creada = SesionTutoria.objects.get_or_create(
            plan=plan,
            inicio=inicio,
            defaults={
                "tutor": plan.tutor,
                "fin": fin,
                "modalidad": "virtual" if virtual else "presencial",
                "lugar": "" if virtual else "Aula de apoyo académico",
                "enlace_virtual": "https://meet.example.com/tutoria-demo" if virtual else "",
                "estado": estado,
                "asistencia": asistencia,
                "asistencia_registrada_por": plan.estudiante if asistencia != "pendiente" else None,
                "asistencia_fecha": fin if asistencia != "pendiente" else None,
                "creado_por": self.coordinacion,
                "motivo_cancelacion": (
                    "El tutor no pudo asistir; se reprogramará." if estado == "cancelada" else ""
                ),
            },
        )
        if creada and bitacora:
            temas, desarrollo, acuerdos = bitacora
            BitacoraSesion.objects.create(
                sesion=sesion,
                creada_por=plan.tutor,
                temas=DEMO + temas,
                desarrollo=desarrollo,
                acuerdos=acuerdos,
                observaciones="Registro ficticio para demostración.",
                fecha_cierre=fin + timedelta(minutes=10),
            )
        return sesion

    def _actividades(self, plan, items):
        for titulo, descripcion, desde_hoy, hecha in items:
            limite = self.hoy + timedelta(days=desde_hoy)
            ActividadPlan.objects.get_or_create(
                plan=plan,
                titulo=titulo,
                defaults={
                    "descripcion": descripcion,
                    "fecha_limite": limite,
                    "completada": hecha,
                    "fecha_completada": self._dt(limite - timedelta(days=1), 18) if hecha else None,
                    "creado_por": plan.tutor,
                },
            )

    def _cargar_planes(self):
        t = self.tutores
        laura = t["laura.martinez@tutorias.local"]
        carlos = t["carlos.rojas@tutorias.local"]
        t_mat = t.get("demo.tutor@tutorias.local") or laura
        t_mat2 = t.get("tutor.local@tutorias.test") or t_mat
        hoy = self.hoy
        sem = timedelta(days=7)

        bit_mat = (
            "Ecuaciones y funciones lineales",
            "Se resolvieron ejercicios guiados; el estudiante corrigió errores de despeje.",
            "Resolver seis ejercicios antes de la próxima sesión.",
        )
        bit_fis = (
            "Movimiento uniforme y gráficas",
            "Se interpretaron gráficas posición-tiempo y se calcularon velocidades.",
            "Entregar el taller de cinemática.",
        )
        bit_ing = (
            "Comprensión lectora en inglés",
            "Lectura de un texto corto y práctica de vocabulario con ejemplos orales.",
            "Escribir un párrafo de cinco líneas.",
        )

        # 1. Matemáticas — Andrés (asignado, varias sesiones)
        p = self._plan(
            "andres.lopez@tutorias.local",
            "Matemáticas",
            self.p2,
            "asignado",
            t_mat,
            "Reforzar funciones lineales y resolución de problemas.",
            hoy - 40 * timedelta(days=1),
            hoy + 20 * timedelta(days=1),
        )
        self._sesion(p, hoy - 3 * sem, 15, "realizada", "presente", bit_mat)
        self._sesion(p, hoy - 2 * sem, 15, "realizada", "presente", bit_mat)
        self._sesion(p, hoy - sem, 15, "realizada", "ausente")
        self._sesion(p, hoy + 2 * timedelta(days=1), 15, "programada")
        self._actividades(
            p,
            [
                ("Taller de funciones lineales", "Ejercicios 1 al 10 de la guía.", -5, True),
                ("Problemas de aplicación", "Cinco problemas de contexto.", 4, False),
            ],
        )

        # 2. Física — Santiago (asignado)
        p = self._plan(
            "santiago.diaz@tutorias.local",
            "Física",
            self.p2,
            "asignado",
            t.get("tutor.local@tutorias.test") or laura,
            "Afianzar cinemática y lectura de gráficas.",
            hoy - 35 * timedelta(days=1),
            hoy + 25 * timedelta(days=1),
        )
        self._sesion(p, hoy - 2 * sem, 14, "realizada", "presente", bit_fis)
        self._sesion(p, hoy - 5 * timedelta(days=1), 14, "realizada", "excusa")
        self._sesion(p, hoy + 4 * timedelta(days=1), 14, "programada")
        self._actividades(p, [("Taller de movimiento uniforme", "Guía de ejercicios.", 6, False)])

        # 3. Química — Santiago (asignado a Laura)
        p = self._plan(
            "santiago.diaz@tutorias.local",
            "Química",
            self.p2,
            "asignado",
            laura,
            "Balanceo de ecuaciones y estequiometría básica.",
            hoy - 30 * timedelta(days=1),
            hoy + 30 * timedelta(days=1),
        )
        self._sesion(p, hoy - 9 * timedelta(days=1), 16, "realizada", "presente", bit_fis)
        self._sesion(p, hoy + 6 * timedelta(days=1), 16, "programada")

        # 4. Inglés — Valentina (asignado a Carlos, con una sesión cancelada)
        p = self._plan(
            "valentina.torres@tutorias.local",
            "Inglés",
            self.p2,
            "asignado",
            carlos,
            "Mejorar comprensión lectora y conversación básica.",
            hoy - 28 * timedelta(days=1),
            hoy + 28 * timedelta(days=1),
        )
        self._sesion(p, hoy - 2 * sem, 15, "realizada", "presente", bit_ing)
        self._sesion(p, hoy - sem, 15, "cancelada")
        self._sesion(p, hoy + 3 * timedelta(days=1), 15, "programada")
        self._actividades(
            p, [("Ensayo: My daily routine", "Cinco líneas con vocabulario nuevo.", 5, False)]
        )

        # 5. Ciencias Naturales — Mateo (asignado)
        p = self._plan(
            "mateo.gomez@tutorias.local",
            "Ciencias Naturales",
            self.p2,
            "asignado",
            t_mat,
            "Reforzar ecosistemas y método científico.",
            hoy - 20 * timedelta(days=1),
            hoy + 30 * timedelta(days=1),
        )
        self._sesion(p, hoy - 6 * timedelta(days=1), 15, "realizada", "presente", bit_fis)
        self._sesion(p, hoy + 5 * timedelta(days=1), 15, "programada")

        # 6. Pendientes de tutor (solicitudes sin asignar)
        self._plan(
            "mateo.gomez@tutorias.local",
            "Matemáticas",
            self.p2,
            "pendiente",
            None,
            "Solicita apoyo con fracciones y operaciones con signos.",
            hoy - 4 * timedelta(days=1),
            hoy + 40 * timedelta(days=1),
        )
        self._plan(
            "andres.lopez@tutorias.local",
            "Física",
            self.p2,
            "pendiente",
            None,
            "Solicita refuerzo de cinemática antes de la evaluación final.",
            hoy - 2 * timedelta(days=1),
            hoy + 35 * timedelta(days=1),
        )

        # 7. Planes cerrados del periodo 1 con evaluación posterior
        cerrados = [
            (
                "demo.estudiante@tutorias.local",
                "Matemáticas",
                t_mat,
                "logrado",
                D("2.50"),
                D("3.60"),
                bit_mat,
            ),
            (
                "estudiante.local@tutorias.test",
                "Matemáticas",
                t_mat2,
                "parcial",
                D("2.40"),
                D("3.00"),
                bit_mat,
            ),
            (
                "andres.lopez@tutorias.local",
                "Español",
                carlos,
                "no_logrado",
                D("2.60"),
                D("2.70"),
                bit_ing,
            ),
        ]
        for correo, materia, tutor, resultado, inicial, posterior, bit in cerrados:
            if correo not in self.estudiantes:
                continue
            ini = self.p1.fecha_inicio + timedelta(days=30)
            fin = self.p1.fecha_fin - timedelta(days=10)
            p = self._plan(
                correo,
                materia,
                self.p1,
                "cerrado",
                tutor,
                "Plan de recuperación del primer periodo.",
                ini,
                fin,
                resultado=resultado,
                fecha_cierre=fin,
                nota_cierre="Valoración descriptiva del cierre, según las entregas (ficticio).",
                nota_final=posterior,
                visto_bueno_por=self.coordinacion if resultado != "no_logrado" else None,
                visto_bueno_fecha=self._dt(fin, 16) if resultado != "no_logrado" else None,
            )
            self._sesion(p, ini + 14 * timedelta(days=1), 15, "realizada", "presente", bit)
            self._sesion(p, ini + 28 * timedelta(days=1), 15, "realizada", "presente", bit)
            if not hasattr(p, "evaluacion_posterior"):
                EvaluacionPosterior.objects.get_or_create(
                    plan=p,
                    defaults={
                        "nota_inicial": inicial,
                        "nota_posterior": posterior,
                        "observaciones": "Evaluación posterior registrada tras finalizar el plan.",
                        "registrada_por": self.coordinacion,
                        "fecha_registro": self._dt(fin, 11),
                    },
                )

        # 8. Plan cancelado
        self._plan(
            "camila.herrera@tutorias.local",
            "Química",
            self.p2,
            "cancelado",
            None,
            "Solicitud cancelada por la estudiante al superar la nota.",
            hoy - 25 * timedelta(days=1),
            hoy + 20 * timedelta(days=1),
        )

        self._notificaciones()

    def _notificaciones(self):
        planes = PlanRefuerzo.objects.filter(
            objetivos__startswith=DEMO, estado=PlanRefuerzo.Estado.ASIGNADO
        ).select_related("estudiante", "tutor", "asignatura")
        for plan in planes:
            NotificacionAcompanamiento.objects.get_or_create(
                clave_evento=f"demo-plan-estudiante-{plan.pk}",
                defaults={
                    "destinatario": plan.estudiante,
                    "tipo": "plan",
                    "titulo": "Tienes un docente asignado",
                    "mensaje": f"{plan.tutor.nombre_completo} te acompañará en {plan.asignatura}.",
                    "plan": plan,
                    "creada": self._dt(plan.fecha_inicio, 11),
                    "leida": timezone.now() if plan.pk % 2 else None,
                },
            )
            NotificacionAcompanamiento.objects.get_or_create(
                clave_evento=f"demo-plan-tutor-{plan.pk}",
                defaults={
                    "destinatario": plan.tutor,
                    "tipo": "plan",
                    "titulo": "Nuevo expediente de nivelación asignado",
                    "mensaje": (
                        f"Se te asignó {plan.estudiante.nombre_completo} en {plan.asignatura}."
                    ),
                    "plan": plan,
                    "creada": self._dt(plan.fecha_inicio, 11),
                },
            )
