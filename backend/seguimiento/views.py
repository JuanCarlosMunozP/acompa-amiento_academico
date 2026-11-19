"""Vistas de la API para registrar y consultar el seguimiento de tutorías."""

import csv
import datetime
from decimal import Decimal

from django.db import transaction
from django.db.models import Avg, Count, Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from academico.models import Matricula, PeriodoAcademico
from academico.servicios import motivo_no_habil, validar_dia_habil
from common.crud import filtro_booleano, vistas_crud
from planes.models import NotificacionAcompanamiento, PlanRefuerzo
from planes.serializers import PlanSerializer
from planes.servicios import consulta_de_planes, notificar_proceso
from usuarios.auditoria import registrar_evento
from usuarios.models import Asignatura, Grupo, Usuario
from usuarios.permisos import (
    EsAdministrador,
    EsAdministradorOCoordinador,
    EsEstudiante,
    capacidad_requerida,
    permiso_por_metodo,
)
from usuarios.roles import Rol
from usuarios.views_roles import PaginaUsuarios

from .alertas import publicar_alertas
from .models import (
    Asistencia,
    CambioNota,
    EvaluacionPosterior,
    ReglaAcademica,
    Resultado,
    TrabajoPendiente,
)
from .serializers import (
    CambioNotaSerializer,
    EditarNotaSerializer,
    EvaluacionPosteriorSerializer,
    ReglaSerializer,
    ResultadoSerializer,
    TomaDeAsistenciaSerializer,
    TrabajoSerializer,
)
from .servicios import (
    SEVERIDAD_ORDEN,
    SIN_ALERTAS,
    evaluar_estudiante,
    filas_de_matriz,
    promedio,
    resumen_de_conteo,
    resumen_de_estados,
    reunir_datos,
)

# Quién registra el seguimiento diario (asistencia, trabajos): quien dicta o coordina.
EsDocenteOCoordinacion = capacidad_requerida("registrar_seguimiento")


# --------------------------------------------------------------------------- utilidades


def _estudiante(pk):
    return get_object_or_404(Usuario, pk=pk, rol=Rol.ESTUDIANTE)


def _entero(params, nombre):
    valor = params.get(nombre)
    if valor is None:
        return None
    texto = str(valor)  # en JSON llega como número; en la URL, como texto
    if not texto.isdigit():
        raise serializers.ValidationError({nombre: ["Debe ser un número."]})
    return int(texto)


def _fecha(texto, campo="fecha"):
    try:
        return datetime.date.fromisoformat(texto)
    except (TypeError, ValueError):
        raise serializers.ValidationError({campo: ["Usa el formato AAAA-MM-DD."]}) from None


def _periodo(params, obligatorio=True):
    """El periodo pedido (`?periodo=`) o, si no se indica, el vigente."""
    pedido = _entero(params, "periodo")
    periodo = (
        PeriodoAcademico.objects.filter(pk=pedido).first() if pedido else PeriodoAcademico.actual()
    )
    if periodo is None and obligatorio:
        raise serializers.ValidationError(
            {"periodo": ["Indica un periodo existente: hoy no hay uno vigente."]}
        )
    return periodo


def _tiene_matricula_activa(estudiante, periodo):
    return Matricula.objects.filter(
        estudiante=estudiante, periodo=periodo, estado=Matricula.Estado.ACTIVA
    ).exists()


# --------------------------------------------------------------------------- notas


def _resultados():
    return Resultado.objects.select_related("estudiante", "asignatura", "periodo")


@api_view(["GET", "POST"])
@permission_classes([EsAdministradorOCoordinador])
def notas(request):
    """GET: notas con filtros (`estudiante`, `periodo`, `asignatura`). POST: registra una nota."""
    if request.method == "POST":
        datos = ResultadoSerializer(data=request.data)
        datos.is_valid(raise_exception=True)
        nuevo = datos.save(registrado_por=request.user)
        registrar_evento(
            request.user,
            "nota.creada",
            "nota",
            nuevo.pk,
            {
                "estudiante": nuevo.estudiante_id,
                "asignatura": nuevo.asignatura_id,
                "periodo": nuevo.periodo_id,
                "valor": str(nuevo.valor),
            },
        )
        publicar_alertas(nuevo.estudiante, nuevo.periodo)
        return Response(
            ResultadoSerializer(_resultados().get(pk=nuevo.pk)).data, status=status.HTTP_201_CREATED
        )

    consulta = _resultados()
    for parametro, campo in (
        ("estudiante", "estudiante_id"),
        ("periodo", "periodo_id"),
        ("asignatura", "asignatura_id"),
    ):
        valor = _entero(request.query_params, parametro)
        if valor is not None:
            consulta = consulta.filter(**{campo: valor})
    paginador = PaginaUsuarios()
    pagina = paginador.paginate_queryset(consulta, request)
    return paginador.get_paginated_response(ResultadoSerializer(pagina, many=True).data)


