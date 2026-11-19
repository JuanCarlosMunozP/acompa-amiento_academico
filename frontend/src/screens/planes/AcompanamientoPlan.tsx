/** Acompañamiento del expediente: dudas y aclaraciones, entregas, retroalimentación y correcciones. */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  descargarEntrega,
  escribirDuda,
  listarDudas,
  listarEntregas,
  retroalimentarEntrega,
  subirEntrega,
  type Actividad,
  type Duda,
  type Entrega,
} from '@/api/planes';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { FormModal } from '@/components/FormModal';
import { SwitchField } from '@/components/SwitchField';
import { TextField } from '@/components/TextField';
import { useCarga } from '@/hooks/useCarga';
import { colors, radius, spacing, typography } from '@/theme';
import { elegirArchivo, guardarRespuesta } from '@/utils/archivos';
import { mensajeDe } from '@/utils/errores';

type Props = {
  planId: number;
  actividades: Actividad[];
  /** Rol de quien consulta: estudiante y docente participan; el resto solo lee. */
  rol: string;
  /** Si el docente de la sesión es el responsable del expediente. */
  esDocenteResponsable: boolean;
  /** El expediente admite cambios (en acompañamiento, no cerrado). */
  abierto: boolean;
  onCambio: () => void;
};

const fecha = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });

export function AcompanamientoPlan({
  planId,
  actividades,
  rol,
  esDocenteResponsable,
  abierto,
  onCambio,
}: Props) {
  const esEstudiante = rol === 'estudiante';
  const participa = esEstudiante || esDocenteResponsable;

  return (
    <>
      <Dudas planId={planId} puedeEscribir={participa && abierto} />
      <Text style={styles.seccion}>Entregas y correcciones</Text>
      {actividades.length === 0 ? (
        <Aviso tipo="nota">Cuando el docente cree actividades, aquí se cargan las entregas.</Aviso>
      ) : null}
      {actividades.map((actividad) => (
        <EntregasDeActividad
          key={actividad.id}
          actividad={actividad}
          esEstudiante={esEstudiante}
          esDocenteResponsable={esDocenteResponsable}
          abierto={abierto}
          onCambio={onCambio}
        />
      ))}
    </>
  );
}

function Dudas({ planId, puedeEscribir }: { planId: number; puedeEscribir: boolean }) {
  const carga = useCarga(() => listarDudas(planId), {
    dependencias: [planId],
    error: 'No pudimos cargar las dudas.',
  });
  const [texto, setTexto] = useState('');
  const [respondiendo, setRespondiendo] = useState<Duda | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    if (!texto.trim()) {
      setError('Escribe tu mensaje.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      await escribirDuda(planId, texto.trim(), respondiendo?.id);
      setTexto('');
      setRespondiendo(null);
      carga.recargar();
    } catch (e) {
      setError(mensajeDe(e, 'No pudimos enviar el mensaje. Inténtalo de nuevo.'));
    } finally {
      setEnviando(false);
    }
  };

  const dudas = carga.datos ?? [];
  return (
    <>
      <Text style={styles.seccion}>Dudas y aclaraciones</Text>
      {carga.error ? <Aviso tipo="error">{carga.error}</Aviso> : null}
      {carga.datos && dudas.length === 0 ? <Aviso tipo="nota">Aún no hay mensajes.</Aviso> : null}
      {dudas.map((duda) => (
        <View key={duda.id} style={[styles.tarjeta, duda.respuesta_a !== null && styles.respuesta]}>
          <Text style={styles.nombre}>{duda.autor_nombre}</Text>
          <Text style={styles.cuerpo}>{duda.texto}</Text>
          <Text style={styles.nota}>{fecha(duda.creada)}</Text>
          {puedeEscribir && duda.respuesta_a === null ? (
            <Button
              title={`Responder a ${duda.autor_nombre}`}
              variant="link"
              onPress={() => setRespondiendo(duda)}
            />
          ) : null}
        </View>
      ))}
      {puedeEscribir ? (
        <>
          {respondiendo ? (
            <Aviso tipo="nota">{`Respondiendo a ${respondiendo.autor_nombre}.`}</Aviso>
          ) : null}
          <TextField
            label={respondiendo ? 'Tu respuesta' : 'Escribe tu duda o aclaración'}
            value={texto}
            onChangeText={setTexto}
            multiline
          />
          {error ? <Aviso tipo="error">{error}</Aviso> : null}
          <Button title="Enviar mensaje" onPress={() => void enviar()} loading={enviando} />
        </>
      ) : null}
    </>
  );
}

type PropsEntregas = {
  actividad: Actividad;
  esEstudiante: boolean;
  esDocenteResponsable: boolean;
  abierto: boolean;
  onCambio: () => void;
};

