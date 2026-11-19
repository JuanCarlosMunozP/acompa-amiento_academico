"""HU-01.08 (activar y desactivar cuentas, bloqueo del login), HU-01.09 (datos personales)
y HU-01.10 (cierre de sesión)."""

import pytest
from django.core import mail
from rest_framework.test import APIClient

from usuarios.models import CambioEstado, PerfilTutor, Usuario
from usuarios.roles import Rol

pytestmark = pytest.mark.django_db

CLAVE = "Clave-segura-2026"


def crear(email, rol=Rol.ESTUDIANTE, nombres="N", apellidos="A", **extra):
    return Usuario.objects.create_user(
        email, CLAVE, nombres=nombres, apellidos=apellidos, email_verificado=True, rol=rol, **extra
    )


def login(email, password=CLAVE):
    return APIClient().post(
        "/api/auth/login/", {"email": email, "password": password}, format="json"
    )


def cliente(usuario):
    c = APIClient()
    r = login(usuario.email)
    assert r.status_code == 200, r.json()
    c.credentials(HTTP_AUTHORIZATION="Bearer " + r.json()["access"])
    return c


def url(u):
    return f"/api/usuarios/{u.pk}/estado/"


@pytest.fixture
def admin():
    return crear("admin@colegio.edu.co", Rol.ADMINISTRADOR)


@pytest.fixture
def ana():
    return crear("ana@colegio.edu.co", nombres="Ana", apellidos="Ruiz")


def poner(quien, objetivo, activo, **extra):
    return cliente(quien).put(url(objetivo), {"activo": activo, **extra}, format="json")


# ---------------- HU-01.08.T1: cambio de estado ----------------


def test_el_administrador_desactiva_y_reactiva_una_cuenta(admin, ana):
    r = poner(admin, ana, False, motivo="Retiro del colegio")
    assert r.status_code == 200
    assert r.json() == {"id": ana.pk, "email": "ana@colegio.edu.co", "activo": False}
    ana.refresh_from_db()
    assert ana.is_active is False

    assert poner(admin, ana, True).json()["activo"] is True
    ana.refresh_from_db()
    assert ana.is_active is True


def test_cada_cambio_queda_en_el_historial_con_quien_cuando_y_por_que(admin, ana):
    poner(admin, ana, False, motivo="  Retiro del colegio  ")
    (cambio,) = CambioEstado.objects.all()
    assert cambio.usuario == ana and cambio.cambiado_por == admin
    assert cambio.activo is False and cambio.motivo == "Retiro del colegio" and cambio.fecha


def test_repetir_el_mismo_estado_no_genera_historial(admin, ana):
    assert poner(admin, ana, True).status_code == 200
    assert CambioEstado.objects.count() == 0


def test_el_motivo_es_opcional_y_tiene_tope(admin, ana):
    assert poner(admin, ana, False).status_code == 200
    assert poner(admin, ana, True, motivo="x" * 201).status_code == 400


def test_solo_el_administrador_cambia_el_estado(ana):
    for rol in (Rol.COORDINADOR, Rol.TUTOR, Rol.ESTUDIANTE):
        quien = crear(f"{rol.value}@colegio.edu.co", rol)
        assert poner(quien, ana, False).status_code == 403
    ana.refresh_from_db()
    assert ana.is_active


def test_el_coordinador_puede_consultar_el_estado_pero_no_cambiarlo(ana):
    coord = crear("coord@colegio.edu.co", Rol.COORDINADOR)
    r = cliente(coord).get(url(ana))
    assert r.status_code == 200 and r.json()["activo"] is True


def test_un_estudiante_no_consulta_el_estado_de_otros(ana):
    otro = crear("otro@colegio.edu.co")
    assert cliente(otro).get(url(ana)).status_code == 403


def test_nadie_desactiva_su_propia_cuenta(admin):
    r = poner(admin, admin, False)
    assert r.status_code == 403 and r.json()["error"]["code"] == "no_puedes_cambiar_tu_estado"
    admin.refresh_from_db()
    assert admin.is_active


def test_requiere_sesion_y_usuario_existente(admin):
    assert (
        APIClient().put("/api/usuarios/1/estado/", {"activo": False}, format="json").status_code
        == 401
    )
    r = cliente(admin).put("/api/usuarios/999999/estado/", {"activo": False}, format="json")
    assert r.status_code == 404


def test_el_valor_activo_es_obligatorio(admin, ana):
    assert cliente(admin).put(url(ana), {}, format="json").status_code == 400


