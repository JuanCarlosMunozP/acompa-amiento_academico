/** Registro del expediente de nivelación: desempeños no alcanzados, área y fechas. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { fechaValida } from '@/api/academico';
import { crearPlan, DESEMPENOS_MAX, OBJETIVOS_MAX } from '@/api/planes';
import { fechaLocal } from '@/api/seguimiento';
import { listarAsignaturas } from '@/api/tutores';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { useCarga } from '@/hooks/useCarga';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { useSession } from '@/store/session';
import { colors, spacing, typography } from '@/theme';
import { puedeVerRoles } from '@/types/roles';
import { erroresDeCampos, mensajeDe } from '@/utils/errores';

type Props = NativeStackScreenProps<RootStackParamList, 'PlanRefuerzo'>;

/** Formulario para registrar el expediente de nivelación de un estudiante (docente). */
export function PlanRefuerzoScreen({ navigation, route }: Props) {
  const { estudianteId, nombre } = route.params;
  const { sesion } = useSession();
  const permitido = puedeVerRoles(sesion?.usuario.rol) || sesion?.usuario.rol === 'tutor';

  const asignaturas = useCarga(listarAsignaturas, {
    habilitado: permitido,
    error: 'No pudimos cargar las asignaturas.',
  });
  const [asignatura, setAsignatura] = useState<number | null>(null);
  const [desempenos, setDesempenos] = useState('');
  const [objetivos, setObjetivos] = useState('');
  const [inicio, setInicio] = useState(() => fechaLocal(1));
  const [fin, setFin] = useState(() => fechaLocal(30));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  if (!permitido) {
    return (
      <Screen>
        <Text style={styles.title}>Sin acceso</Text>
        <Aviso tipo="error">
          Solo el docente o coordinación registran expedientes de nivelación.
        </Aviso>
      </Screen>
    );
  }

  const guardar = async () => {
    const locales: Record<string, string> = {};
    if (asignatura === null) locales.asignatura = 'Elige la asignatura.';
    if (!desempenos.trim())
      locales.desempenos_no_alcanzados = 'Indica los desempeños no alcanzados.';
    if (desempenos.length > DESEMPENOS_MAX) {
      locales.desempenos_no_alcanzados = `Máximo ${DESEMPENOS_MAX} caracteres.`;
    }
    if (!objetivos.trim()) locales.objetivos = 'Describe el plan de nivelación.';
    if (objetivos.length > OBJETIVOS_MAX) {
      locales.objetivos = `Máximo ${OBJETIVOS_MAX} caracteres.`;
    }
    if (!fechaValida(inicio)) locales.fecha_inicio = 'Usa el formato AAAA-MM-DD.';
    if (!fechaValida(fin)) locales.fecha_fin = 'Usa el formato AAAA-MM-DD.';
    if (!locales.fecha_inicio && !locales.fecha_fin && fin < inicio) {
      locales.fecha_fin = 'La fecha de fin no puede ser anterior a la de inicio.';
    }
    setErrores(locales);
    setErrorGeneral(null);
    if (Object.keys(locales).length > 0) return;

    setGuardando(true);
    try {
      await crearPlan({
        estudiante: estudianteId,
        asignatura: asignatura as number,
        objetivos: objetivos.trim(),
        desempenos_no_alcanzados: desempenos.trim(),
        fecha_inicio: inicio,
        fecha_fin: fin,
      });
      navigation.goBack();
    } catch (e) {
      const porCampo = erroresDeCampos(e);
      setErrores(porCampo);
      if (Object.keys(porCampo).length === 0) {
        setErrorGeneral(
          mensajeDe(
            e,
            'No pudimos registrar el expediente. Revisa tu conexión e inténtalo de nuevo.',
          ),
        );
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Registro de nivelación</Text>
        <Text style={styles.nota}>{nombre}</Text>

        <Text style={styles.seccion}>Área</Text>
        {asignaturas.error ? <Aviso tipo="error">{asignaturas.error}</Aviso> : null}
        <View style={styles.chips}>
          {asignaturas.datos?.map((a) => (
            <Chip
              key={a.id}
              label={a.nombre}
              selected={asignatura === a.id}
              onPress={() => setAsignatura(a.id)}
            />
          ))}
        </View>
        {errores.asignatura ? <Aviso tipo="error">{errores.asignatura}</Aviso> : null}

        <TextField
          label="Desempeños no alcanzados"
          value={desempenos}
          onChangeText={setDesempenos}
          multiline
          numberOfLines={4}
          error={errores.desempenos_no_alcanzados}
        />
        <TextField
          label="Plan de nivelación (objetivos)"
          value={objetivos}
          onChangeText={setObjetivos}
          multiline
          numberOfLines={4}
          error={errores.objetivos}
        />
        <TextField
          label="Fecha de inicio (AAAA-MM-DD)"
          value={inicio}
          onChangeText={setInicio}
          autoCapitalize="none"
          error={errores.fecha_inicio}
        />
        <TextField
          label="Fecha de fin (AAAA-MM-DD)"
          value={fin}
          onChangeText={setFin}
          autoCapitalize="none"
          error={errores.fecha_fin}
        />
        {errores.estudiante ? <Aviso tipo="error">{errores.estudiante}</Aviso> : null}
        {errorGeneral ? <Aviso tipo="error">{errorGeneral}</Aviso> : null}
        <Button title="Registrar expediente" onPress={guardar} loading={guardando} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text },
  nota: { ...typography.body, color: colors.textMuted, marginBottom: spacing.md },
  seccion: { ...typography.subtitle, color: colors.text, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
});
