import pytest
from django.core.cache import cache


@pytest.fixture(autouse=True)
def _limpiar_cache():
    """El límite de reenvíos usa la caché; se limpia entre pruebas."""
    cache.clear()