function EntregasDeActividad({
  actividad,
  esEstudiante,
  esDocenteResponsable,
  abierto,
  onCambio,
}: PropsEntregas) {
  const carga = useCarga(() => listarEntregas(actividad.id), {
    dependencias: [actividad.id],
    error: 'No pudimos cargar las entregas.',
  });
  const [comentario, setComentario] = useState('');
  const [retro, setRetro] = useState<Entrega | null>(null);
  const [textoRetro, setTextoRetro] = useState('');
  const [corregir, setCorregir] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entregas = carga.datos ?? [];
  const ultima = entregas[entregas.length - 1];
  const aceptada = ultima?.retroalimentacion?.requiere_correccion === false;
  const esperandoDocente = ultima !== undefined && ultima.retroalimentacion === null;
  const pideCorreccion = ultima?.retroalimentacion?.requiere_correccion === true;
  const puedeCargar = esEstudiante && abierto && !aceptada && !esperandoDocente;

  const ejecutar = async (accion: () => Promise<unknown>, mensajeError: string) => {
    setOcupado(true);
    setError(null);
    try {
      await accion();
      carga.recargar();
      onCambio();
      return true;
    } catch (e) {
      setError(mensajeDe(e, mensajeError));
      return false;
    } finally {
      setOcupado(false);
    }
  };

  const cargar = async () => {
    const elegido = await elegirArchivo();
    if (!elegido) return;
    const listo = await ejecutar(
      () => subirEntrega(actividad.id, elegido.formulario, comentario.trim()),
      'No pudimos cargar el archivo. Inténtalo de nuevo.',
    );
    if (listo) setComentario('');
  };

  const descargar = (entrega: Entrega) =>
    void ejecutar(
      async () => guardarRespuesta(await descargarEntrega(entrega.id), entrega.archivo_nombre),
      'No pudimos descargar el archivo.',
    );

  const enviarRetro = async () => {
    /* istanbul ignore next -- el botón de guardar solo existe con la retroalimentación abierta */
    if (!retro) return;
    if (!textoRetro.trim()) {
      setError('Escribe la retroalimentación.');
      return;
    }
    const listo = await ejecutar(
      () =>
        retroalimentarEntrega(retro.id, {
          comentario: textoRetro.trim(),
          requiere_correccion: corregir,
        }),
      'No pudimos guardar la retroalimentación.',
    );
    if (listo) {
      setRetro(null);
      setTextoRetro('');
      setCorregir(false);
    }
  };

  return (
    <View style={styles.tarjeta}>
      <Text style={styles.nombre}>{actividad.titulo}</Text>
      {carga.error ? <Aviso tipo="error">{carga.error}</Aviso> : null}
      {carga.datos && entregas.length === 0 ? (
        <Text style={styles.nota}>Sin entregas todavía.</Text>
      ) : null}
      {entregas.map((entrega) => (
        <View key={entrega.id} style={styles.entrega}>
          <Text style={styles.cuerpo}>
            {`${entrega.tipo === 'correccion' ? 'Corrección' : 'Entrega'} · ${entrega.archivo_nombre}`}
          </Text>
          <Text style={styles.nota}>{fecha(entrega.fecha)}</Text>
          {entrega.comentario ? <Text style={styles.nota}>{entrega.comentario}</Text> : null}
          <Button
            title={`Descargar ${entrega.archivo_nombre}`}
            variant="link"
            disabled={ocupado}
            onPress={() => descargar(entrega)}
          />
          {entrega.retroalimentacion ? (
            <Text style={styles.retro}>
              {`${entrega.retroalimentacion.docente_nombre ?? 'Docente'}: ${entrega.retroalimentacion.comentario}${
                entrega.retroalimentacion.requiere_correccion
                  ? ' (requiere corrección)'
                  : ' (aceptada)'
              }`}
            </Text>
          ) : esDocenteResponsable && abierto ? (
            <Button
              title="Retroalimentar"
              variant="link"
              onPress={() => {
                setRetro(entrega);
                setError(null);
              }}
            />
          ) : null}
        </View>
      ))}
      {pideCorreccion && esEstudiante ? (
        <Aviso tipo="nota">El docente pidió una corrección: carga el archivo corregido.</Aviso>
      ) : null}
      {aceptada ? <Aviso tipo="exito">Actividad aceptada por el docente.</Aviso> : null}
      {puedeCargar ? (
        <>
          <TextField
            label="Comentario (opcional)"
            value={comentario}
            onChangeText={setComentario}
          />
          <Button
            title={pideCorreccion ? 'Cargar corrección' : 'Cargar entrega'}
            onPress={() => void cargar()}
            loading={ocupado}
          />
        </>
      ) : null}
      {error && !retro ? <Aviso tipo="error">{error}</Aviso> : null}
      <FormModal visible={retro !== null} onClose={() => !ocupado && setRetro(null)}>
        <Text style={styles.nombre}>Retroalimentar entrega</Text>
        {error ? <Aviso tipo="error">{error}</Aviso> : null}
        <TextField
          label="Observaciones para el estudiante"
          value={textoRetro}
          onChangeText={setTextoRetro}
          multiline
        />
        <SwitchField label="Requiere corrección" value={corregir} onValueChange={setCorregir} />
        <Button
          title="Guardar retroalimentación"
          onPress={() => void enviarRetro()}
          loading={ocupado}
        />
        <Button title="Cancelar" variant="link" disabled={ocupado} onPress={() => setRetro(null)} />
      </FormModal>
    </View>
  );
}

const styles = StyleSheet.create({
  seccion: {
    ...typography.subtitle,
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  nombre: { ...typography.subtitle, color: colors.text },
  cuerpo: { ...typography.body, color: colors.text },
  nota: { ...typography.body, color: colors.textMuted },
  retro: { ...typography.body, color: colors.primary, marginTop: spacing.xs },
  tarjeta: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  respuesta: { marginLeft: spacing.lg, borderLeftColor: colors.primary, borderLeftWidth: 3 },
  entrega: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
  },
});
