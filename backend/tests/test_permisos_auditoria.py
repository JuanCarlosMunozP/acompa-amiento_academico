import pytest
from rest_framework.test import APIClient

from usuarios.models import EventoAuditoria, Usuario
from usuarios.permisos import PERMISOS_PILOTO, tiene_capacidad
from usuarios.roles import Rol

pytestmark = pytest.mark.django_db

CLAVE = "Clave-segura-2026"


def crear(email, rol):
    return Usuario.objects.create_user(
        email, CLAVE, nombres="Nombre", apellidos="Prueba", email_verificado=True, rol=rol
    )


def cliente(usuario):
    api = APIClient()
    respuesta = api.post(
        "/api/auth/login/", {"email": usuario.email, "password": CLAVE}, format="json"
    )
    assert respuesta.status_code == 200
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {respuesta.json()['access']}")
    return api


def test_matriz_de_permisos_del_piloto_es_explicita_y_consistente():
    assert set(PERMISOS_PILOTO) == set(Rol)
    assert "administrar_roles" in PERMISOS_PILOTO[Rol.ADMINISTRADOR]
    assert "gestionar_institucion" in PERMISOS_PILOTO[Rol.COORDINADOR]
    assert "gestionar_institucion" not in PERMISOS_PILOTO[Rol.TUTOR]
    assert "registrar_nivelacion" in PERMISOS_PILOTO[Rol.TUTOR]
    assert "consultar_estudiantes_vinculados" in PERMISOS_PILOTO[Rol.ACUDIENTE]
    assert "registrar_nivelacion" not in PERMISOS_PILOTO[Rol.ACUDIENTE]
    assert all(
        "consultar_notificaciones_propias" in capacidades
        for capacidades in PERMISOS_PILOTO.values()
    )


@pytest.mark.parametrize(
    ("capacidad", "permitidos"),
    [
        ("administrar_roles", {Rol.ADMINISTRADOR, Rol.SUPERADMIN}),
        ("gestionar_institucion", {Rol.ADMINISTRADOR, Rol.SUPERADMIN, Rol.COORDINADOR}),
        ("registrar_seguimiento", {Rol.ADMINISTRADOR, Rol.SUPERADMIN, Rol.COORDINADOR, Rol.TUTOR}),
        ("consultar_planes_personales", {Rol.TUTOR, Rol.ESTUDIANTE}),
        ("consultar_expedientes_propios", {Rol.TUTOR, Rol.ESTUDIANTE, Rol.ACUDIENTE}),
        ("registrar_nivelacion", {Rol.TUTOR}),
        ("verificar_nivelacion", {Rol.ADMINISTRADOR, Rol.SUPERADMIN, Rol.COORDINADOR}),
        ("gestionar_vinculos_acudiente", {Rol.ADMINISTRADOR, Rol.SUPERADMIN}),
        ("consultar_estudiantes_vinculados", {Rol.ACUDIENTE}),
    ],
)
def test_capacidades_solo_se_conceden_a_los_roles_del_piloto(capacidad, permitidos):
    for rol in Rol:
        usuario = crear(f"{capacidad}-{rol.value}@colegio.edu.co", rol)
        assert tiene_capacidad(usuario, capacidad) is (rol in permitidos)


@pytest.mark.parametrize(
    ("ruta", "permitidos"),
    [
        ("/api/auditoria/", {Rol.ADMINISTRADOR, Rol.SUPERADMIN, Rol.COORDINADOR}),
        ("/api/reglas/", {Rol.ADMINISTRADOR, Rol.SUPERADMIN, Rol.COORDINADOR}),
        ("/api/planes/", {Rol.ADMINISTRADOR, Rol.SUPERADMIN, Rol.COORDINADOR}),
        ("/api/mis-planes/", {Rol.TUTOR, Rol.ESTUDIANTE, Rol.ACUDIENTE}),
        ("/api/agenda-sesiones/", {Rol.TUTOR, Rol.ESTUDIANTE}),
        ("/api/mi-desempeno-tutorias/", {Rol.TUTOR, Rol.ESTUDIANTE}),
        (
            "/api/informes-bitacoras/",
            {Rol.ADMINISTRADOR, Rol.SUPERADMIN, Rol.COORDINADOR, Rol.TUTOR},
        ),
        ("/api/mis-notificaciones/", set(Rol)),
        ("/api/mis-preferencias-notificacion/", set(Rol)),
        ("/api/estudiantes/", {Rol.ADMINISTRADOR, Rol.SUPERADMIN, Rol.COORDINADOR, Rol.TUTOR}),
        ("/api/mis-estudiantes-vinculados/", {Rol.ACUDIENTE}),
        ("/api/vinculos-acudiente/", {Rol.ADMINISTRADOR, Rol.SUPERADMIN}),
    ],
)
def test_acceso_a_endpoints_por_rol(ruta, permitidos):
    for rol in Rol:
        usuario = crear(f"{ruta.strip('/').replace('/', '-')}-{rol.value}@colegio.edu.co", rol)
        respuesta = cliente(usuario).get(ruta)
        esperado = 200 if rol in permitidos else 403
        assert respuesta.status_code == esperado, f"{rol.value} GET {ruta}"


def test_cambio_de_rol_deja_evento_y_solo_coordinacion_consulta_la_bitacora():
    admin = crear("admin@colegio.edu.co", Rol.ADMINISTRADOR)
    objetivo = crear("objetivo@colegio.edu.co", Rol.ESTUDIANTE)

    respuesta = cliente(admin).put(
        f"/api/usuarios/{objetivo.pk}/rol/", {"rol": Rol.TUTOR}, format="json"
    )

    assert respuesta.status_code == 200
    evento = EventoAuditoria.objects.get(accion="rol.cambiado")
    assert evento.actor_id == admin.pk
    assert evento.actor_rol == Rol.ADMINISTRADOR
    assert evento.recurso_id == str(objetivo.pk)
    assert evento.detalles == {
        "rol_anterior": Rol.ESTUDIANTE,
        "rol_nuevo": Rol.TUTOR,
    }
    assert (
        cliente(crear("est@colegio.edu.co", Rol.ESTUDIANTE)).get("/api/auditoria/").status_code
        == 403
    )
    assert cliente(admin).get("/api/auditoria/?accion=rol.cambiado").json()["results"][0]["id"] == (
        evento.pk
    )


def test_la_ficha_de_estudiante_registra_quien_la_consulto():
    coordinador = crear("coordinacion@colegio.edu.co", Rol.COORDINADOR)
    estudiante = crear("estudiante@colegio.edu.co", Rol.ESTUDIANTE)

    respuesta = cliente(coordinador).get(f"/api/estudiantes/{estudiante.pk}/ficha/")

    assert respuesta.status_code == 200
    evento = EventoAuditoria.objects.get(accion="ficha.consultada")
    assert evento.actor_id == coordinador.pk
    assert evento.recurso_id == str(estudiante.pk)
    assert evento.detalles == {}
