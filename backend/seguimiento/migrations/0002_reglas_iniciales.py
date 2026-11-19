from django.db import migrations

# Umbrales de partida (escala 1,0 a 5,0: por debajo de 3,0 es desempeño bajo). El administrador
# los puede cambiar, desactivar o ampliar desde la API o el panel de administración.
REGLAS = [
    ("Nota en atención", "nota_baja", "3.50", "atencion"),
    ("Nota en riesgo", "nota_baja", "3.00", "riesgo"),
    ("Nota crítica", "nota_baja", "2.00", "critico"),
    ("Asistencia en atención", "asistencia_baja", "90", "atencion"),
    ("Asistencia en riesgo", "asistencia_baja", "80", "riesgo"),
    ("Asistencia crítica", "asistencia_baja", "70", "critico"),
    ("Trabajos pendientes en atención", "trabajos_pendientes", "2", "atencion"),
    ("Trabajos pendientes en riesgo", "trabajos_pendientes", "4", "riesgo"),
    ("Trabajos pendientes críticos", "trabajos_pendientes", "6", "critico"),
]


def cargar_reglas(apps, schema_editor):
    """Idempotente: no pisa reglas que el administrador ya haya creado o editado."""
    Regla = apps.get_model("seguimiento", "ReglaAcademica")
    for nombre, tipo, umbral, severidad in REGLAS:
        Regla.objects.get_or_create(
            nombre=nombre, defaults={"tipo": tipo, "umbral": umbral, "severidad": severidad}
        )


class Migration(migrations.Migration):
    dependencies = [
        ("seguimiento", "0001_seguimiento_academico"),
    ]

    operations = [
        migrations.RunPython(cargar_reglas, migrations.RunPython.noop),
    ]
