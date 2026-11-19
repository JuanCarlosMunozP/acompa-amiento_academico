"""Reglas de negocio del calendario y de la carga masiva de matrículas."""

import csv
import io

from django.conf import settings
from django.core.exceptions import ValidationError as ErrorDeDjango
from django.core.validators import validate_email
from django.db import transaction
from rest_framework import serializers

from usuarios.models import Grupo, Usuario
from usuarios.roles import Rol

from .models import DiaNoHabil, Matricula

# --------------------------------------------------------------------------- calendario


def motivo_no_habil(fecha):
    """Por qué la fecha no es hábil (fin de semana o día registrado), o None si lo es."""
    if fecha.weekday() >= 5:
        return "fin de semana"
    dia = DiaNoHabil.objects.filter(fecha=fecha).first()
    return dia.descripcion if dia else None


def es_dia_habil(fecha):
    return motivo_no_habil(fecha) is None


def validar_dia_habil(fecha, campo="fecha"):
    """Para usar al programar actividades (tutorías, asistencia...): rechaza fechas no hábiles.

    Lanza un error 400 con el motivo, p. ej. «El 2026-12-25 no es un día hábil (Navidad).»
    """
    motivo = motivo_no_habil(fecha)
    if motivo:
        raise serializers.ValidationError(
            {campo: [f"El {fecha:%Y-%m-%d} no es un día hábil ({motivo})."]}
        )
    return fecha


# --------------------------------------------------------------------------- carga masiva

MAX_FILAS = 1000
ALIAS = {
    "correo": "correo",
    "email": "correo",
    "e-mail": "correo",
    "nombres": "nombres",
    "nombre": "nombres",
    "apellidos": "apellidos",
    "apellido": "apellidos",
    "grado": "grado",
    "grupo": "grupo",
}


class CargaInvalida(Exception):
    """El archivo no se puede leer (formato, columnas o tamaño)."""


def leer_csv(texto):
    """Lee un CSV (separado por coma o punto y coma, como lo guarda Excel en español)."""
    texto = (texto or "").lstrip("﻿").strip()
    if not texto:
        raise CargaInvalida("El archivo está vacío.")
    primera = texto.splitlines()[0]
    separador = ";" if primera.count(";") > primera.count(",") else ","
    lector = csv.reader(io.StringIO(texto), delimiter=separador)
    filas = [f for f in lector if any(c.strip() for c in f)]
    encabezado = [ALIAS.get(c.strip().lower()) for c in filas[0]]
    faltan = {"correo", "grado", "grupo"} - set(encabezado)
    if faltan:
        raise CargaInvalida(
            "Faltan columnas: " + ", ".join(sorted(faltan)) + ". Esperadas: correo, nombres, "
            "apellidos, grado, grupo."
        )
    resultado = []
    for valores in filas[1:]:
        fila = {}
        for columna, valor in zip(encabezado, valores, strict=False):
            if columna:
                fila[columna] = valor.strip()
        resultado.append(fila)
    return resultado


def _dominio_permitido(correo):
    dominios = [d.lower() for d in settings.EMAIL_DOMINIOS_PERMITIDOS]
    return not dominios or correo.rsplit("@", 1)[-1].lower() in dominios


def _revisar(periodo, filas):
    """Valida todas las filas sin tocar la base. Devuelve (filas_válidas, errores)."""
    if len(filas) > MAX_FILAS:
        raise CargaInvalida(f"Máximo {MAX_FILAS} estudiantes por carga ({len(filas)} recibidos).")

    grupos = {}  # caché (grado, grupo) -> Grupo | None
    vistos = {}  # correo en minúsculas -> n.º de la primera fila
    validas, errores = [], []

    for numero, fila in enumerate(filas, start=2):  # la fila 1 es el encabezado
        problemas = []
        correo = (fila.get("correo") or "").strip()
        nombres = (fila.get("nombres") or "").strip()
        apellidos = (fila.get("apellidos") or "").strip()
        nombre_grado = (fila.get("grado") or "").strip()
        nombre_grupo = (fila.get("grupo") or "").strip()

        try:
            validate_email(correo)
        except ErrorDeDjango:
            problemas.append("El correo no es válido.")
        else:
            if not _dominio_permitido(correo):
                problemas.append("El correo no es del dominio institucional.")
            clave = correo.lower()
            if clave in vistos:
                problemas.append(f"Repetido: ya aparece en la fila {vistos[clave]}.")
            else:
                vistos[clave] = numero

        clave_grupo = (nombre_grado.lower(), nombre_grupo.lower())
        if clave_grupo not in grupos:
            grupos[clave_grupo] = (
                Grupo.objects.select_related("grado")
                .filter(
                    grado__nombre__iexact=nombre_grado,
                    nombre__iexact=nombre_grupo,
                    activo=True,
                    grado__activo=True,
                )
                .first()
            )
        grupo = grupos[clave_grupo]
        if grupo is None:
            problemas.append(
                f"El grupo «{nombre_grado} {nombre_grupo}» no existe o no está activo."
            )

        existente = Usuario.objects.filter(email__iexact=correo).first() if correo else None
        if existente is not None:
            if existente.rol != Rol.ESTUDIANTE:
                problemas.append(f"El correo pertenece a un usuario con rol {existente.rol}.")
            elif not existente.is_active:
                problemas.append("La cuenta del estudiante está desactivada.")
            elif Matricula.objects.filter(estudiante=existente, periodo=periodo).exists():
                problemas.append("Ya está matriculado en este periodo.")
        elif not nombres or not apellidos:
            problemas.append("Es un estudiante nuevo: faltan nombres o apellidos.")

        if problemas:
            errores.append({"fila": numero, "correo": correo, "errores": problemas})
        else:
            validas.append(
                {
                    "correo": correo,
                    "nombres": nombres,
                    "apellidos": apellidos,
                    "grupo": grupo,
                    "existente": existente,
                }
            )
    return validas, errores


def cargar_matriculas(periodo, filas, simular=False):
    """Matricula a una lista de estudiantes, creando las cuentas que no existan.

    Se valida todo antes de guardar: si hay algún error no se guarda nada (todo o nada).
    Con `simular=True` solo informa. Las cuentas nuevas quedan sin contraseña y con el correo
    sin verificar: la persona la crea con «¿Olvidaste tu contraseña?».
    """
    validas, errores = _revisar(periodo, filas)
    informe = {
        "simulacion": simular,
        "total": len(filas),
        "validas": len(validas),
        "errores": errores,
        "cuentas_nuevas": sum(1 for v in validas if v["existente"] is None),
        "matriculados": 0,
    }
    if errores or simular:
        return informe

    with transaction.atomic():
        for dato in validas:
            estudiante = dato["existente"] or Usuario.objects.create_user(
                dato["correo"], None, nombres=dato["nombres"], apellidos=dato["apellidos"]
            )
            Matricula.objects.create(estudiante=estudiante, periodo=periodo, grupo=dato["grupo"])
    informe["matriculados"] = len(validas)
    return informe
