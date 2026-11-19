/** Directorio de estudiantes para que el docente identifique a quién registrar en nivelación. */
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { listarEstudiantes } from '@/api/usuarios';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { EmbeddedScreenFrame } from '@/components/EmbeddedScreenFrame';
import { TextField } from '@/components/TextField';
import { useCarga } from '@/hooks/useCarga';
import { colors, radius, spacing, typography } from '@/theme';

type Props = {
  embedded?: boolean;
  onRegistrar: (estudianteId: number, nombre: string) => void;
};

export function EstudiantesNivelacionPanel({ embedded = false, onRegistrar }: Props) {
  const [busqueda, setBusqueda] = useState('');
  const [consulta, setConsulta] = useState('');
  const estudiantes = useCarga(() => listarEstudiantes({ q: consulta }), {
    dependencias: [consulta],
    error: 'No pudimos cargar los estudiantes. Revisa tu conexión e inténtalo de nuevo.',
  });

  return (
    <EmbeddedScreenFrame embedded={embedded}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Estudiantes</Text>
        <Text style={styles.nota}>
          Busca al estudiante por nombre y registra sus desempeños no alcanzados para iniciar el
          plan de nivelación.
        </Text>
        <TextField
          label="Buscar por nombre o apellido"
          value={busqueda}
          onChangeText={setBusqueda}
          autoCapitalize="none"
        />
        <Button title="Buscar" onPress={() => setConsulta(busqueda)} variant="link" />
        {estudiantes.error ? (
          <>
            <Aviso tipo="error">{estudiantes.error}</Aviso>
            <Button title="Reintentar" onPress={estudiantes.recargar} />
          </>
        ) : null}
        {estudiantes.cargando ? <Aviso tipo="nota">Cargando…</Aviso> : null}
        {estudiantes.datos?.results.length === 0 ? (
          <Aviso tipo="nota">No se encontraron estudiantes.</Aviso>
        ) : null}
        {estudiantes.datos?.results.map((ficha) => {
          const nombre = `${ficha.usuario.nombres} ${ficha.usuario.apellidos}`;
          return (
            <View key={ficha.id} style={styles.fila}>
              <Text style={styles.nombre}>{nombre}</Text>
              <Text style={styles.nota}>
                {ficha.grado && ficha.grupo
                  ? `${ficha.grado.nombre} · grupo ${ficha.grupo.nombre}`
                  : 'Sin grupo asignado'}
              </Text>
              <Button
                title={`Registrar nivelación de ${nombre}`}
                variant="link"
                onPress={() => onRegistrar(ficha.usuario.id, nombre)}
              />
            </View>
          );
        })}
        {estudiantes.datos?.next ? (
          <Aviso tipo="nota">Hay más resultados: afina la búsqueda por nombre.</Aviso>
        ) : null}
      </ScrollView>
    </EmbeddedScreenFrame>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text, marginBottom: spacing.sm },
  nota: { ...typography.body, color: colors.textMuted, marginBottom: spacing.sm },
  nombre: { ...typography.subtitle, color: colors.text },
  fila: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
});
