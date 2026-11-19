from decimal import Decimal

import django.core.validators
import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("seguimiento", "0002_reglas_iniciales"),
        ("planes", "0006_bitacora_y_materiales_sesion"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="EvaluacionPosterior",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("nota_inicial", models.DecimalField(decimal_places=2, max_digits=3)),
                (
                    "nota_posterior",
                    models.DecimalField(
                        decimal_places=2,
                        max_digits=3,
                        validators=[
                            django.core.validators.MinValueValidator(Decimal("1.00")),
                            django.core.validators.MaxValueValidator(Decimal("5.00")),
                        ],
                    ),
                ),
                ("observaciones", models.CharField(blank=True, max_length=500)),
                ("fecha_registro", models.DateTimeField(default=django.utils.timezone.now)),
                (
                    "plan",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="evaluacion_posterior",
                        to="planes.planrefuerzo",
                    ),
                ),
                (
                    "registrada_por",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ["-fecha_registro"]},
        ),
    ]