def test_desactivar_cierra_todas_las_sesiones_de_la_cuenta(admin, ana):
    sesion = login(ana.email).json()
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION="Bearer " + sesion["access"])
    assert c.get("/api/auth/me/").status_code == 200

    poner(admin, ana, False)

    assert c.get("/api/auth/me/").status_code == 401  # el access ya no sirve
    r = APIClient().post("/api/auth/refresh/", {"refresh": sesion["refresh"]}, format="json")
    assert r.status_code == 401  # ni se puede renovar la sesión


def test_reactivar_no_devuelve_las_sesiones_viejas_pero_permite_volver_a_entrar(admin, ana):
    viejo = login(ana.email).json()["refresh"]
    poner(admin, ana, False)
    poner(admin, ana, True)
    assert (
        APIClient().post("/api/auth/refresh/", {"refresh": viejo}, format="json").status_code == 401
    )
    assert login(ana.email).status_code == 200


def test_desactivar_a_un_tutor_lo_deja_no_disponible_y_fuera_del_listado(admin):
    t = crear("t@colegio.edu.co", Rol.TUTOR)
    perfil = t.perfil_tutor
    perfil.habilitado = True
    perfil.disponible = True
    perfil.save()
    poner(admin, t, False)
    perfil.refresh_from_db()
    assert perfil.disponible is False and perfil.habilitado is True  # conserva su habilitación
    assert cliente(admin).get("/api/tutores/").json()["count"] == 0


def test_el_historial_se_conserva_si_se_borra_a_quien_hizo_el_cambio(admin, ana):
    poner(admin, ana, False)
    Usuario.objects.filter(pk=admin.pk).delete()
    assert CambioEstado.objects.get().cambiado_por is None


def test_filtrar_el_listado_de_usuarios_por_estado(admin, ana):
    poner(admin, ana, False)
    c = cliente(admin)
    assert [u["email"] for u in c.get("/api/usuarios/", {"activo": "false"}).json()["results"]] == [
        "ana@colegio.edu.co"
    ]
    assert c.get("/api/usuarios/", {"activo": "true"}).json()["count"] == 1  # solo el admin
    assert c.get("/api/usuarios/").json()["count"] == 2  # sin filtro salen todos
    assert c.get("/api/usuarios/", {"activo": "tal vez"}).status_code == 400


# ---------------- HU-01.08.T2: bloqueo del login ----------------


def test_una_cuenta_desactivada_no_puede_iniciar_sesion_y_se_le_explica_por_que(admin, ana):
    poner(admin, ana, False)
    r = login(ana.email)
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "cuenta_desactivada"
    assert "desactivada" in r.json()["error"]["message"]
    assert "access" not in r.json()


def test_con_clave_incorrecta_no_se_revela_que_la_cuenta_esta_desactivada(admin, ana):
    poner(admin, ana, False)
    r = login(ana.email, "clave-incorrecta")
    assert r.status_code == 401 and r.json()["error"]["code"] == "credenciales_invalidas"


def test_intentos_fallidos_sobre_una_cuenta_desactivada_igual_cuentan_para_el_bloqueo(admin, ana):
    poner(admin, ana, False)
    for _ in range(5):
        login(ana.email, "mala")
    ana.refresh_from_db()
    assert ana.intentos_fallidos == 5 and ana.esta_bloqueado()


def test_al_reactivar_la_cuenta_vuelve_a_entrar(admin, ana):
    poner(admin, ana, False)
    poner(admin, ana, True)
    assert login(ana.email).status_code == 200


def test_una_cuenta_desactivada_no_recibe_correos_de_recuperacion_ni_de_verificacion(admin, ana):
    poner(admin, ana, False)
    APIClient().post("/api/auth/recuperar/", {"email": ana.email}, format="json")
    APIClient().post("/api/auth/reenviar-verificacion/", {"email": ana.email}, format="json")
    assert len(mail.outbox) == 0


# ---------------- HU-01.09: datos personales ----------------

ME = "/api/auth/me/"


def test_la_persona_edita_sus_nombres_y_apellidos(ana):
    r = cliente(ana).patch(ME, {"nombres": "Ana María", "apellidos": "Ruiz Gómez"}, format="json")
    assert r.status_code == 200
    assert r.json()["nombres"] == "Ana María" and r.json()["apellidos"] == "Ruiz Gómez"
    ana.refresh_from_db()
    assert (ana.nombres, ana.apellidos) == ("Ana María", "Ruiz Gómez")


def test_se_puede_cambiar_solo_un_campo(ana):
    r = cliente(ana).patch(ME, {"nombres": "Anita"}, format="json")
    assert r.json()["nombres"] == "Anita" and r.json()["apellidos"] == "Ruiz"


