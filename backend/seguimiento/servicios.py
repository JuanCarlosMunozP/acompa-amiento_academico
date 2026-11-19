"""Cálculos del seguimiento académico: promedio, asistencia, trabajos y motor de reglas.

El motor es una función pura (`evaluar_datos`) que recibe los datos ya reunidos. Para una
matriz de cientos de estudiantes los datos se reúnen con pocas consultas agrupadas
(`reunir_datos`), no con una consulta por persona.
"""

from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Count

from .models import Asistencia, ReglaAcademica, Resultado, TrabajoPendiente

SEVERIDAD_ORDEN = {"atencion": 1, "riesgo": 2, "critico": 3}
SIN_ALERTAS = "sin_alertas"


def _decimal(valor, decimales="0.01"):
    return Decimal(valor).quantize(Decimal(decimales), rounding=ROUND_HALF_UP)


def _texto(numero):
    """3.00 -> «3», 2.80 -> «2.8»: sin ceros sobrantes."""
    return format(Decimal(numero).normalize(), "f")


# --------------------------------------------------------------------------- asistencia


def porcentaje_asistencia(conteo):
    """Porcentaje de asistencia a partir de un conteo por estado.

    Cuentan como asistida «presente» y «llegó tarde». Las ausencias justificadas (excusa) no
    suman ni restan: se sacan del total. Sin registros contables devuelve None (no hay dato).
    """
    asistidas = conteo.get("presente", 0) + conteo.get("tarde", 0)
    contables = asistidas + conteo.get("ausente", 0)
    if contables == 0:
        return None
    return _decimal(Decimal(asistidas) * 100 / contables, "0.1")


def resumen_de_conteo(conteo):
    return {
        "presentes": conteo.get("presente", 0),
        "tardes": conteo.get("tarde", 0),
        "ausentes": conteo.get("ausente", 0),
        "excusas": conteo.get("excusa", 0),
        "total": sum(conteo.values()),
        "porcentaje": porcentaje_asistencia(conteo),
    }


# --------------------------------------------------------------------------- datos reunidos


def reunir_datos(periodo, estudiante_ids):
    """Notas, asistencia y trabajos pendientes de varios estudiantes en un periodo.

    Devuelve `{id: {"notas": {asignatura: valor}, "conteo": {estado: n}, "trabajos": n}}`.
    """
    datos = {i: {"notas": {}, "conteo": {}, "trabajos": 0} for i in estudiante_ids}

    for fila in Resultado.objects.filter(periodo=periodo, estudiante_id__in=estudiante_ids).values(
        "estudiante_id", "asignatura__nombre", "valor"
    ):
        datos[fila["estudiante_id"]]["notas"][fila["asignatura__nombre"]] = fila["valor"]

    for fila in (
        Asistencia.objects.filter(
            estudiante_id__in=estudiante_ids,
            fecha__gte=periodo.fecha_inicio,
            fecha__lte=periodo.fecha_fin,
        )
        .values("estudiante_id", "estado")
        .annotate(n=Count("id"))
    ):
        datos[fila["estudiante_id"]]["conteo"][fila["estado"]] = fila["n"]

    for fila in (
        TrabajoPendiente.objects.filter(
            periodo=periodo, estudiante_id__in=estudiante_ids, entregado=False
        )
        .values("estudiante_id")
        .annotate(n=Count("id"))
    ):
        datos[fila["estudiante_id"]]["trabajos"] = fila["n"]
    return datos


def promedio(notas):
    """Promedio simple de las notas por asignatura, o None si no hay ninguna."""
    if not notas:
        return None
    return _decimal(sum(notas.values()) / len(notas))


# --------------------------------------------------------------------------- motor de reglas


def _mas_grave(reglas_activadas):
    return max(reglas_activadas, key=lambda r: (SEVERIDAD_ORDEN[r.severidad], r.umbral))


