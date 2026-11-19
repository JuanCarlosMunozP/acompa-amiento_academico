import django.core.validators
import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("planes", "0005_sesiontutoria_asistencia_and_more"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="BitacoraSesion",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("temas", models.TextField(blank=True, max_length=2000)),
                ("desarrollo", models.TextField(max_length=4000)),
                ("acuerdos", models.TextField(blank=True, max_length=2000)),
                ("observaciones", models.TextField(blank=True, max_length=2000)),
                ("fecha_cierre", models.DateTimeField(default=django.utils.timezone.now)),
                (
                    "creada_por",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "sesion",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="bitacora",
                        to="planes.sesiontutoria",
                    ),
                ),
            ],
            options={"ordering": ["-fecha_cierre"]},
        ),
        migrations.CreateModel(
            name="MaterialSesion",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("titulo", models.CharField(max_length=120)),
                ("descripcion", models.CharField(blank=True, max_length=500)),
                (
                    "archivo",
                    models.FileField(
                        upload_to="planes.models.material_sesion_upload_path",
                        validators=[
                            django.core.validators.FileExtensionValidator(
                                [
                                    "pdf",
                                    "doc",
                                    "docx",
                                    "ppt",
                                    "pptx",
                                    "xls",
                                    "xlsx",
                                    "jpg",
                                    "jpeg",
                                    "png",
                                ]
                            )
                        ],
                    ),
                ),
                ("fecha_creacion", models.DateTimeField(default=django.utils.timezone.now)),
                (
                    "sesion",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="materiales",
                        to="planes.sesiontutoria",
                    ),
                ),
                (
                    "subido_por",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ["-fecha_creacion"]},
        ),
    ]
