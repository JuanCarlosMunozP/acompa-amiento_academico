/** Presenta el tablero y sus indicadores de gestión académica. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  ESTADOS_DESEMPENO,
  listarGradosConGrupos,
  obtenerEvaluacion,
  obtenerMatriz,
  type EstadoDesempeno,
  type FilaMatriz,
} from '@/api/seguimiento';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { EmbeddedScreenFrame } from '@/components/EmbeddedScreenFrame';
import { EstadoBadge } from '@/components/EstadoBadge';
import { TextField } from '@/components/TextField';
import { useCarga } from '@/hooks/useCarga';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { useSession } from '@/store/session';
import { colors, radius, spacing, typography } from '@/theme';
import { puedeVerRoles } from '@/types/roles';

type Props = NativeStackScreenProps<RootStackParamList, 'Tablero'>;

const texto = (valor: string | null, sufijo = '') => (valor === null ? '—' : `${valor}${sufijo}`);

export function TableroScreen({ navigation }: Props) {
  return (
    <TableroPanel
      onOpenFicha={(estudianteId) => navigation.navigate('FichaEstudiante', { estudianteId })}
    />
  );
}

export function TableroPanel({
  embedded = false,
  onOpenFicha,
}: {
  embedded?: boolean;
  onOpenFicha: (estudianteId: number) => void;
}) {
  const { sesion } = useSession();
  const permitido = puedeVerRoles(sesion?.usuario.rol);

  const [estado, setEstado] = useState<EstadoDesempeno | null>(null);
  const [grupo, setGrupo] = useState<number | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [q, setQ] = useState('');
  const [pagina, setPagina] = useState(1);
  const [previas, setPrevias] = useState<FilaMatriz[]>([]); // filas de las páginas anteriores
  const [abierto, setAbierto] = useState<number | null>(null);

  const grados = useCarga(listarGradosConGrupos, { habilitado: permitido });
  const matriz = useCarga(() => obtenerMatriz({ grupo, estado, q, page: pagina }), {
    habilitado: permitido,
    dependencias: [grupo, estado, q, pagina],
    error: 'No pudimos cargar el tablero. Revisa tu conexión e inténtalo de nuevo.',
  });
  const detalle = useCarga(() => obtenerEvaluacion(abierto as number), {
    habilitado: permitido && abierto !== null,
    dependencias: [abierto],
    error: 'No pudimos cargar el detalle del estudiante.',
  });

  if (!permitido) {
    return (
      <EmbeddedScreenFrame embedded={embedded}>
        <Text style={styles.title}>Sin acceso</Text>
        <Aviso tipo="error">No tienes permiso para ver el tablero de desempeño.</Aviso>
      </EmbeddedScreenFrame>
    );
  }

  // Cambiar un filtro reinicia la paginación.
  const reiniciar = () => {
    setPagina(1);
    setPrevias([]);
    setAbierto(null);
  };
  const filtrarEstado = (nuevo: EstadoDesempeno | null) => {
    setEstado(nuevo);
    reiniciar();
  };
  const filtrarGrupo = (nuevo: number | null) => {
    setGrupo(nuevo);
    reiniciar();
  };
  const buscar = () => {
    setQ(busqueda.trim());
    reiniciar();
  };
  const datos = matriz.datos;
  const filas = Array.from(
    new Map(
      [...previas, ...(datos?.results ?? [])].map((fila) => [fila.estudiante, fila]),
    ).values(),
  );
  const hayMas = !!datos?.next;

  return (
    <EmbeddedScreenFrame embedded={embedded}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Tablero de desempeño</Text>

        <Text style={styles.seccion}>Estado</Text>
        <View style={styles.chips}>
          <Chip label="Todos" selected={estado === null} onPress={() => filtrarEstado(null)} />
          {ESTADOS_DESEMPENO.map(({ codigo, etiqueta }) => (
            <Chip
              key={codigo}
              label={datos ? `${etiqueta} (${datos.resumen[codigo]})` : etiqueta}
              accessibilityLabel={etiqueta}
              selected={estado === codigo}
              onPress={() => filtrarEstado(codigo)}
            />
          ))}
        </View>

        {grados.datos && grados.datos.some((g) => g.grupos.length > 0) ? (
          <>
            <Text style={styles.seccion}>Grupo</Text>
            <View style={styles.chips}>
              <Chip
                label="Todos los grupos"
                selected={grupo === null}
                onPress={() => filtrarGrupo(null)}
              />
              {grados.datos.flatMap((g) =>
                g.grupos.map((gr) => (
                  <Chip
                    key={gr.id}
                    label={`${g.nombre} ${gr.nombre}`}
                    selected={grupo === gr.id}
                    onPress={() => filtrarGrupo(gr.id)}
                  />
                )),
              )}
            </View>
          </>
        ) : null}

        <View style={styles.searchRow}>
          <TextField
            label="Buscar estudiante"
            placeholder="Buscar estudiante..."
            value={busqueda}
            onChangeText={setBusqueda}
            onSubmitEditing={buscar}
            returnKeyType="search"
            autoCapitalize="none"
            containerStyle={styles.searchField}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ejecutar búsqueda de estudiantes"
            onPress={buscar}
            style={styles.searchButton}
          >
            <View pointerEvents="none" style={styles.searchIcon}>
              <View style={styles.searchIconLens} />
              <View style={styles.searchIconHandle} />
            </View>
          </Pressable>
        </View>

        {matriz.error ? (
          <>
            <Aviso tipo="error">{matriz.error}</Aviso>
            <Button title="Reintentar" onPress={matriz.recargar} />
          </>
        ) : null}
        {matriz.cargando && filas.length === 0 ? <Aviso tipo="nota">Cargando…</Aviso> : null}
        {datos && filas.length === 0 ? (
          <Aviso tipo="nota">No hay estudiantes con ese filtro.</Aviso>
        ) : null}
        {datos ? <Aviso tipo="nota">{`${datos.count} estudiante(s)`}</Aviso> : null}

        {filas.map((f) => (
          <View key={f.estudiante} style={styles.fila}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${f.nombre}, ${f.estado}`}
              onPress={() => setAbierto(abierto === f.estudiante ? null : f.estudiante)}
            >
              <View style={styles.cabecera}>
                <View style={styles.cabeceraTexto}>
                  <Text style={styles.nombre}>{f.nombre}</Text>
                  <Text style={styles.nota}>{f.grupo}</Text>
                </View>
                <EstadoBadge estado={f.estado} />
              </View>
              <Text style={styles.medidas}>
                {`Promedio ${texto(f.promedio)} · Asistencia ${texto(f.asistencia, ' %')} · Trabajos sin entregar ${f.trabajos_pendientes}`}
              </Text>
            </Pressable>

            {abierto === f.estudiante ? (
              <View style={styles.detalle}>
                {detalle.cargando ? <Aviso tipo="nota">Cargando detalle…</Aviso> : null}
                {detalle.error ? <Aviso tipo="error">{detalle.error}</Aviso> : null}
                {detalle.datos && detalle.datos.alertas.length === 0 ? (
                  <Aviso tipo="nota">Sin solicitudes: ninguna regla se activó.</Aviso>
                ) : null}
                {detalle.datos?.alertas.map((a) => (
                  <Text key={`${a.regla}-${a.asignatura ?? ''}`} style={styles.alerta}>
                    {`• ${a.explicacion}`}
                  </Text>
                ))}
                <Button
                  title="Abrir ficha completa"
                  variant="link"
                  onPress={() => onOpenFicha(f.estudiante)}
                />
              </View>
            ) : null}
          </View>
        ))}

        {hayMas ? (
          <Button
            title="Cargar más"
            onPress={() => {
              setPrevias(filas);
              setPagina((p) => p + 1);
            }}
            loading={matriz.cargando}
            variant="link"
          />
        ) : null}
      </ScrollView>
    </EmbeddedScreenFrame>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text, marginBottom: spacing.md },
  seccion: {
    ...typography.subtitle,
    color: colors.text,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  searchRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  searchField: { flex: 1, minWidth: 0 },
  searchButton: {
    width: 44,
    height: 44,
    marginBottom: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
  },
  searchIcon: { width: 20, height: 20, position: 'relative' },
  searchIconLens: {
    width: 14,
    height: 14,
    borderWidth: 2,
    borderColor: colors.primaryText,
    borderRadius: 7,
  },
  searchIconHandle: {
    position: 'absolute',
    width: 8,
    height: 2,
    right: 0,
    bottom: 2,
    backgroundColor: colors.primaryText,
    transform: [{ rotate: '45deg' }],
  },
  fila: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cabecera: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cabeceraTexto: { flex: 1, minWidth: 0, marginRight: spacing.sm },
  nombre: { ...typography.subtitle, color: colors.text },
  nota: { ...typography.body, color: colors.textMuted },
  medidas: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm },
  detalle: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  alerta: { ...typography.body, color: colors.text, marginBottom: spacing.xs },
});
