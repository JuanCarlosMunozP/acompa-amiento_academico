from django.db import migrations

# Materias habituales de un colegio; se pueden editar o desactivar desde el panel de administración.
ASIGNATURAS = [
    "Matemáticas",
    "Español",
    "Inglés",
    "Ciencias Naturales",
    "Ciencias Sociales",
    "Física",
    "Química",
    "Biología",
]


def crear_datos_iniciales(apps, schema_editor):
    """Carga las asignaturas base y crea el perfil que falte a tutores y estudiantes.

    Es idempotente: se puede ejecutar varias veces sin duplicar nada.
    """
    Usuario = apps.get_model("usuarios", "Usuario")
    PerfilTutor = apps.get_model("usuarios", "PerfilTutor")
    PerfilEstudiante = apps.get_model("usuarios", "PerfilEstudiante")
    Asignatura = apps.get_model("usuarios", "Asignatura")

    for nombre in ASIGNATURAS:
        if not Asignatura.objects.filter(nombre__iexact=nombre).exists():
            Asignatura.objects.create(nombre=nombre)

    for usuario in Usuario.objects.filter(rol="tutor", perfil_tutor__isnull=True):
        PerfilTutor.objects.create(usuario=usuario)
    for usuario in Usuario.objects.filter(rol="estudiante", perfil_estudiante__isnull=True):
        PerfilEstudiante.objects.create(usuario=usuario)


class Migration(migrations.Migration):
    dependencies = [
        ("usuarios", "0006_grados_grupos_perfil_estudiante"),
    ]

    operations = [
        # Sin reversa: borrar datos al deshacer podría eliminar información real.
        migrations.RunPython(crear_datos_iniciales, migrations.RunPython.noop),
    ]
