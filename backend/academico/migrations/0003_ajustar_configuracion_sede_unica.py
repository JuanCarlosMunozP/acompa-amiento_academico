from django.db import migrations


def ajustar_sede_unica(apps, schema_editor):
    Institucion = apps.get_model("academico", "Institucion")
    Sede = apps.get_model("academico", "Sede")
    db = schema_editor.connection.alias
    tiene_varias_sedes = Sede.objects.using(db).count() > 1
    Institucion.objects.using(db).filter(pk=1).update(sede_unica=not tiene_varias_sedes)


class Migration(migrations.Migration):
    dependencies = [
        ("academico", "0002_institucion_sede_unica_sede_ciudad_sede_correo_and_more"),
    ]

    operations = [
        migrations.RunPython(ajustar_sede_unica, migrations.RunPython.noop),
    ]