@api_view(["GET", "PATCH"])
@permission_classes([EsAdministradorOCoordinador])
def nota(request, pk):
    """GET: una nota. PATCH `{valor, motivo}`: la corrige y deja el cambio en el historial."""
    resultado = get_object_or_404(_resultados(), pk=pk)
    if request.method == "PATCH":
        datos = EditarNotaSerializer(data=request.data)
        datos.is_valid(raise_exception=True)
        nuevo = datos.validated_data["valor"]
        if nuevo == resultado.valor:
            raise serializers.ValidationError({"valor": ["La nota ya tiene ese valor."]})
        anterior = resultado.valor
        with transaction.atomic():
            CambioNota.objects.create(
                resultado=resultado,
                valor_anterior=anterior,
                valor_nuevo=nuevo,
                motivo=datos.validated_data["motivo"],
                cambiado_por=request.user,
            )
            resultado.valor = nuevo
            resultado.save(update_fields=["valor"])
            registrar_evento(
                request.user,
                "nota.actualizada",
                "nota",
                resultado.pk,
                {
                    "valor_anterior": str(anterior),
                    "valor_nuevo": str(nuevo),
                    "estudiante": resultado.estudiante_id,
                    "motivo": datos.validated_data["motivo"],
                },
            )
        resultado = _resultados().get(pk=pk)
        publicar_alertas(resultado.estudiante, resultado.periodo)
    return Response(ResultadoSerializer(resultado).data)


@api_view(["GET"])
@permission_classes([EsAdministradorOCoordinador])
def historial_de_nota(request, pk):
    resultado = get_object_or_404(Resultado, pk=pk)
    cambios = resultado.cambios.select_related("cambiado_por")
    return Response(CambioNotaSerializer(cambios, many=True).data)


@api_view(["GET"])
@permission_classes([EsEstudiante])
def mis_notas(request):
    """Las notas del estudiante autenticado en un periodo, con su promedio."""
    periodo = _periodo(request.query_params)
    consulta = _resultados().filter(estudiante=request.user, periodo=periodo)
    por_asignatura = {r.asignatura.nombre: r.valor for r in consulta}
    return Response(
        {
            "periodo": periodo.pk,
            "promedio": promedio(por_asignatura),
            "notas": ResultadoSerializer(consulta.order_by("asignatura__nombre"), many=True).data,
        }
    )


# --------------------------------------------------------------------------- asistencia


def _lista_del_dia(grupo, fecha):
    """Estudiantes que cursan el grupo ese día (matrícula activa en el periodo de la fecha)."""
    periodo = PeriodoAcademico.objects.filter(fecha_inicio__lte=fecha, fecha_fin__gte=fecha).first()
    if periodo is None:
        raise serializers.ValidationError({"fecha": ["No hay un periodo académico en esa fecha."]})
    matriculas = list(
        Matricula.objects.filter(grupo=grupo, periodo=periodo, estado=Matricula.Estado.ACTIVA)
        .select_related("estudiante")
        .order_by("estudiante__apellidos", "estudiante__nombres")
    )
    estados = dict(
        Asistencia.objects.filter(
            fecha=fecha, estudiante_id__in=[m.estudiante_id for m in matriculas]
        ).values_list("estudiante_id", "estado")
    )
    return periodo, [
        {
            "estudiante": m.estudiante_id,
            "nombre": f"{m.estudiante.nombres} {m.estudiante.apellidos}".strip(),
            "email": m.estudiante.email,
            "estado": estados.get(m.estudiante_id),
        }
        for m in matriculas
    ]


def _respuesta_lista(grupo, fecha, extra=None):
    periodo, estudiantes = _lista_del_dia(grupo, fecha)
    motivo = motivo_no_habil(fecha)
    return {
        "fecha": fecha.isoformat(),
        "grupo": str(grupo),
        "periodo": periodo.pk,
        "habil": motivo is None,
        "motivo": motivo,
        "estudiantes": estudiantes,
        **(extra or {}),
    }


