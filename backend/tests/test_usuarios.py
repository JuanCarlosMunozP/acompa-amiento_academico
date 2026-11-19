import pytest
from django.db import IntegrityError

from usuarios.models import Rol, Usuario

pytestmark = pytest.mark.django_db


def test_crear_usuario_por_defecto_es_estudiante_sin_verificar():
    u = Usuario.objects.create_user(
        "Ana@colegio.edu.co", "clave-segura-123", nombres="Ana", apellidos="Ruiz"
    )
    assert u.email == "Ana@colegio.edu.co"
    assert u.rol == Rol.ESTUDIANTE
    assert not u.email_verificado
    assert u.check_password("clave-segura-123")


def test_correo_unico_sin_distinguir_mayusculas():
    Usuario.objects.create_user("ana@colegio.edu.co", "x" * 12, nombres="Ana", apellidos="Ruiz")
    with pytest.raises(IntegrityError):
        Usuario.objects.create_user("ANA@colegio.edu.co", "x" * 12, nombres="Ana", apellidos="R")


def test_superusuario_es_superadministrador_verificado():
    u = Usuario.objects.create_superuser(
        "admin@colegio.edu.co", "x" * 12, nombres="A", apellidos="B"
    )
    assert u.is_staff and u.is_superuser and u.email_verificado
    assert u.rol == Rol.SUPERADMIN
