import pytest
from rest_framework.test import APIClient

from usuarios.gestion_estado import cambiar_estado
from usuarios.gestion_roles import SoloSuperadmin, asignar_rol, exigir_superadmin_si_aplica
from usuarios.models import Usuario
from usuarios.permisos import ROLES_POR_CAPACIDAD, tiene_capacidad
from usuarios.roles import ROLES_ADMINISTRACION, Rol

pytestmark = pytest.mark.django_db

CLAVE = "Clave-segura-2026"


def crear(email, rol=Rol.ESTUDIANTE):
    return Usuario.objects.create_user(
        email, CLAVE, nombres="N", apellidos="A", email_verificado=True, rol=rol
    )


def cliente(usuario):
    c = APIClient()
    r = c.post("/api/auth/login/", {"email": usuario.email, "password": CLAVE}, format="json")
    assert r.status_code == 200, r.json()
    c.credentials(HTTP_AUTHORIZATION="Bearer " + r.json()["access"])
    return c


def test_createsuperuser_crea_un_superadministrador():
    u = Usuario.objects.create_superuser("yo@acompanamiento.local", CLAVE)
    assert u.rol == Rol.SUPERADMIN and u.is_superuser and u.is_staff


def test_el_superadmin_hereda_cada_capacidad_del_administrador():
    for capacidad, roles in ROLES_POR_CAPACIDAD.items():
        if Rol.ADMINISTRADOR in roles:
            assert Rol.SUPERADMIN in roles, capacidad
    assert ROLES_ADMINISTRACION == (Rol.ADMINISTRADOR, Rol.SUPERADMIN)


def test_solo_el_superadmin_tiene_la_capacidad_exclusiva():
    assert ROLES_POR_CAPACIDAD["administrar_superadmins"] == (Rol.SUPERADMIN,)
    assert tiene_capacidad(crear("s@x.co", Rol.SUPERADMIN), "administrar_superadmins")
    assert not tiene_capacidad(crear("a@x.co", Rol.ADMINISTRADOR), "administrar_superadmins")


def test_el_superadmin_puede_asignar_roles_por_la_api():
    sup = crear("sup@x.co", Rol.SUPERADMIN)
    ana = crear("ana@x.co")
    r = cliente(sup).put(f"/api/usuarios/{ana.pk}/rol/", {"rol": "tutor"}, format="json")
    assert r.status_code == 200 and r.json()["rol"] == "tutor"


def test_un_administrador_no_puede_otorgar_el_rol_de_superadmin():
    admin = crear("adm@x.co", Rol.ADMINISTRADOR)
    ana = crear("ana@x.co")
    r = cliente(admin).put(f"/api/usuarios/{ana.pk}/rol/", {"rol": "superadmin"}, format="json")
    assert r.status_code == 403 and r.json()["error"]["code"] == "solo_superadmin"
    ana.refresh_from_db()
    assert ana.rol == Rol.ESTUDIANTE


def test_un_administrador_no_puede_quitarle_el_rol_a_un_superadmin():
    admin = crear("adm@x.co", Rol.ADMINISTRADOR)
    sup = crear("sup@x.co", Rol.SUPERADMIN)
    r = cliente(admin).put(f"/api/usuarios/{sup.pk}/rol/", {"rol": "estudiante"}, format="json")
    assert r.status_code == 403
    sup.refresh_from_db()
    assert sup.rol == Rol.SUPERADMIN


def test_un_administrador_no_puede_desactivar_a_un_superadmin():
    admin = crear("adm@x.co", Rol.ADMINISTRADOR)
    sup = crear("sup@x.co", Rol.SUPERADMIN)
    r = cliente(admin).put(f"/api/usuarios/{sup.pk}/estado/", {"activo": False}, format="json")
    assert r.status_code == 403
    sup.refresh_from_db()
    assert sup.is_active


def test_un_superadmin_si_puede_otorgar_y_quitar_el_rol():
    sup = crear("sup@x.co", Rol.SUPERADMIN)
    otro = crear("otro@x.co", Rol.ADMINISTRADOR)
    assert asignar_rol(otro, Rol.SUPERADMIN, por=sup) is True
    otro.refresh_from_db()
    assert otro.rol == Rol.SUPERADMIN
    assert asignar_rol(otro, Rol.ADMINISTRADOR, por=sup) is True


def test_un_superadmin_puede_desactivar_a_otro_superadmin():
    sup = crear("sup@x.co", Rol.SUPERADMIN)
    otro = crear("otro@x.co", Rol.SUPERADMIN)
    assert cambiar_estado(otro, False, por=sup) is True


def test_la_regla_ignora_a_quien_no_toca_superadmins():
    admin = crear("adm@x.co", Rol.ADMINISTRADOR)
    ana = crear("ana@x.co")
    exigir_superadmin_si_aplica(ana, admin, Rol.TUTOR)
    with pytest.raises(SoloSuperadmin):
        exigir_superadmin_si_aplica(ana, admin, Rol.SUPERADMIN)


def test_el_superadmin_ve_los_planes_y_los_usuarios_como_coordinacion():
    sup = crear("sup@x.co", Rol.SUPERADMIN)
    r = cliente(sup).get("/api/usuarios/")
    assert r.status_code == 200