@api_view(["GET", "PUT"])
@permission_classes([EsDocenteOCoordinacion])
def asistencia_del_dia(request, grupo_id, fecha):
    """GET: la lista del grupo para esa fecha con la asistencia ya tomada.

    PUT `{registros: [{estudiante, estado}]}`: toma o corrige la asistencia. Solo días hábiles,
    nunca fechas futuras, y solo estudiantes con matrícula activa en ese grupo.
    """
    grupo = get_object_or_404(Grupo.objects.select_related("grado"), pk=grupo_id)
    dia = _fecha(fecha)

    if request.method == "GET":
        return Response(_respuesta_lista(grupo, dia))

    if dia > timezone.localdate():
        raise serializers.ValidationError(
            {"fecha": ["No se puede tomar asistencia de una fecha futura."]}
        )
    validar_dia_habil(dia)
    datos = TomaDeAsistenciaSerializer(data=request.data)
    datos.is_valid(raise_exception=True)
    _, lista = _lista_del_dia(grupo, dia)
    validos = {e["estudiante"] for e in lista}
    ajenos = [
        r["estudiante"] for r in datos.validated_data["registros"] if r["estudiante"] not in validos
    ]
    if ajenos:
        raise serializers.ValidationError(
            {"registros": [f"No están matriculados en {grupo}: {', '.join(map(str, ajenos))}."]}
        )

    with transaction.atomic():
        for r in datos.validated_data["registros"]:
            Asistencia.objects.update_or_create(
                estudiante_id=r["estudiante"],
                fecha=dia,
                defaults={"estado": r["estado"], "registrado_por": request.user},
            )
    periodo = PeriodoAcademico.actual()
    if periodo is not None:
        for r in datos.validated_data["registros"]:
            publicar_alertas(Usuario.objects.get(pk=r["estudiante"]), periodo)
    return Response(
        _respuesta_lista(grupo, dia, {"guardados": len(datos.validated_data["registros"])})
    )


def _resumen_de_asistencia(estudiante, periodo):
    datos = reunir_datos(periodo, [estudiante.pk])[estudiante.pk]
    registros = Asistencia.objects.filter(
        estudiante=estudiante, fecha__gte=periodo.fecha_inicio, fecha__lte=periodo.fecha_fin
    ).order_by("-fecha")[:200]
    return {
        "periodo": periodo.pk,
        **resumen_de_conteo(datos["conteo"]),
        "registros": [{"fecha": r.fecha, "estado": r.estado} for r in registros],
    }


@api_view(["GET"])
@permission_classes([EsAdministradorOCoordinador])
def asistencia_de_estudiante(request, pk):
    """Resumen de asistencia y porcentaje de un estudiante en un periodo."""
    return Response(_resumen_de_asistencia(_estudiante(pk), _periodo(request.query_params)))


@api_view(["GET"])
@permission_classes([EsEstudiante])
def mi_asistencia(request):
    return Response(_resumen_de_asistencia(request.user, _periodo(request.query_params)))


# --------------------------------------------------------------------------- trabajos


def _trabajos():
    return TrabajoPendiente.objects.select_related("asignatura")


@api_view(["GET", "POST"])
@permission_classes([EsDocenteOCoordinacion])
def trabajos_de_estudiante(request, pk):
    """GET: trabajos del estudiante (`?entregado=`, `?periodo=`). POST: registra uno pendiente."""
    estudiante = _estudiante(pk)
    if request.method == "POST":
        datos = TrabajoSerializer(data=request.data)
        datos.is_valid(raise_exception=True)
        periodo = datos.validated_data.get("periodo") or _periodo({})
        if not _tiene_matricula_activa(estudiante, periodo):
            raise serializers.ValidationError(
                {"periodo": ["El estudiante no tiene una matrícula activa en ese periodo."]}
            )
        nuevo = datos.save(estudiante=estudiante, periodo=periodo, registrado_por=request.user)
        publicar_alertas(estudiante, periodo)
        return Response(
            TrabajoSerializer(_trabajos().get(pk=nuevo.pk)).data, status=status.HTTP_201_CREATED
        )

    consulta = _trabajos().filter(estudiante=estudiante)
    consulta = filtro_booleano("entregado", "entregado")(consulta, request.query_params)
    periodo = _entero(request.query_params, "periodo")
    if periodo:
        consulta = consulta.filter(periodo_id=periodo)
    return Response(TrabajoSerializer(consulta, many=True).data)


@api_view(["GET", "PATCH"])
@permission_classes([EsDocenteOCoordinacion])
def trabajo(request, pk):
    """GET: un trabajo. PATCH: lo marca como entregado (o lo reabre) o corrige sus datos."""
    elemento = get_object_or_404(_trabajos(), pk=pk)
    if request.method == "PATCH":
        datos = TrabajoSerializer(elemento, data=request.data, partial=True)
        datos.is_valid(raise_exception=True)
        extra = {}
        if "entregado" in datos.validated_data:
            entregado = datos.validated_data["entregado"]
            extra["fecha_entrega"] = timezone.localdate() if entregado else None
        datos.save(**extra)
        elemento = _trabajos().get(pk=pk)
        publicar_alertas(elemento.estudiante, elemento.periodo)
    return Response(TrabajoSerializer(elemento).data)


