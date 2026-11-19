"""Cobertura de modelos, admin, señales, permisos, serializers y utilidades pequeñas.

Cada prueba apunta a una rama concreta que el resto de la suite no ejercitaba.
"""

import datetime
from unittest import mock

import pytest
from django.apps import apps
from django.contrib import admin
from django.contrib.messages.storage.fallback import FallbackStorage
from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, models
from django.test import RequestFactory
from django.utils import timezone
from rest_framework import serializers

from academico.models import DiaNoHabil, Institucion, Matricula, PeriodoAcademico
from academico.serializers import (
    DiaNoHabilSerializer,
    GrupoAdminSerializer,
    PeriodoSerializer,
)
from academico.servicios import leer_csv
from common.crud import guardar
from common.exceptions import _codigo_por_tipo
from usuarios import mfa
from usuarios.models import (
    CambioRol,
    EventoAuditoria,
    Grado,
    Grupo,
    Usuario,
    VinculoAcudiente,
)
from usuarios.permisos import capacidad_requerida, tiene_capacidad
from usuarios.roles import Rol
from usuarios.serializers import ActualizarDatosPersonalesSerializer, RegistroSerializer

CLAVE = "Clave-segura-2026"


def crear(email, rol=Rol.ESTUDIANTE, **extra):
    return Usuario.objects.create_user(
        email, CLAVE, nombres="N", apellidos="A", email_verificado=True, rol=rol, **extra
    )


def peticion(usuario=None):
    r = RequestFactory().post("/admin/")
    r.user = usuario
    r.session = {}
    r._messages = FallbackStorage(r)
    return r


# --- __str__ de todos los modelos del proyecto ---------------------------------------------


def _valor_para(campo, profundidad):
    if isinstance(campo, models.ForeignKey | models.OneToOneField):
        return _instancia(campo.related_model, profundidad + 1)
    if campo.choices:
        return campo.choices[0][0]
    if isinstance(campo, models.DateTimeField):
        return timezone.now()
    if isinstance(campo, models.DateField):
        return datetime.date(2026, 1, 15)
    if isinstance(campo, models.TimeField):
        return datetime.time(8, 0)
    if isinstance(campo, models.BooleanField):
        return True
    if isinstance(campo, models.DecimalField):
        return 3
    if isinstance(campo, models.IntegerField):
        return 1
    if isinstance(campo, models.JSONField):
        return {}
    return "texto"


def _instancia(modelo, profundidad=0):
    """Instancia SIN guardar, con relaciones también sin guardar: basta para `str()`."""
    datos = {}
    for campo in modelo._meta.concrete_fields:
        if campo.primary_key or campo.name in ("password",):
            continue
        if profundidad > 2 and isinstance(campo, models.ForeignKey | models.OneToOneField):
            continue
        datos[campo.name] = _valor_para(campo, profundidad)
    return modelo(**datos)


MODELOS = [
    m
    for m in apps.get_models()
    if m._meta.app_label in ("usuarios", "academico", "seguimiento", "planes")
]


@pytest.mark.parametrize("modelo", MODELOS, ids=lambda m: m.__name__)
def test_str_de_cada_modelo_devuelve_texto(modelo):
    texto = str(_instancia(modelo))
    assert isinstance(texto, str) and texto


def test_hay_modelos_que_probar():
    assert len(MODELOS) > 25


# --- admin ---------------------------------------------------------------------------------


@pytest.mark.django_db
def test_institucion_admin_permite_un_solo_registro_y_no_se_borra():
    a = admin.site._registry[Institucion]
    Institucion.objects.all().delete()
    assert a.has_add_permission(peticion()) is True
    Institucion.objects.create(pk=1, nombre="Colegio")
    assert a.has_add_permission(peticion()) is False
    assert a.has_delete_permission(peticion()) is False


@pytest.mark.django_db
def test_admin_de_usuarios_restablece_mfa_solo_de_cuentas_con_mfa():
    activo = crear("con@colegio.edu.co", mfa_activo=True, mfa_secreto="x")
    crear("sin@colegio.edu.co")
    admin_user = crear("admin@colegio.edu.co", Rol.ADMINISTRADOR)
    a = admin.site._registry[Usuario]
    req = peticion(admin_user)
    a.restablecer_mfa(req, Usuario.objects.all())
    activo.refresh_from_db()
    assert activo.mfa_activo is False and activo.mfa_secreto == ""
    assert EventoAuditoria.objects.filter(accion="mfa_restablecido").count() == 1
    assert "MFA restablecido en 1 cuenta(s)." in [str(m) for m in req._messages]