def test_los_espacios_sobrantes_se_limpian(ana):
    r = cliente(ana).patch(ME, {"nombres": "  Ana   María  "}, format="json")
    assert r.json()["nombres"] == "Ana María"


@pytest.mark.parametrize("valor", ["", "   "])
def test_no_se_aceptan_nombres_vacios(ana, valor):
    c = cliente(ana)
    for campo in ("nombres", "apellidos"):
        r = c.patch(ME, {campo: valor}, format="json")
        assert r.status_code == 400 and campo in r.json()["error"]["details"]
    ana.refresh_from_db()
    assert (ana.nombres, ana.apellidos) == ("Ana", "Ruiz")


def test_tope_de_150_caracteres(ana):
    c = cliente(ana)
    assert c.patch(ME, {"nombres": "x" * 150}, format="json").status_code == 200
    assert c.patch(ME, {"nombres": "x" * 151}, format="json").status_code == 400


def test_el_correo_el_rol_y_el_estado_no_se_pueden_cambiar_desde_aqui(ana):
    r = cliente(ana).patch(
        ME,
        {
            "email": "otro@x.co",
            "rol": "administrador",
            "is_active": False,
            "email_verificado": False,
        },
        format="json",
    )
    assert r.status_code == 200
    ana.refresh_from_db()
    assert ana.email == "ana@colegio.edu.co" and ana.rol == Rol.ESTUDIANTE
    assert ana.is_active and ana.email_verificado


def test_cada_persona_solo_edita_sus_propios_datos(ana):
    otro = crear("otro@colegio.edu.co", nombres="Otro", apellidos="Apellido")
    cliente(ana).patch(ME, {"nombres": "Cambiado"}, format="json")
    otro.refresh_from_db()
    assert otro.nombres == "Otro"


def test_editar_datos_requiere_sesion():
    assert APIClient().patch(ME, {"nombres": "X"}, format="json").status_code == 401


def test_un_cuerpo_vacio_no_cambia_nada(ana):
    r = cliente(ana).patch(ME, {}, format="json")
    assert r.status_code == 200 and r.json()["nombres"] == "Ana"


def test_el_cambio_se_refleja_al_iniciar_sesion_de_nuevo(ana):
    cliente(ana).patch(ME, {"nombres": "Anita"}, format="json")
    assert login(ana.email).json()["usuario"]["nombres"] == "Anita"


def test_editar_datos_no_toca_el_perfil_del_tutor(admin):
    t = crear("t@colegio.edu.co", Rol.TUTOR, "Luis", "Pérez")
    cliente(t).patch(ME, {"nombres": "Luisa"}, format="json")
    assert PerfilTutor.objects.filter(usuario=t).count() == 1


# ---------------- HU-01.10: cierre de sesión ----------------


def test_cerrar_sesion_invalida_el_refresh_y_es_idempotente(ana):
    refresh = login(ana.email).json()["refresh"]
    c = APIClient()
    assert c.post("/api/auth/logout/", {"refresh": refresh}, format="json").status_code == 204
    assert c.post("/api/auth/refresh/", {"refresh": refresh}, format="json").status_code == 401
    assert c.post("/api/auth/logout/", {"refresh": refresh}, format="json").status_code == 204


def test_cerrar_sesion_en_un_dispositivo_no_cierra_las_de_otros(ana):
    uno = login(ana.email).json()["refresh"]
    dos = login(ana.email).json()["refresh"]
    APIClient().post("/api/auth/logout/", {"refresh": uno}, format="json")
    assert (
        APIClient().post("/api/auth/refresh/", {"refresh": dos}, format="json").status_code == 200
    )


def test_cerrar_sesion_no_requiere_que_el_access_siga_vigente(ana):
    # La persona debe poder salir aunque su access ya haya vencido: solo hace falta el refresh.
    refresh = login(ana.email).json()["refresh"]
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION="Bearer token-vencido-o-invalido")
    assert c.post("/api/auth/logout/", {"refresh": refresh}, format="json").status_code == 204


def test_cerrar_sesion_exige_el_refresh(ana):
    assert APIClient().post("/api/auth/logout/", {}, format="json").status_code == 400


def test_el_refresh_de_otra_persona_no_se_puede_usar_para_salir_de_su_sesion_sin_tenerlo(ana):
    # Sin el refresh (secreto) no se puede cerrar la sesión de nadie.
    otro = crear("otro@colegio.edu.co")
    login(otro.email)
    assert (
        APIClient().post("/api/auth/logout/", {"refresh": "adivinado"}, format="json").status_code
        == 204
    )
    assert (
        APIClient()
        .post("/api/auth/refresh/", {"refresh": login(otro.email).json()["refresh"]}, format="json")
        .status_code
        == 200
    )
