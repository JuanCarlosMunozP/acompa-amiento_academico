from decimal import Decimal

import pytest

from seguimiento.models import EvaluacionPosterior


@pytest.mark.parametrize(
    ("inicial", "posterior", "mejora", "efectiva"),
    [
        ("2.40", "2.99", "0.59", False),
        ("2.40", "3.00", "0.60", True),
        ("3.50", "3.00", "-0.50", False),
        ("3.00", "3.00", "0.00", False),
    ],
)
def test_mejora_y_umbral_de_recuperacion(inicial, posterior, mejora, efectiva):
    evaluacion = EvaluacionPosterior(
        nota_inicial=Decimal(inicial), nota_posterior=Decimal(posterior)
    )

    assert evaluacion.mejora == Decimal(mejora)
    assert evaluacion.recuperacion_efectiva is efectiva
