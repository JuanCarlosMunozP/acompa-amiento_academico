"""Catálogo de roles institucionales.

El código `tutor` se conserva en la API y la base de datos por compatibilidad; en la interfaz
y en los mensajes ese rol se presenta como «Docente».

Para agregar un rol: nuevo valor en `Rol`, su descripción en `DESCRIPCIONES` y una migración
(`makemigrations`) que actualiza la restricción de la base de datos.
"""

from django.db import models


class Rol(models.TextChoices):
    ESTUDIANTE = "estudiante", "Estudiante"
    ACUDIENTE = "acudiente", "Acudiente"
    TUTOR = "tutor", "Docente"
    COORDINADOR = "coordinador", "Coordinador"
    ADMINISTRADOR = "administrador", "Administrador"
    SUPERADMIN = "superadmin", "Superadministrador"


DESCRIPCIONES = {
    Rol.ESTUDIANTE: "Consulta su plan de nivelación, pregunta y carga actividades y correcciones.",
    Rol.ACUDIENTE: (
        "Consulta y acompaña el proceso del estudiante vinculado; no modifica el plan ni las notas."
    ),
    Rol.TUTOR: (
        "Estructura y planea: identifica desempeños, estudiantes y grados, crea el plan y las "
        "actividades, retroalimenta, valora y cierra el proceso."
    ),
    Rol.COORDINADOR: (
        "Verifica procesos y evidencias, consulta reportes, registra observaciones y visto bueno "
        "y hace el seguimiento institucional."
    ),
    Rol.ADMINISTRADOR: (
        "Gestiona usuarios, roles, permisos, periodos, grados, áreas y parámetros. Puede ser un "
        "coordinador autorizado o un administrativo designado."
    ),
    Rol.SUPERADMIN: (
        "Responsable técnico de la plataforma: tiene todo lo del administrador y es el único que "
        "puede otorgar, quitar o desactivar el rol de superadministrador."
    ),
}

# Quienes administran la institución: el superadministrador hace todo lo del administrador.
ROLES_ADMINISTRACION = (Rol.ADMINISTRADOR, Rol.SUPERADMIN)

ROL_POR_DEFECTO = Rol.ESTUDIANTE


def catalogo():
    """Lista de roles para mostrar en clientes: código, nombre y descripción."""
    return [
        {"codigo": rol.value, "nombre": rol.label, "descripcion": DESCRIPCIONES[rol]} for rol in Rol
    ]