def evaluar_datos(reglas, datos):
    """Aplica las reglas a los datos de un estudiante. Devuelve `(alertas, estado)`.

    Si varias reglas del mismo tipo se activan para lo mismo (p. ej. una nota de 1,8 cumple
    «menor que 3» y «menor que 2»), solo se informa la más grave. Cada alerta trae su
    explicación: qué valor se midió, contra qué umbral y qué regla lo marcó.
    """
    alertas = []
    por_tipo = defaultdict(list)
    for regla in reglas:
        if regla.activa:
            por_tipo[regla.tipo].append(regla)

    for asignatura, nota in sorted(datos["notas"].items()):
        activadas = [r for r in por_tipo[ReglaAcademica.Tipo.NOTA_BAJA] if nota < r.umbral]
        if activadas:
            regla = _mas_grave(activadas)
            alertas.append(
                _alerta(
                    regla,
                    valor=nota,
                    asignatura=asignatura,
                    explicacion=(
                        f"La nota de {asignatura} ({_texto(nota)}) es menor que "
                        f"{_texto(regla.umbral)}, el límite de la regla «{regla.nombre}»."
                    ),
                )
            )

    porcentaje = porcentaje_asistencia(datos["conteo"])
    if porcentaje is not None:
        activadas = [
            r for r in por_tipo[ReglaAcademica.Tipo.ASISTENCIA_BAJA] if porcentaje < r.umbral
        ]
        if activadas:
            regla = _mas_grave(activadas)
            alertas.append(
                _alerta(
                    regla,
                    valor=porcentaje,
                    explicacion=(
                        f"Su asistencia ({_texto(porcentaje)} %) es menor que "
                        f"{_texto(regla.umbral)} %, el límite de la regla «{regla.nombre}»."
                    ),
                )
            )

    pendientes = datos["trabajos"]
    activadas = [
        r for r in por_tipo[ReglaAcademica.Tipo.TRABAJOS_PENDIENTES] if pendientes >= r.umbral
    ]
    if activadas:
        regla = _mas_grave(activadas)
        alertas.append(
            _alerta(
                regla,
                valor=Decimal(pendientes),
                explicacion=(
                    f"Tiene {pendientes} trabajo(s) sin entregar; la regla «{regla.nombre}» "
                    f"se activa desde {_texto(regla.umbral)}."
                ),
            )
        )

    alertas.sort(key=lambda a: -SEVERIDAD_ORDEN[a["severidad"]])
    estado = alertas[0]["severidad"] if alertas else SIN_ALERTAS
    return alertas, estado


def _alerta(regla, *, valor, explicacion, asignatura=None):
    return {
        "regla": regla.pk,
        "nombre": regla.nombre,
        "tipo": regla.tipo,
        "severidad": regla.severidad,
        "asignatura": asignatura,
        "valor": valor,
        "umbral": regla.umbral,
        "explicacion": explicacion,
    }


def evaluar_estudiante(estudiante, periodo):
    """Evaluación completa de un estudiante: datos medidos, alertas con su explicación y estado."""
    datos = reunir_datos(periodo, [estudiante.pk])[estudiante.pk]
    alertas, estado = evaluar_datos(list(ReglaAcademica.objects.filter(activa=True)), datos)
    return {
        "estudiante": estudiante.pk,
        "periodo": periodo.pk,
        "estado": estado,
        "medidas": {
            "promedio": promedio(datos["notas"]),
            "notas": [{"asignatura": a, "valor": v} for a, v in sorted(datos["notas"].items())],
            "asistencia": resumen_de_conteo(datos["conteo"]),
            "trabajos_pendientes": datos["trabajos"],
        },
        "alertas": alertas,
    }


# --------------------------------------------------------------------------- matriz


def filas_de_matriz(periodo, matriculas):
    """Una fila por estudiante matriculado, con sus medidas y su estado."""
    matriculas = list(matriculas)
    ids = [m.estudiante_id for m in matriculas]
    datos = reunir_datos(periodo, ids)
    reglas = list(ReglaAcademica.objects.filter(activa=True))
    filas = []
    for m in matriculas:
        d = datos[m.estudiante_id]
        alertas, estado = evaluar_datos(reglas, d)
        filas.append(
            {
                "estudiante": m.estudiante_id,
                "nombre": f"{m.estudiante.nombres} {m.estudiante.apellidos}".strip(),
                "email": m.estudiante.email,
                "grupo": str(m.grupo),
                "promedio": promedio(d["notas"]),
                "asistencia": porcentaje_asistencia(d["conteo"]),
                "trabajos_pendientes": d["trabajos"],
                "estado": estado,
                "alertas": len(alertas),
            }
        )
    return filas


def resumen_de_estados(filas):
    resumen = {SIN_ALERTAS: 0, "atencion": 0, "riesgo": 0, "critico": 0}
    for fila in filas:
        resumen[fila["estado"]] += 1
    return resumen