@pytest.mark.django_db
def test_admin_de_cambios_de_rol_es_de_solo_lectura():
    a = admin.site._registry[CambioRol]
    req = peticion()
    assert a.has_add_permission(req) is False
    assert a.has_change_permission(req) is False
    assert a.has_delete_permission(req) is False


def test_inline_de_historial_de_seguimiento_no_permite_agregar():
    from seguimiento.admin import CambioNotaInline
    from seguimiento.models import Resultado

    assert CambioNotaInline(Resultado, admin.site).has_add_permission(peticion()) is False


# --- modelos -------------------------------------------------------------------------------


@pytest.mark.django_db
def test_crear_usuario_sin_correo_falla():
    with pytest.raises(ValueError, match="obligatorio"):
        Usuario.objects.create_user("", CLAVE)


@pytest.mark.django_db
def test_minutos_de_bloqueo_restantes():
    u = crear("a@colegio.edu.co")
    assert u.minutos_de_bloqueo_restantes() == 0
    u.bloqueado_hasta = timezone.now() + datetime.timedelta(minutes=10)
    assert u.minutos_de_bloqueo_restantes() >= 10


@pytest.mark.django_db
def test_vinculo_acudiente_valida_los_roles():
    acudiente = crear("ac@colegio.edu.co", Rol.ACUDIENTE)
    estudiante = crear("es@colegio.edu.co")
    tutor = crear("tu@colegio.edu.co", Rol.TUTOR)
    with pytest.raises(DjangoValidationError, match="acudiente"):
        VinculoAcudiente(acudiente=tutor, estudiante=estudiante).save()
    with pytest.raises(DjangoValidationError, match="estudiante"):
        VinculoAcudiente(acudiente=acudiente, estudiante=tutor).save()
    VinculoAcudiente(acudiente=acudiente, estudiante=estudiante).save()


@pytest.mark.django_db
def test_notificacion_no_leida_y_exigir_estudiante():
    from planes.models import NotificacionAcompanamiento
    from seguimiento.models import _exigir_estudiante

    n = NotificacionAcompanamiento(leida=None)
    assert n.no_leida is True
    n.leida = timezone.now()
    assert n.no_leida is False
    _exigir_estudiante(crear("e@colegio.edu.co"))
    with pytest.raises(DjangoValidationError, match="estudiante"):
        _exigir_estudiante(crear("t@colegio.edu.co", Rol.TUTOR))


@pytest.mark.django_db
def test_senal_ignora_la_carga_de_fixtures():
    from usuarios.signals import asegurar_perfil_segun_rol

    u = crear("tutor2@colegio.edu.co", Rol.TUTOR)
    u.perfil_tutor.delete()
    asegurar_perfil_segun_rol(Usuario, Usuario.objects.get(pk=u.pk), raw=True)
    assert not hasattr(Usuario.objects.get(pk=u.pk), "perfil_tutor")


# --- permisos ------------------------------------------------------------------------------


def test_capacidad_inexistente_es_un_error_de_programacion():
    with pytest.raises(ValueError, match="no definida"):
        tiene_capacidad(None, "no_existe")
    with pytest.raises(ValueError, match="no definida"):
        capacidad_requerida("no_existe")


# --- serializers ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_registro_con_correo_duplicado_simultaneo_da_400_legible():
    s = RegistroSerializer()
    with mock.patch.object(Usuario.objects, "create_user", side_effect=IntegrityError):
        with pytest.raises(serializers.ValidationError) as e:
            s.create({"email": "x@colegio.edu.co"})
    assert "email" in e.value.detail


def test_nombres_en_blanco_se_rechazan():
    s = ActualizarDatosPersonalesSerializer()
    with pytest.raises(serializers.ValidationError):
        s._no_vacio("")
    assert s._no_vacio("Ana") == "Ana"


@pytest.mark.django_db
def test_grupo_valida_sin_grado_ni_nombre_y_al_cambiar_grado_sin_estudiantes():
    s = GrupoAdminSerializer()
    assert s.validate({}) == {}  # sin grado ni nombre no hay nada que comparar
    g1, g2 = (
        Grado.objects.create(nombre="Sexto", orden=6),
        Grado.objects.create(nombre="Séptimo", orden=7),
    )
    grupo = Grupo.objects.create(grado=g1, nombre="A")
    s = GrupoAdminSerializer(instance=grupo)
    assert s.validate({"grado": g2})["grado"] == g2  # sin estudiantes, cambiar de grado es válido