@api_view(["GET"])
@permission_classes([EsEstudiante])
def mis_trabajos(request):
    consulta = filtro_booleano("entregado", "entregado")(
        _trabajos().filter(estudiante=request.user), request.query_params
    )
    return Response(TrabajoSerializer(consulta, many=True).data)


# --------------------------------------------------------------------------- reglas


def _filtro_tipo(consulta, params):
    tipo = params.get("tipo")
    if tipo is None:
        return consulta
    if tipo not in ReglaAcademica.Tipo.values:
        raise serializers.ValidationError({"tipo": ["Tipo de regla no válido."]})
    return consulta.filter(tipo=tipo)


reglas, regla = vistas_crud(
    modelo=ReglaAcademica,
    serializer=ReglaSerializer,
    permiso=permiso_por_metodo(EsAdministradorOCoordinador, EsAdministrador),
    ordenar=("tipo", "-umbral"),
    filtros=[filtro_booleano("activa", "activa"), _filtro_tipo],
)


@api_view(["GET"])
@permission_classes([EsAdministradorOCoordinador])
def evaluacion_de_estudiante(request, pk):
    """Evaluación de las reglas para un estudiante: medidas, alertas con su explicación y estado."""
    return Response(evaluar_estudiante(_estudiante(pk), _periodo(request.query_params)))


@api_view(["GET"])
@permission_classes([EsEstudiante])
def mi_evaluacion(request):
    return Response(evaluar_estudiante(request.user, _periodo(request.query_params)))


# --------------------------------------------------------------------------- matriz


@api_view(["GET"])
@permission_classes([EsAdministradorOCoordinador])
def matriz_de_desempeno(request):
    """Matriz de desempeño: una fila por estudiante matriculado, con su estado.

    Filtros: `periodo` (por defecto el vigente), `grupo`, `grado`, `estado` y `q`. Las filas
    vienen de las más graves a las menos graves y la respuesta trae el conteo por estado.
    """
    params = request.query_params
    periodo = _periodo(params)
    matriculas = Matricula.objects.filter(periodo=periodo, estado=Matricula.Estado.ACTIVA)
    grupo, grado = _entero(params, "grupo"), _entero(params, "grado")
    if grupo:
        matriculas = matriculas.filter(grupo_id=grupo)
    if grado:
        matriculas = matriculas.filter(grupo__grado_id=grado)
    q = params.get("q", "").strip()
    if q:
        matriculas = matriculas.filter(
            Q(estudiante__email__icontains=q)
            | Q(estudiante__nombres__icontains=q)
            | Q(estudiante__apellidos__icontains=q)
        )
    estado = params.get("estado")
    if estado and estado not in (*SEVERIDAD_ORDEN, SIN_ALERTAS):
        raise serializers.ValidationError({"estado": ["Estado no válido."]})

    matriculas = matriculas.select_related("estudiante", "grupo__grado").order_by(
        "estudiante__apellidos", "estudiante__nombres", "pk"
    )
    filas = filas_de_matriz(periodo, matriculas)
    resumen = resumen_de_estados(filas)  # antes de filtrar por estado: el tablero muestra todo
    if estado:
        filas = [f for f in filas if f["estado"] == estado]
    filas.sort(
        key=lambda f: -SEVERIDAD_ORDEN.get(f["estado"], 0)
    )  # estable: conserva el orden alfabético

    paginador = PaginaUsuarios()
    pagina = paginador.paginate_queryset(filas, request)
    respuesta = paginador.get_paginated_response(pagina)
    respuesta.data["periodo"] = periodo.pk
    respuesta.data["resumen"] = resumen
    return respuesta


# --------------------------------------------------------------------------- ficha completa


def _puede_ver_ficha(usuario, estudiante):
    """Coordinación ve a todos; un tutor, solo a quien tiene en un plan de refuerzo asignado."""
    if usuario.rol in (Rol.COORDINADOR, Rol.ADMINISTRADOR, Rol.SUPERADMIN):
        return True
    return PlanRefuerzo.objects.filter(
        tutor=usuario, estudiante=estudiante, estado=PlanRefuerzo.Estado.ASIGNADO
    ).exists()


