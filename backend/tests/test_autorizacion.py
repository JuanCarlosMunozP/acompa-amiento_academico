import re

import pytest
from django.urls import URLPattern, URLResolver, get_resolver
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate

from usuarios.models import Usuario
from usuarios.permisos import (
    EsAdministrador,
    EsAdministradorOCoordinador,
    EsTutor,
    rol_requerido,
    tiene_rol,
)
from usuarios.roles import Rol

pytestmark = pytest.mark.django_db

CLAVE = "Clave-segura-2026"


def crear(email, rol=Rol.ESTUDIANTE, **extra):
    return Usuario.objects.create_user(
        email, CLAVE, nombres="N", apellidos="A", email_verificado=True, rol=rol, **extra
    )


def llamar(permiso, usuario):
    """Ejecuta una vista mínima protegida por `permiso` y devuelve el código HTTP."""

    @api_view(["GET"])
    @permission_classes([permiso])
    def vista(request):
        return Response({"ok": True})

    peticion = APIRequestFactory().get("/")
    if usuario is not None:
        force_authenticate(peticion, user=usuario)
    return vista(peticion).status_code


# --- rol_requerido ---


@pytest.mark.parametrize(
    ("permiso", "permitidos"),
    [
        (EsAdministrador, {Rol.ADMINISTRADOR, Rol.SUPERADMIN}),
        (EsTutor, {Rol.TUTOR}),
        (EsAdministradorOCoordinador, {Rol.ADMINISTRADOR, Rol.SUPERADMIN, Rol.COORDINADOR}),
        (rol_requerido(Rol.ESTUDIANTE, Rol.TUTOR), {Rol.ESTUDIANTE, Rol.TUTOR}),
    ],
)
def test_cada_permiso_deja_pasar_solo_a_sus_roles(permiso, permitidos):
    for rol in Rol:
        usuario = crear(f"{rol.value}@colegio.edu.co", rol)
        esperado = 200 if rol in permitidos else 403
        assert llamar(permiso, usuario) == esperado, rol


def test_sin_sesion_es_401_y_no_403():
    assert llamar(EsAdministrador, None) == 401


def test_un_usuario_inactivo_no_pasa_aunque_tenga_el_rol():
    admin = crear("admin@colegio.edu.co", Rol.ADMINISTRADOR)
    admin.is_active = False
    assert llamar(EsAdministrador, admin) == 403


def test_tiene_rol_con_usuarios_no_validos():
    assert tiene_rol(None, Rol.ADMINISTRADOR) is False
    assert tiene_rol(crear("a@colegio.edu.co"), Rol.ADMINISTRADOR) is False


def test_rol_requerido_sin_roles_es_un_error():
    with pytest.raises(ValueError):
        rol_requerido()


def test_el_mensaje_de_error_nombra_los_roles_permitidos():
    assert "administrador" in EsAdministrador.message
    assert "coordinador" in EsAdministradorOCoordinador.message


def test_la_respuesta_de_rechazo_usa_el_formato_de_errores_de_la_api():
    cliente = APIClient()
    est = crear("ana@colegio.edu.co")
    r = cliente.post("/api/auth/login/", {"email": est.email, "password": CLAVE}, format="json")
    cliente.credentials(HTTP_AUTHORIZATION="Bearer " + r.json()["access"])
    r = cliente.put(f"/api/usuarios/{est.pk}/rol/", {"rol": "tutor"}, format="json")
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "permission_denied"
    assert "administrador" in r.json()["error"]["message"]


# --- el rol se lee de la base en cada petición ---


def _cliente(usuario):
    c = APIClient()
    r = c.post("/api/auth/login/", {"email": usuario.email, "password": CLAVE}, format="json")
    c.credentials(HTTP_AUTHORIZATION="Bearer " + r.json()["access"])
    return c


def test_degradar_a_un_administrador_le_quita_el_acceso_de_inmediato():
    admin = crear("admin@colegio.edu.co", Rol.ADMINISTRADOR)
    otro = crear("otro@colegio.edu.co")
    c = _cliente(admin)
    assert c.get(f"/api/usuarios/{otro.pk}/rol/").status_code == 200

    Usuario.objects.filter(pk=admin.pk).update(rol=Rol.ESTUDIANTE)  # con el token ya emitido
    assert (
        c.put(f"/api/usuarios/{otro.pk}/rol/", {"rol": "tutor"}, format="json").status_code == 403
    )


