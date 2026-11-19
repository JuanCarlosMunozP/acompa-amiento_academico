/** Consulta la agenda y las sesiones de tutoría programadas. */
import { useEffect, useLayoutEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import {
  cancelarSesionConMotivo,
  cerrarSesionConBitacora,
  descargarMaterialSesion,
  listarAgendaSesiones,
  subirMaterialSesion,
  type SesionTutoria,
} from '@/api/planes';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { FormModal } from '@/components/FormModal';
import { Screen } from '@/components/Screen';
import { useCarga } from '@/hooks/useCarga';
import { useSession } from '@/store/session';
import { colors, radius, spacing, typography } from '@/theme';
import { TextField } from '@/components/TextField';
import type { RootStackParamList } from '@/navigation/RootNavigator';

export function AgendaScreen() {
  const { sesion } = useSession();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const rol = sesion?.usuario.rol;
  const estudiante = rol === 'estudiante';
  const puedeVerAgenda = rol === 'tutor' || estudiante;

  useLayoutEffect(() => {
    navigation.setOptions({ title: estudiante ? 'Tutorías por asistir' : 'Agenda de tutorías' });
  }, [estudiante, navigation]);

  const agenda = useCarga(listarAgendaSesiones, {
    habilitado: puedeVerAgenda,
    error: 'No pudimos cargar la agenda. Revisa tu conexión e inténtalo de nuevo.',
  });
  useEffect(() => navigation.addListener('focus', agenda.recargar), [agenda.recargar, navigation]);
  const [cancelando, setCancelando] = useState<number | null>(null);
  const [confirmar, setConfirmar] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [, revisarHora] = useState(0);

  useEffect(() => {
    if (!estudiante) return;
    const reloj = setInterval(() => revisarHora(Date.now()), 30000);
    return () => clearInterval(reloj);
  }, [estudiante]);

  const cancelar = async (id: number) => {
    setCancelando(id);
    setError(null);
    try {
      if (!motivo.trim()) {
        setError('Indica el motivo de cancelación.');
        return;
      }
      await cancelarSesionConMotivo(id, motivo.trim());
      setConfirmar(null);
      setMotivo('');
      agenda.recargar();
    } catch (e) {
      setError((e as { error?: { message?: string } })?.error?.message ?? 'No se pudo cancelar.');
    } finally {
      setCancelando(null);
    }
  };

  const sesiones = [...(agenda.datos ?? [])].sort(
    (a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime(),
  );
  const puedeCancelar = rol === 'tutor';

  if (!sesion) {
    return (
      <Screen>
        <Aviso tipo="error">Inicia sesión para consultar tus tutorías.</Aviso>
      </Screen>
    );
  }

  if (!puedeVerAgenda) {
    return (
      <Screen>
        <Aviso tipo="error">Esta agenda es exclusiva para tutores y estudiantes.</Aviso>
        <Button title="Volver al inicio" onPress={() => navigation.navigate('Home')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView>
        <Text style={styles.title}>
          {estudiante ? 'Tutorías a las que debes asistir' : 'Agenda de tutorías asignadas'}
        </Text>
        {agenda.cargando ? <Aviso tipo="nota">Cargando agenda…</Aviso> : null}
        {agenda.error ? <Aviso tipo="error">{agenda.error}</Aviso> : null}
        {error ? <Aviso tipo="error">{error}</Aviso> : null}
        {!agenda.cargando && !agenda.error && sesiones.length === 0 ? (
          <Aviso tipo="nota">
            {estudiante
              ? 'Aún no tienes tutorías programadas para asistir.'
              : 'Todavía no tienes sesiones asignadas en tu agenda.'}
          </Aviso>
        ) : null}
        {sesiones.map((sesionAgenda) => (
          <SesionCard
            key={sesionAgenda.id}
            sesion={sesionAgenda}
            puedeRegistrarAsistencia={estudiante}
            onRegistrarAsistencia={() =>
              navigation.navigate('Asistencia', { sesion: sesionAgenda })
            }
            puedeCancelar={puedeCancelar}
            confirmar={confirmar === sesionAgenda.id}
            cancelando={cancelando === sesionAgenda.id}
            onConfirmar={() => setConfirmar(sesionAgenda.id)}
            onCancelar={() => void cancelar(sesionAgenda.id)}
            onCerrar={() => setConfirmar(null)}
            motivo={motivo}
            onMotivo={setMotivo}
            puedeMarcar={puedeCancelar}
            onReprogramar={() =>
              navigation.navigate('ProgramarSesion', {
                planId: sesionAgenda.plan,
                session: sesionAgenda,
              })
            }
            onActualizar={agenda.recargar}
          />
        ))}
      </ScrollView>
    </Screen>
  );
}

function SesionCard({
  sesion,
  puedeRegistrarAsistencia,
  onRegistrarAsistencia,
  puedeCancelar,
  confirmar,
  cancelando,
  onConfirmar,
  onCancelar,
  onCerrar,
  motivo,
  onMotivo,
  puedeMarcar,
  onReprogramar,
  onActualizar,
}: {
  sesion: SesionTutoria;
  puedeRegistrarAsistencia: boolean;
  onRegistrarAsistencia: () => void;
  puedeCancelar: boolean;
  confirmar: boolean;
  cancelando: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
  onCerrar: () => void;
  motivo: string;
  onMotivo: (valor: string) => void;
  puedeMarcar: boolean;
  onReprogramar: () => void;
  onActualizar: () => void;
}) {
  const [mostrarCierre, setMostrarCierre] = useState(false);
  const [temas, setTemas] = useState('');
  const [desarrollo, setDesarrollo] = useState('');
  const [acuerdos, setAcuerdos] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [tituloArchivo, setTituloArchivo] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const cerrarSesion = async () => {
    setOcupado(true);
    setMensaje('');
    try {
      await cerrarSesionConBitacora(sesion.id, {
        temas,
        desarrollo,
        acuerdos,
        observaciones,
      });
      setMostrarCierre(false);
      onActualizar();
    } catch (e) {
      setMensaje(
        (e as { error?: { message?: string } })?.error?.message ?? 'No se pudo cerrar la sesión.',
      );
    } finally {
      setOcupado(false);
    }
  };
  const elegirYSubir = async () => {
    try {
      const resultado = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (resultado.canceled) return;
      const archivo = resultado.assets[0];
      const formulario = new FormData();
      if (Platform.OS === 'web' && archivo.file) formulario.append('archivo', archivo.file);
      else
        formulario.append('archivo', {
          uri: archivo.uri,
          name: archivo.name,
          type: archivo.mimeType ?? 'application/octet-stream',
        } as unknown as Blob);
      setOcupado(true);
      setMensaje('');
      await subirMaterialSesion(sesion.id, tituloArchivo || archivo.name, '', formulario);
      setTituloArchivo('');
      onActualizar();
    } catch (e) {
      setMensaje(
        (e as { error?: { message?: string } })?.error?.message ?? 'No se pudo subir el material.',
      );
    } finally {
      setOcupado(false);
    }
  };
  const descargar = async (materialId: number, nombre: string) => {
    try {
      setOcupado(true);
      const response = await descargarMaterialSesion(sesion.id, materialId);
      const disposition = response.headers.get('Content-Disposition');
      const nombreDescarga = disposition?.match(/filename="?([^";]+)"?/i)?.[1] ?? nombre;
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(await response.blob());
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = nombreDescarga;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const data = await response.arrayBuffer();
        const bytes = new Uint8Array(data);
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        const uri = `${FileSystem.cacheDirectory}${nombreDescarga.replace(/[\\/:*?"<>|]/g, '_')}`;
        await FileSystem.writeAsStringAsync(uri, btoa(binary), {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
      }
    } catch {
      setMensaje('No se pudo descargar el material.');
    } finally {
      setOcupado(false);
    }
  };
  const inicio = new Date(sesion.inicio);
  const fin = new Date(sesion.fin);
  return (
    <View style={[styles.card, sesion.estado === 'cancelada' && styles.cancelada]}>
      <Text style={styles.asignatura}>{sesion.asignatura_nombre}</Text>
      <Text style={styles.datos}>
        {inicio.toLocaleDateString('es-CO', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
      </Text>
      <Text style={styles.datos}>
        {inicio.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}–
        {fin.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })} ·{' '}
        {sesion.modalidad === 'virtual' ? 'Virtual' : 'Presencial'}
      </Text>
      <Text style={styles.datos}>Estudiante: {sesion.estudiante_nombre}</Text>
      <Text style={styles.datos}>Tutor: {sesion.tutor_nombre}</Text>
      {sesion.lugar ? <Text style={styles.datos}>Lugar: {sesion.lugar}</Text> : null}
      {sesion.enlace_virtual ? (
        <Text
          accessibilityRole="link"
          onPress={() => void Linking.openURL(sesion.enlace_virtual)}
          style={styles.link}
        >
          {sesion.enlace_virtual}
        </Text>
      ) : null}
      {sesion.notas ? <Text style={styles.datos}>{sesion.notas}</Text> : null}
      {sesion.estado === 'cancelada' ? <Text style={styles.estado}>Cancelada</Text> : null}
      {sesion.estado === 'realizada' ? (
        <Text style={styles.estado}>
          Realizada · asistencia: {etiquetaAsistencia(sesion.asistencia)}
        </Text>
      ) : null}
      {sesion.motivo_cancelacion ? (
        <Text style={styles.datos}>Motivo: {sesion.motivo_cancelacion}</Text>
      ) : null}
      {sesion.inasistencias_tutorias > 0 ? (
        <Text style={styles.datos}>
          Inasistencias de tutoría del estudiante: {sesion.inasistencias_tutorias}
        </Text>
      ) : null}
      {sesion.estado === 'programada' && puedeCancelar && fin > new Date() ? (
        <Button title="Reprogramar" onPress={onReprogramar} variant="link" />
      ) : null}
      {puedeRegistrarAsistencia && sesion.estado === 'programada' && fin <= new Date() ? (
        <View style={styles.confirmacion}>
          <Button title="Registrar asistencia" onPress={onRegistrarAsistencia} />
        </View>
      ) : null}
      {(sesion.estado === 'programada' || sesion.estado === 'realizada') &&
      puedeMarcar &&
      fin < new Date() &&
      !sesion.bitacora ? (
        <View style={styles.confirmacion}>
          {!mostrarCierre ? (
            <Button
              title="Cerrar sesión y registrar bitácora"
              onPress={() => setMostrarCierre(true)}
            />
          ) : (
            <FormModal visible={mostrarCierre} onClose={() => !ocupado && setMostrarCierre(false)}>
              <Text style={styles.datos}>
                El estudiante registrará su asistencia desde su agenda.
              </Text>
              <TextField label="Temas tratados" value={temas} onChangeText={setTemas} multiline />
              <TextField
                label="Desarrollo de la sesión"
                value={desarrollo}
                onChangeText={setDesarrollo}
                multiline
              />
              <TextField
                label="Acuerdos y próximos pasos"
                value={acuerdos}
                onChangeText={setAcuerdos}
                multiline
              />
              <TextField
                label="Observaciones"
                value={observaciones}
                onChangeText={setObservaciones}
                multiline
              />
              {mensaje ? <Aviso tipo="error">{mensaje}</Aviso> : null}
              <Button
                title="Guardar bitácora y cerrar"
                onPress={() => void cerrarSesion()}
                loading={ocupado}
                disabled={!desarrollo.trim()}
              />
              <Button title="Cancelar" onPress={() => setMostrarCierre(false)} variant="link" />
            </FormModal>
          )}
        </View>
      ) : null}
      {sesion.bitacora ? (
        <View style={styles.confirmacion}>
          <Text style={styles.datos}>Bitácora de sesión</Text>
          {[
            ['Temas', sesion.bitacora.temas],
            ['Desarrollo', sesion.bitacora.desarrollo],
            ['Acuerdos', sesion.bitacora.acuerdos],
            ['Observaciones', sesion.bitacora.observaciones],
          ]
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <Text key={label} style={styles.datos}>
                {label}: {value}
              </Text>
            ))}
        </View>
      ) : null}
      {sesion.estado !== 'cancelada' ? (
        <View style={styles.confirmacion}>
          <Text style={styles.datos}>Materiales de la sesión</Text>
          {(sesion.materiales ?? []).map((material) => (
            <Button
              key={material.id}
              title={`Descargar · ${material.titulo}`}
              onPress={() => void descargar(material.id, material.titulo)}
              variant="link"
              disabled={ocupado}
            />
          ))}
          {puedeCancelar ? (
            <>
              <TextField
                label="Título del material (opcional)"
                value={tituloArchivo}
                onChangeText={setTituloArchivo}
              />
              <Button
                title="Seleccionar y subir archivo"
                onPress={() => void elegirYSubir()}
                loading={ocupado}
              />
            </>
          ) : null}
          {mensaje ? <Aviso tipo="error">{mensaje}</Aviso> : null}
        </View>
      ) : null}
      {puedeCancelar && sesion.estado === 'programada' ? (
        confirmar ? (
          <View style={styles.confirmacion}>
            <Text style={styles.datos}>¿Cancelar esta sesión?</Text>
            <TextField
              label="Motivo de cancelación"
              value={motivo}
              onChangeText={onMotivo}
              multiline
            />
            <Button title="Sí, cancelar" onPress={onCancelar} loading={cancelando} />
            <Button title="Volver" onPress={onCerrar} variant="link" disabled={cancelando} />
          </View>
        ) : (
          <Button title="Cancelar sesión" onPress={onConfirmar} variant="link" />
        )
      ) : null}
    </View>
  );
}

function etiquetaAsistencia(estado: SesionTutoria['asistencia']) {
  return {
    pendiente: 'pendiente',
    presente: 'presente',
    ausente: 'ausente',
    excusa: 'justificada',
  }[estado];
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text, marginBottom: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cancelada: { opacity: 0.65 },
  asignatura: { ...typography.subtitle, color: colors.text, fontWeight: '700' },
  datos: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs },
  link: { ...typography.body, color: colors.primary, marginTop: spacing.xs },
  estado: { ...typography.body, color: colors.error, fontWeight: '700', marginTop: spacing.sm },
  confirmacion: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
});