@api_view(["GET"])
@permission_classes([EsDocenteOCoordinacion])
def ficha_completa(request, pk):
    """Ficha completa del estudiante en un periodo: datos, evaluación, asistencia y trabajos.

    Reúne lo que coordinación (o el tutor responsable de un plan asignado) necesita para
    decidir o dar seguimiento sin abrir cinco pantallas. Los tutores sin plan asignado con el
    estudiante reciben 403.
    """
    estudiante = _estudiante(pk)
    if not _puede_ver_ficha(request.user, estudiante):
        return Response(
            {
                "error": {
                    "code": "permission_denied",
                    "message": "Solo ves a los estudiantes de tus planes de refuerzo asignados.",
                }
            },
            status=status.HTTP_403_FORBIDDEN,
        )
    registrar_evento(
        request.user,
        "ficha_completa.consultada",
        "ficha_estudiante",
        estudiante.pk,
        {"periodo": request.query_params.get("periodo", "")},
    )
    periodo = _periodo(request.query_params)
    matricula = (
        Matricula.objects.filter(estudiante=estudiante, periodo=periodo)
        .select_related("grupo__grado")
        .first()
    )
    asistencia = _resumen_de_asistencia(estudiante, periodo)
    asistencia["registros"] = asistencia["registros"][:30]
    trabajos = (
        _trabajos()
        .filter(estudiante=estudiante, periodo=periodo, entregado=False)
        .order_by("fecha_limite")
    )
    planes = consulta_de_planes().filter(estudiante=estudiante)
    if request.user.rol == Rol.TUTOR:
        planes = planes.filter(tutor=request.user)
    return Response(
        {
            "estudiante": {
                "id": estudiante.pk,
                "nombre": estudiante.nombre_completo,
                "email": estudiante.email,
                "grado": matricula.grupo.grado.nombre if matricula else None,
                "grupo": matricula.grupo.nombre if matricula else None,
                "matricula": matricula.estado if matricula else None,
            },
            "periodo": {"id": periodo.pk, "nombre": periodo.nombre},
            "evaluacion": evaluar_estudiante(estudiante, periodo),
            "asistencia": asistencia,
            "trabajos_pendientes": TrabajoSerializer(trabajos, many=True).data,
            "planes": PlanSerializer(planes, many=True).data,
        }
    )


@api_view(["GET", "POST"])
@permission_classes([EsDocenteOCoordinacion])
def evaluaciones_posteriores(request):
    """Consulta y registra la nota posterior de planes cerrados con el tutor asignado."""
    if request.method == "POST":
        plan_id = _entero(request.data, "plan")
        plan = get_object_or_404(
            PlanRefuerzo.objects.select_related("estudiante", "asignatura", "periodo", "tutor"),
            pk=plan_id,
        )
        if request.user.rol == Rol.TUTOR and plan.tutor_id != request.user.pk:
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied("Solo registras la nota posterior de tus planes.")
        if plan.estado != PlanRefuerzo.Estado.CERRADO:
            raise serializers.ValidationError(
                {"plan": ["Cierra el plan antes de registrar la evaluación posterior."]}
            )
        if EvaluacionPosterior.objects.filter(plan=plan).exists():
            raise serializers.ValidationError(
                {"plan": ["Este plan ya tiene evaluación posterior."]}
            )
        resultado = Resultado.objects.filter(
            estudiante=plan.estudiante, asignatura=plan.asignatura, periodo=plan.periodo
        ).first()
        if resultado is None:
            raise serializers.ValidationError(
                {"plan": ["No existe una nota inicial con la que comparar la recuperación."]}
            )
        nota = serializers.DecimalField(
            max_digits=3, decimal_places=2, min_value=Decimal("1.00"), max_value=Decimal("5.00")
        )
        nota_posterior = nota.run_validation(request.data.get("nota_posterior"))
        observaciones = str(request.data.get("observaciones", "")).strip()
        if len(observaciones) > 500:
            raise serializers.ValidationError(
                {"observaciones": ["Usa como máximo 500 caracteres."]}
            )
        evaluacion = EvaluacionPosterior.objects.create(
            plan=plan,
            nota_inicial=resultado.valor,
            nota_posterior=nota_posterior,
            observaciones=observaciones,
            registrada_por=request.user,
        )
        plan.resultado = (
            PlanRefuerzo.Resultado.LOGRADO
            if evaluacion.recuperacion_efectiva
            else PlanRefuerzo.Resultado.PARCIAL
            if evaluacion.mejora > 0
            else PlanRefuerzo.Resultado.NO_LOGRADO
        )
        plan.save(update_fields=["resultado"])
        notificar_proceso(
            [plan.estudiante, plan.tutor],
            tipo=NotificacionAcompanamiento.Tipo.CIERRE,
            titulo="Evaluación posterior registrada",
            mensaje=f"Nota {evaluacion.nota_posterior}; mejora {evaluacion.mejora} puntos.",
            plan=plan,
        )
        return Response(
            EvaluacionPosteriorSerializer(evaluacion).data, status=status.HTTP_201_CREATED
        )

    periodo = _periodo(request.query_params, obligatorio=False)
    consulta = EvaluacionPosterior.objects.select_related(
        "plan__estudiante", "plan__asignatura", "plan__periodo"
    )
    plan_id = _entero(request.query_params, "plan")
    if plan_id:
        if (
            request.user.rol == Rol.TUTOR
            and not PlanRefuerzo.objects.filter(pk=plan_id, tutor=request.user).exists()
        ):
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied("Solo consultas la evaluación posterior de tus planes.")
        consulta = consulta.filter(plan_id=plan_id)
    if periodo:
        consulta = consulta.filter(plan__periodo=periodo)
    if request.user.rol == Rol.TUTOR:
        consulta = consulta.filter(plan__tutor=request.user)
    grupo = _entero(request.query_params, "grupo")
    asignatura = _entero(request.query_params, "asignatura")
    if grupo:
        consulta = consulta.filter(
            plan__estudiante__matriculas__grupo_id=grupo,
            plan__estudiante__matriculas__periodo=periodo,
        )
    if asignatura:
        consulta = consulta.filter(plan__asignatura_id=asignatura)
    return Response(EvaluacionPosteriorSerializer(consulta.distinct()[:500], many=True).data)