def test_desactivar_una_cuenta_invalida_su_token_vigente():
    u = crear("ana@colegio.edu.co")
    c = _cliente(u)
    assert c.get("/api/auth/me/").status_code == 200
    Usuario.objects.filter(pk=u.pk).update(is_active=False)
    assert c.get("/api/auth/me/").status_code == 401


# --- denegar por defecto: ningún endpoint queda abierto por accidente ---

# Única lista de endpoints públicos. Agregar uno aquí es una decisión consciente.
PUBLICOS = {
    "api/",  # índices informativos de rutas
    "api/auth/",
    "api/health/",
    "api/auth/registro/",
    "api/auth/login/",
    "api/auth/mfa/verificar/",  # 2.º paso del login: aún no hay sesión; exige mfa_token + código
    # Verificación de dispositivo nuevo: aún no hay sesión; exige desafio_token + código del correo
    "api/auth/dispositivo/verificar/",
    "api/auth/verificar-correo/",
    "api/auth/reenviar-verificacion/",
    "api/auth/logout/",
    "api/auth/recuperar/",
    "api/auth/recuperar/confirmar/",
    "api/auth/refresh/",
}


def _rutas_api(patrones=None, prefijo=""):
    for p in patrones if patrones is not None else get_resolver().url_patterns:
        texto = prefijo + str(p.pattern)
        if isinstance(p, URLResolver):
            yield from _rutas_api(p.url_patterns, texto)
        elif isinstance(p, URLPattern) and texto.startswith("api/"):
            yield texto, p.callback


def _es_publica(vista):
    cls = getattr(vista, "cls", None) or getattr(vista, "view_class", None)
    permisos = getattr(cls, "permission_classes", None)
    return not permisos or AllowAny in permisos


def test_los_endpoints_publicos_son_exactamente_los_esperados():
    publicos = {ruta for ruta, vista in _rutas_api() if _es_publica(vista)}
    assert publicos == PUBLICOS


def test_los_endpoints_no_publicos_responden_401_sin_sesion():
    cliente = APIClient()
    revisadas = 0
    for ruta, vista in _rutas_api():
        if ruta in PUBLICOS:
            continue
        cls = getattr(vista, "cls", None) or vista.view_class
        # Parámetros de la ruta (<int:pk>, <str:fecha>...) reemplazados por valores de ejemplo.
        url = "/" + re.sub(r"<str:\w+>", "2026-01-05", re.sub(r"<int:\w+>", "1", ruta))
        for metodo in (m for m in cls.http_method_names if m in cls.__dict__ or hasattr(cls, m)):
            if metodo in ("options", "head"):
                continue
            r = getattr(cliente, metodo)(url, {}, format="json")
            assert r.status_code == 401, f"{metodo.upper()} {url} -> {r.status_code}"
            revisadas += 1
    assert revisadas >= 3  # roles, rol de usuario (GET y PUT), me


def test_los_endpoints_publicos_ignoran_una_cabecera_authorization_invalida():
    # Un access vencido (dura 15 min) no debe impedir registrarse, iniciar sesión, recuperar la
    # contraseña ni cerrar sesión: esos endpoints son anónimos y no deben validar el token.
    cliente = APIClient()
    cliente.credentials(HTTP_AUTHORIZATION="Bearer token-vencido-o-basura")
    revisadas = 0
    for ruta, vista in _rutas_api():
        if ruta not in PUBLICOS:
            continue
        cls = getattr(vista, "cls", None) or vista.view_class
        for metodo in cls.http_method_names:
            if metodo in ("options", "head") or not hasattr(cls, metodo):
                continue
            r = getattr(cliente, metodo)("/" + ruta, {}, format="json")
            cuerpo = r.json() if r.content else {}
            codigo = cuerpo.get("error", {}).get("code") if isinstance(cuerpo, dict) else None
            assert codigo != "token_not_valid", f"{metodo.upper()} /{ruta} validó el token"
            revisadas += 1
    assert revisadas >= len(PUBLICOS)