@pytest.mark.django_db
def test_periodo_sin_fechas_no_valida_el_orden():
    assert PeriodoSerializer().validate({}) == {}


@pytest.mark.django_db
def test_dia_no_habil_valida_fecha_repetida_y_motivo():
    fecha = datetime.date(2026, 5, 1)
    dia = DiaNoHabil.objects.create(fecha=fecha, descripcion="Trabajo")
    s = DiaNoHabilSerializer()
    with pytest.raises(serializers.ValidationError):
        s.validate_fecha(fecha)
    # Al editar el mismo día, su propia fecha no cuenta como repetida.
    assert DiaNoHabilSerializer(instance=dia).validate_fecha(fecha) == fecha
    with pytest.raises(serializers.ValidationError):
        s.validate_descripcion("   ")
    assert s.validate_descripcion("  Festivo ") == "Festivo"


def test_csv_ignora_columnas_desconocidas_del_encabezado():
    filas = leer_csv("correo,grado,grupo,otra\na@b.co,Sexto,A,dato")
    assert filas == [{"correo": "a@b.co", "grado": "Sexto", "grupo": "A"}]


# --- errores y utilidades comunes ----------------------------------------------------------


def test_codigo_de_error_para_permiso_denegado_de_django():
    assert _codigo_por_tipo(DjangoPermissionDenied()) == "permission_denied"
    assert _codigo_por_tipo(ValueError()) == "error"


@pytest.mark.django_db
def test_guardar_convierte_un_choque_de_unicidad_en_400():
    falso = mock.Mock()
    falso.save.side_effect = IntegrityError("duplicado")
    with pytest.raises(serializers.ValidationError) as e:
        guardar(falso)
    assert "Ya existe un registro" in str(e.value.detail)


# --- MFA: ramas de error -------------------------------------------------------------------


@pytest.mark.django_db
def test_mfa_no_se_puede_activar_dos_veces():
    u = crear("m@colegio.edu.co")
    mfa.iniciar_configuracion(u)
    u.refresh_from_db()
    u.mfa_activo = True
    u.save()
    with pytest.raises(Exception) as e:
        mfa.activar(u, "123456")
    assert type(e.value).__name__ == "MfaYaActivo"


@pytest.mark.django_db
def test_mfa_desafio_invalido_o_de_cuenta_sin_mfa():
    u = crear("m2@colegio.edu.co")
    with pytest.raises(Exception) as e:
        mfa.huella_del_desafio("token-falso")
    assert type(e.value).__name__ == "MfaTokenInvalido"
    token = mfa.emitir_desafio(u)  # cuenta sin MFA activo
    with pytest.raises(Exception) as e:
        mfa.verificar_desafio(token, "123456")
    assert type(e.value).__name__ == "MfaTokenInvalido"
    # y un usuario que ya no existe
    token = mfa.emitir_desafio(u)
    u.delete()
    with pytest.raises(Exception) as e:
        mfa.verificar_desafio(token, "123456")
    assert type(e.value).__name__ == "MfaTokenInvalido"


@pytest.mark.django_db
def test_mfa_desactivar_con_cuenta_bloqueada_responde_bloqueo():
    u = crear("m3@colegio.edu.co", mfa_activo=True, mfa_secreto="x")
    u.bloqueado_hasta = timezone.now() + datetime.timedelta(minutes=5)
    u.save()
    with pytest.raises(Exception) as e:
        mfa.desactivar(u, CLAVE, "123456")
    assert type(e.value).__name__ == "CuentaBloqueada"


@pytest.mark.django_db
def test_mfa_codigo_vacio_no_prueba_codigos_de_recuperacion():
    u = crear("m4@colegio.edu.co", mfa_activo=True, mfa_secreto="x")
    assert mfa._aceptar_codigo(u, "", permitir_recuperacion=True) is False
    assert mfa._aceptar_codigo(u, "ABC", permitir_recuperacion=False) is False


@pytest.mark.django_db
def test_matricula_y_periodo_se_pueden_representar_sin_error():
    # Documenta que las relaciones sin guardar bastan para el __str__ (ver prueba genérica).
    assert str(
        Matricula(
            estudiante=Usuario(email="e@c.co"),
            periodo=PeriodoAcademico(nombre="P"),
            grupo=Grupo(nombre="A", grado=Grado(nombre="Sexto", orden=6)),
        )
    )
