import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("planes", "0006_bitacora_y_materiales_sesion"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="NotificacionAcompanamiento",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                (
                    "tipo",
                    models.CharField(
                        choices=[
                            ("plan", "Plan de recuperación"),
                            ("sesion", "Sesión de tutoría"),
                            ("material", "Material de sesión"),
                            ("cierre", "Cierre de acompañamiento"),
                        ],
                        max_length=12,
                    ),
                ),
                ("titulo", models.CharField(max_length=140)),
                ("mensaje", models.CharField(max_length=500)),
                ("creada", models.DateTimeField(default=django.utils.timezone.now)),
                ("leida", models.DateTimeField(blank=True, null=True)),
                (
                    "destinatario",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="notificaciones_acompanamiento",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "plan",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        to="planes.planrefuerzo",
                    ),
                ),
                (
                    "sesion",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        to="planes.sesiontutoria",
                    ),
                ),
            ],
            options={"ordering": ["-creada", "-id"]},
        ),
    ]
