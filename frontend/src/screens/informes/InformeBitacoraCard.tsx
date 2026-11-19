/** Presenta el resumen y las acciones de una bitácora de seguimiento. */
import { useState } from 'react';
import { Text, View } from 'react-native';

import { actualizarInformeBitacora, type InformeBitacora as InformeTutor } from '@/api/planes';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { FormModal } from '@/components/FormModal';
import { TextField } from '@/components/TextField';
import { styles } from '@/screens/informes/InformesStyles';

export function InformeBitacoraCard({
  informe,
  editable,
  onGuardado,
}: {
  informe: InformeTutor;
  editable: boolean;
  onGuardado?: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [temas, setTemas] = useState(informe.temas);
  const [desarrollo, setDesarrollo] = useState(informe.desarrollo);
  const [acuerdos, setAcuerdos] = useState(informe.acuerdos);
  const [observaciones, setObservaciones] = useState(informe.observaciones);

  const guardar = async () => {
    setGuardando(true);
    setError('');
    try {
      await actualizarInformeBitacora(informe.id, { temas, desarrollo, acuerdos, observaciones });
      setEditando(false);
      onGuardado?.();
    } catch {
      setError('No se pudo guardar el informe. Inténtalo de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  const abrirEditor = () => {
    setTemas(informe.temas);
    setDesarrollo(informe.desarrollo);
    setAcuerdos(informe.acuerdos);
    setObservaciones(informe.observaciones);
    setError('');
    setEditando(true);
  };

  return (
    <View style={styles.informeCard}>
      <Text style={styles.informeTitle}>
        {informe.estudiante} · {informe.asignatura}
      </Text>
      <Text style={styles.subtitle}>
        Tutor: {informe.tutor} · Grado: {informe.grado || 'Sin grado'} · Sesión:{' '}
        {new Date(informe.fecha_sesion).toLocaleString()}
      </Text>
      <>
        {[
          ['Temas', informe.temas],
          ['Desarrollo', informe.desarrollo],
          ['Acuerdos', informe.acuerdos],
          ['Observaciones', informe.observaciones],
        ]
          .filter(([, contenido]) => contenido)
          .map(([titulo, contenido]) => (
            <Text key={titulo} style={styles.rowText}>
              {titulo}: {contenido}
            </Text>
          ))}
        {editable ? <Button title="Editar informe" onPress={abrirEditor} variant="link" /> : null}
      </>
      <FormModal visible={editando} onClose={() => setEditando(false)}>
        <Text style={styles.informeTitle}>Editar informe</Text>
        <Text style={styles.subtitle}>
          {informe.estudiante} · {informe.asignatura}
        </Text>
        <TextField label="Temas" value={temas} onChangeText={setTemas} multiline />
        <TextField label="Desarrollo" value={desarrollo} onChangeText={setDesarrollo} multiline />
        <TextField label="Acuerdos" value={acuerdos} onChangeText={setAcuerdos} multiline />
        <TextField
          label="Observaciones"
          value={observaciones}
          onChangeText={setObservaciones}
          multiline
        />
        {error ? <Aviso tipo="error">{error}</Aviso> : null}
        <Button title="Guardar cambios" onPress={() => void guardar()} loading={guardando} />
        <Button
          title="Cancelar"
          onPress={() => setEditando(false)}
          variant="link"
          disabled={guardando}
        />
      </FormModal>
    </View>
  );
}
