/** Verificación institucional: observaciones, visto bueno de coordinación y reporte imprimible. */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  darVistoBueno,
  listarObservaciones,
  obtenerReporteImprimible,
  registrarObservacion,
  type SeguimientoPlan,
} from '@/api/planes';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { useCarga } from '@/hooks/useCarga';
import { colors, radius, spacing, typography } from '@/theme';
import { abrirParaImprimir } from '@/utils/archivos';
import { mensajeDe } from '@/utils/errores';

type Props = {
  plan: SeguimientoPlan;
  /** Coordinación (coordinador o administrador): registra observaciones y da el visto bueno. */
  coordina: boolean;
  esDocenteResponsable: boolean;
  onCambio: () => void;
};

export function VerificacionPlan({ plan, coordina, esDocenteResponsable, onCambio }: Props) {
  const veObservaciones = coordina || esDocenteResponsable;
  const observaciones = useCarga(() => listarObservaciones(plan.id), {
    habilitado: veObservaciones,
    dependencias: [plan.id],
    error: 'No pudimos cargar las observaciones.',
  });
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const ejecutar = async (accion: () => Promise<unknown>, exito: string, fallo: string) => {
    setOcupado(true);
    setError(null);
    setMensaje(null);
    try {
      await accion();
      setMensaje(exito);
      return true;
    } catch (e) {
      setError(mensajeDe(e, fallo));
      return false;
    } finally {
      setOcupado(false);
    }
  };

  const observar = async () => {
    if (!texto.trim()) {
      setError('Escribe la observación.');
      return;
    }
    const listo = await ejecutar(
      () => registrarObservacion(plan.id, texto.trim()),
      'Observación registrada.',
      'No pudimos registrar la observación.',
    );
    if (listo) {
      setTexto('');
      observaciones.recargar();
    }
  };

  const vistoBueno = async () => {
    const listo = await ejecutar(
      () => darVistoBueno(plan.id),
      'Visto bueno registrado.',
      'No pudimos registrar el visto bueno.',
    );
    if (listo) onCambio();
  };

  const imprimir = () =>
    void ejecutar(
      async () => abrirParaImprimir(await obtenerReporteImprimible(plan.id), 'reporte.html'),
      'Reporte listo para imprimir.',
      'No pudimos generar el reporte.',
    );

  if (!veObservaciones) return null;
  const cerrado = plan.estado === 'cerrado';

  return (
    <>
      <Text style={styles.seccion}>Verificación de coordinación</Text>
      {mensaje ? <Aviso tipo="exito">{mensaje}</Aviso> : null}
      {error ? <Aviso tipo="error">{error}</Aviso> : null}
      {observaciones.error ? <Aviso tipo="error">{observaciones.error}</Aviso> : null}
      {observaciones.datos && observaciones.datos.length === 0 ? (
        <Aviso tipo="nota">Todavía no hay observaciones.</Aviso>
      ) : null}
      {observaciones.datos?.map((o) => (
        <View key={o.id} style={styles.tarjeta}>
          <Text style={styles.cuerpo}>{o.texto}</Text>
          <Text style={styles.nota}>{o.autor_nombre ?? 'Coordinación'}</Text>
        </View>
      ))}
      {coordina ? (
        <>
          <TextField label="Nueva observación" value={texto} onChangeText={setTexto} multiline />
          <Button title="Registrar observación" onPress={() => void observar()} loading={ocupado} />
        </>
      ) : null}

      {cerrado ? (
        <>
          <Text style={styles.nota}>
            {plan.visto_bueno
              ? `Visto bueno de ${plan.visto_bueno_por_nombre ?? 'coordinación'}.`
              : 'Pendiente del visto bueno de coordinación.'}
          </Text>
          {coordina && !plan.visto_bueno ? (
            <Button title="Dar visto bueno" onPress={() => void vistoBueno()} disabled={ocupado} />
          ) : null}
          <Button title="Reporte imprimible" variant="link" onPress={imprimir} disabled={ocupado} />
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  seccion: {
    ...typography.subtitle,
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  cuerpo: { ...typography.body, color: colors.text },
  nota: { ...typography.body, color: colors.textMuted },
  tarjeta: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
});