def _porcentaje_plural(indicadores):
    """Porcentaje de asistencia desde contadores con nombre plural (presentes, tardes...)."""
    return resumen_de_conteo(
        {
            "presente": indicadores["presentes"],
            "tarde": indicadores["tardes"],
            "ausente": indicadores["ausentes"],
            "excusa": indicadores["excusas"],
        }
    )["porcentaje"]


def _segura_csv(valor):
    texto = "" if valor is None else str(valor)
    return f"'{texto}" if texto.startswith(("=", "+", "-", "@", "\t")) else texto


@api_view(["GET"])
@permission_classes([EsAdministradorOCoordinador])
def informes_acompanamiento(request):
    """Resumen del tablero y reportes comparativos de asistencia, asignaturas y tutores."""
    periodo = _periodo(request.query_params)
    params = request.query_params
    grupo_id, asignatura_id, tutor_id = (
        _entero(params, "grupo"),
        _entero(params, "asignatura"),
        _entero(params, "tutor"),
    )
    registrar_evento(
        request.user,
        "informe.acompanamiento_consultado",
        "informe",
        "acompanamiento",
        {
            "periodo": periodo.pk,
            "grupo": grupo_id,
            "asignatura": asignatura_id,
            "tutor": tutor_id,
            "exportar": params.get("exportar", ""),
        },
    )
    matriculas = Matricula.objects.filter(periodo=periodo, estado=Matricula.Estado.ACTIVA)
    planes = PlanRefuerzo.objects.filter(periodo=periodo).exclude(
        estado=PlanRefuerzo.Estado.CANCELADO
    )
    if tutor_id:
        planes = planes.filter(tutor_id=tutor_id)
        estudiantes_tutor = planes.values_list("estudiante_id", flat=True).distinct()
        matriculas = matriculas.filter(estudiante_id__in=estudiantes_tutor)
    if grupo_id:
        matriculas = matriculas.filter(grupo_id=grupo_id)
        planes = planes.filter(
            estudiante__matriculas__grupo_id=grupo_id, estudiante__matriculas__periodo=periodo
        )
    if asignatura_id:
        planes = planes.filter(asignatura_id=asignatura_id)

    planes = planes.distinct()
    matriculas = list(matriculas.select_related("estudiante", "grupo__grado").distinct())
    student_ids = [m.estudiante_id for m in matriculas]
    filas = filas_de_matriz(periodo, matriculas) if matriculas else []
    grupos = {}
    for matricula in matriculas:
        key = matricula.grupo_id
        grupos.setdefault(
            key,
            {
                "grupo_id": key,
                "grado_id": matricula.grupo.grado_id,
                "grupo": str(matricula.grupo),
                "grado": matricula.grupo.grado.nombre,
                "estudiantes": 0,
                "criticos": 0,
                "en_riesgo": 0,
                "planes_en_curso": 0,
                "recuperaciones_efectivas": 0,
                "presentes": 0,
                "tardes": 0,
                "ausentes": 0,
                "excusas": 0,
            },
        )
        grupos[key]["estudiantes"] += 1
    fila_por_estudiante = {f["estudiante"]: f for f in filas}
    for m in matriculas:
        fila = fila_por_estudiante.get(m.estudiante_id, {})
        grupos[m.grupo_id]["criticos"] += int(fila.get("estado") == "critico")
        grupos[m.grupo_id]["en_riesgo"] += int(fila.get("estado") == "riesgo")

    recuperaciones = list(
        EvaluacionPosterior.objects.filter(
            plan__in=planes, plan__estudiante_id__in=student_ids
        ).select_related("plan__asignatura", "plan__tutor")
    )
    por_grupo_estudiante = {m.estudiante_id: m.grupo_id for m in matriculas}
    for e in recuperaciones:
        group_key = por_grupo_estudiante.get(e.plan.estudiante_id)
        if group_key in grupos and e.recuperacion_efectiva:
            grupos[group_key]["recuperaciones_efectivas"] += 1
    for plan in planes.filter(estado=PlanRefuerzo.Estado.ASIGNADO).only("estudiante_id"):
        grupo_del_plan = por_grupo_estudiante.get(plan.estudiante_id)
        if grupo_del_plan is not None:
            grupos[grupo_del_plan]["planes_en_curso"] += 1

    conteo_asistencia = {
        sid: {"presente": 0, "tarde": 0, "ausente": 0, "excusa": 0} for sid in student_ids
    }
    for registro in Asistencia.objects.filter(
        estudiante_id__in=student_ids, fecha__gte=periodo.fecha_inicio, fecha__lte=periodo.fecha_fin
    ).values("estudiante_id", "estado"):
        conteo_asistencia[registro["estudiante_id"]][registro["estado"]] += 1
    asistencia_por_grupo = {}
    filas_asistencia = []
    for m in matriculas:
        conteo = conteo_asistencia[m.estudiante_id]
        bucket = asistencia_por_grupo.setdefault(
            m.grupo_id,
            {"grupo": str(m.grupo), **{k: 0 for k in ("presente", "tarde", "ausente", "excusa")}},
        )
        for estado, cantidad in conteo.items():
            bucket[estado] += cantidad
            grupos[m.grupo_id][estado + ("s" if estado == "presente" else "s")] += cantidad
        filas_asistencia.append(
            {
                "estudiante": m.estudiante.nombre_completo,
                "grupo": str(m.grupo),
                **conteo,
                "porcentaje": resumen_de_conteo(conteo)["porcentaje"],
            }
        )
    for bucket in asistencia_por_grupo.values():
        bucket.update(
            resumen_de_conteo({k: bucket[k] for k in ("presente", "tarde", "ausente", "excusa")})
        )
    for bucket in grupos.values():
        # Conteo para no mezclar excusas con ausencias computables.
        bucket["asistencia_porcentaje"] = _porcentaje_plural(bucket)

    grados = {}
    indicadores_grado = (
        "estudiantes",
        "criticos",
        "en_riesgo",
        "planes_en_curso",
        "recuperaciones_efectivas",
        "presentes",
        "tardes",
        "ausentes",
        "excusas",
    )
    for grupo in grupos.values():
        grado = grados.setdefault(
            grupo["grado_id"],
            {
                "grado_id": grupo["grado_id"],
                "grado": grupo["grado"],
                "grupos": 0,
                **{campo: 0 for campo in indicadores_grado},
            },
        )
        grado["grupos"] += 1
        for campo in indicadores_grado:
            grado[campo] += grupo[campo]
    for grado in grados.values():
        grado["asistencia_porcentaje"] = _porcentaje_plural(grado)

    notas = Resultado.objects.filter(periodo=periodo, estudiante_id__in=student_ids)
    if asignatura_id:
        notas = notas.filter(asignatura_id=asignatura_id)
    materias = list(
        notas.values("asignatura_id", "asignatura__nombre").annotate(
            estudiantes=Count("estudiante", distinct=True),
            promedio=Avg("valor"),
            bajo_umbral=Count("id", filter=Q(valor__lt=3)),
        )
    )
    for materia in materias:
        materia["promedio"] = (
            round(float(materia["promedio"]), 2) if materia["promedio"] is not None else None
        )
        materia["recuperaciones_efectivas"] = sum(
            1
            for e in recuperaciones
            if e.plan.asignatura_id == materia["asignatura_id"] and e.recuperacion_efectiva
        )
        materia["asignatura"] = materia.pop("asignatura__nombre")

    planes_tutores = list(planes.select_related("tutor", "estudiante", "asignatura"))
    tutor_buckets = {}
    for plan in planes_tutores:
        if not plan.tutor_id:
            continue
        bucket = tutor_buckets.setdefault(
            plan.tutor_id,
            {
                "tutor": plan.tutor.nombre_completo,
                "estudiantes": set(),
                "planes": 0,
                "sesiones": 0,
                "recuperaciones_efectivas": 0,
            },
        )
        bucket["estudiantes"].add(plan.estudiante_id)
        bucket["planes"] += 1
        bucket["sesiones"] += plan.sesiones.count()
        bucket["recuperaciones_efectivas"] += sum(
            1 for e in recuperaciones if e.plan_id == plan.pk and e.recuperacion_efectiva
        )
    tutores = [{**b, "estudiantes": len(b["estudiantes"])} for b in tutor_buckets.values()]
    cards = {
        "estudiantes": len(student_ids),
        "criticos": sum(g["criticos"] for g in grupos.values()),
        "en_riesgo": sum(g["en_riesgo"] for g in grupos.values()),
        "planes_en_curso": sum(g["planes_en_curso"] for g in grupos.values()),
        "recuperaciones_efectivas": sum(g["recuperaciones_efectivas"] for g in grupos.values()),
    }
    tutores_disponibles = list(
        planes.exclude(tutor__isnull=True)
        .values("tutor_id", "tutor__nombres", "tutor__apellidos")
        .distinct()
    )
    payload = {
        "periodo": {"id": periodo.pk, "nombre": periodo.nombre},
        "cards": cards,
        "grupos": list(grupos.values()),
        "grados": list(grados.values()),
        "asistencia_por_grupo": list(asistencia_por_grupo.values()),
        "asistencia_estudiantes": filas_asistencia,
        "asignaturas": materias,
        "tutores": tutores,
        "filtros": {
            "grupos": [
                {"id": g.pk, "nombre": f"{g.grado.nombre} {g.nombre}"}
                for g in Grupo.objects.filter(
                    matriculas__periodo=periodo, matriculas__estado=Matricula.Estado.ACTIVA
                )
                .select_related("grado")
                .distinct()
                .order_by("grado__orden", "nombre")
            ],
            "asignaturas": list(
                Asignatura.objects.filter(activa=True).values("id", "nombre").order_by("nombre")
            ),
            "tutores": [
                {
                    "id": t["tutor_id"],
                    "nombre": f"{t['tutor__nombres']} {t['tutor__apellidos']}".strip(),
                }
                for t in tutores_disponibles
            ],
        },
        "recuperaciones": EvaluacionPosteriorSerializer(recuperaciones, many=True).data,
    }

    exportar = params.get("exportar")
    columnas = {
        "grupos": (
            payload["grupos"],
            [
                "grado",
                "grupo",
                "estudiantes",
                "criticos",
                "en_riesgo",
                "planes_en_curso",
                "recuperaciones_efectivas",
                "asistencia_porcentaje",
            ],
        ),
        "asistencia": (
            payload["asistencia_estudiantes"],
            ["estudiante", "grupo", "presente", "tarde", "ausente", "excusa", "porcentaje"],
        ),
        "asignaturas": (
            payload["asignaturas"],
            ["asignatura", "estudiantes", "promedio", "bajo_umbral", "recuperaciones_efectivas"],
        ),
        "tutores": (
            payload["tutores"],
            ["tutor", "estudiantes", "planes", "sesiones", "recuperaciones_efectivas"],
        ),
        "recuperaciones": (
            payload["recuperaciones"],
            [
                "estudiante_nombre",
                "grupo_nombre",
                "asignatura_nombre",
                "nota_inicial",
                "nota_posterior",
                "mejora",
                "recuperacion_efectiva",
            ],
        ),
    }
    if exportar:
        if exportar not in columnas:
            raise serializers.ValidationError(
                {"exportar": ["Usa grupos, asistencia, asignaturas, tutores o recuperaciones."]}
            )
        filas_csv, campos = columnas[exportar]
        respuesta = HttpResponse(content_type="text/csv; charset=utf-8")
        respuesta["Content-Disposition"] = (
            f'attachment; filename="informe-{exportar}-{periodo.pk}.csv"'
        )
        respuesta["Access-Control-Expose-Headers"] = "Content-Disposition"
        respuesta.write("\ufeff")
        escritor = csv.writer(respuesta)
        escritor.writerow(campos)
        for fila in filas_csv:
            escritor.writerow([_segura_csv(fila.get(campo)) for campo in campos])
        return respuesta
    return Response(payload)
