from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [
        ("planes", "0009_alter_notificacionacompanamiento_tipo"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ValoracionTutoria",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("calificacion", models.PositiveSmallIntegerField()),
                ("comentario", models.CharField(blank=True, max_length=1000)),
                ("fecha_creacion", models.DateTimeField(default=django.utils.timezone.now)),
                (
                    "estudiante",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="valoraciones_tutorias",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "sesion",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="valoracion",
                        to="planes.sesiontutoria",
                    ),
                ),
            ],
        ),
        migrations.AddConstraint(
            model_name="valoraciontutoria",
            constraint=models.CheckConstraint(
                condition=models.Q(("calificacion__gte", 1), ("calificacion__lte", 5)),
                name="valoracion_tutoria_1_a_5",
            ),
        ),
    ]
