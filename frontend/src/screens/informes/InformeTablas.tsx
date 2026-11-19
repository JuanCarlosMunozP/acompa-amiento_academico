/** Renderiza tablas reutilizables para presentar datos de informes. */
import { Text, View } from 'react-native';

import type { InformeAcompanamiento } from '@/api/seguimiento';
import { Aviso } from '@/components/Aviso';
import { styles } from '@/screens/informes/InformesStyles';

const pct = (value: string | null) => (value == null ? 'Sin dato' : `${value}%`);

export function Indicador({
  etiqueta,
  valor,
  alerta = false,
}: {
  etiqueta: string;
  valor: number;
  alerta?: boolean;
}) {
  return (
    <View style={[styles.indicador, alerta && valor > 0 && styles.indicadorAlerta]}>
      <Text style={styles.indicadorValor}>{valor}</Text>
      <Text style={styles.indicadorLabel}>{etiqueta}</Text>
    </View>
  );
}

function Fila({ titulo, lineas }: { titulo: string; lineas: string[] }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowTitle}>{titulo}</Text>
      {lineas.map((linea, i) => (
        <Text key={i} style={styles.rowText}>
          {linea}
        </Text>
      ))}
    </View>
  );
}

export function TablaGrupos({ datos }: { datos: InformeAcompanamiento }) {
  return (
    <>
      {datos.grados.map((g) => (
        <Fila
          key={`grado-${g.grado_id}`}
          titulo={`Grado ${g.grado}`}
          lineas={[
            `${g.grupos} grupos · ${g.estudiantes} estudiantes · ${g.criticos} críticos · ${g.en_riesgo} en riesgo`,
            `${g.planes_en_curso} planes en curso · ${g.recuperaciones_efectivas} recuperaciones efectivas`,
            `Asistencia registrada: ${pct(g.asistencia_porcentaje)}`,
          ]}
        />
      ))}
      {datos.grupos.length ? (
        datos.grupos.map((g) => (
          <Fila
            key={g.grupo_id}
            titulo={`${g.grado} · ${g.grupo}`}
            lineas={[
              `${g.estudiantes} estudiantes · ${g.criticos} críticos · ${g.en_riesgo} en riesgo`,
              `${g.planes_en_curso} planes en curso · ${g.recuperaciones_efectivas} recuperaciones efectivas`,
              `Asistencia promedio registrada: ${pct(g.asistencia_porcentaje)}`,
            ]}
          />
        ))
      ) : (
        <Aviso tipo="nota">No hay matrículas para esos filtros.</Aviso>
      )}
    </>
  );
}

export function TablaAsistencia({ datos }: { datos: InformeAcompanamiento }) {
  return (
    <>
      {datos.asistencia_por_grupo.map((g, i) => (
        <Fila
          key={i}
          titulo={`Grupo ${g.grupo}`}
          lineas={[
            `${g.presentes} presentes · ${g.tardes} tardes · ${g.ausentes} ausentes · ${g.excusas} excusas`,
            `Asistencia comparada: ${pct(g.porcentaje)} de ${g.total} registros`,
          ]}
        />
      ))}
      {datos.asistencia_estudiantes.map((e, i) => (
        <Fila
          key={`${e.grupo}-${i}`}
          titulo={`${e.estudiante} · ${e.grupo}`}
          lineas={[
            `${e.presente} presentes · ${e.tarde} tardes · ${e.ausente} ausentes · ${e.excusa} excusas · ${pct(e.porcentaje)}`,
          ]}
        />
      ))}
    </>
  );
}

export function TablaAsignaturas({ datos }: { datos: InformeAcompanamiento }) {
  return (
    <>
      {datos.asignaturas.length ? (
        datos.asignaturas.map((a) => (
          <Fila
            key={a.asignatura_id}
            titulo={a.asignatura}
            lineas={[
              `Promedio: ${a.promedio ?? 'Sin notas'} · ${a.estudiantes} estudiantes`,
              `${a.bajo_umbral} notas bajo 3 · ${a.recuperaciones_efectivas} recuperaciones efectivas`,
            ]}
          />
        ))
      ) : (
        <Aviso tipo="nota">No hay notas para los filtros.</Aviso>
      )}
    </>
  );
}

export function TablaTutores({ datos }: { datos: InformeAcompanamiento }) {
  return (
    <>
      {datos.tutores.length ? (
        datos.tutores.map((t, i) => (
          <Fila
            key={i}
            titulo={t.tutor}
            lineas={[
              `${t.estudiantes} estudiantes · ${t.planes} planes · ${t.sesiones} sesiones`,
              `${t.recuperaciones_efectivas} recuperaciones efectivas`,
            ]}
          />
        ))
      ) : (
        <Aviso tipo="nota">No hay planes asignados.</Aviso>
      )}
    </>
  );
}

export function TablaRecuperaciones({ datos }: { datos: InformeAcompanamiento }) {
  return (
    <>
      {datos.recuperaciones.length ? (
        datos.recuperaciones.map((r) => (
          <Fila
            key={r.id}
            titulo={`${r.estudiante_nombre} · ${r.asignatura_nombre}`}
            lineas={[
              `${r.grupo_nombre} · ${r.nota_inicial} → ${r.nota_posterior} · mejora ${r.mejora}`,
              r.recuperacion_efectiva ? 'Recuperación efectiva' : 'No alcanzó la nota aprobatoria',
            ]}
          />
        ))
      ) : (
        <Aviso tipo="nota">Todavía no se han registrado evaluaciones posteriores.</Aviso>
      )}
    </>
  );
}
