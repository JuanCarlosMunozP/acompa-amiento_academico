/** Permite consultar y actualizar los datos personales del usuario autenticado. */
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { codigoDeError, erroresPorCampo } from '@/api/auth';
import { actualizarMisDatos, NOMBRE_MAX } from '@/api/perfil';
import { obtenerMiDesempenoTutorias } from '@/api/planes';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { EmbeddedScreenFrame } from '@/components/EmbeddedScreenFrame';
import { TextField } from '@/components/TextField';
import { useCarga } from '@/hooks/useCarga';
import { useSession } from '@/store/session';
import { colors, spacing, typography } from '@/theme';

import { SeguridadMfa } from './SeguridadMfa';

const limpiar = (texto: string) => texto.split(/\s+/).filter(Boolean).join(' ');

export function DatosPersonalesScreen({ embedded = false }: { embedded?: boolean }) {
  const { sesion, actualizarUsuario } = useSession();
  const usuario = sesion?.usuario;
  const desempeno = useCarga(obtenerMiDesempenoTutorias, {
    habilitado: usuario?.rol === 'estudiante',
    error: 'No pudimos cargar tu desempeño en las tutorías.',
  });

  const [nombres, setNombres] = useState(usuario?.nombres ?? '');
  const [apellidos, setApellidos] = useState(usuario?.apellidos ?? '');
  // Lo último guardado: con esto se sabe si hay cambios sin depender de cuándo se refresque la sesión.
  const [base, setBase] = useState({
    nombres: usuario?.nombres ?? '',
    apellidos: usuario?.apellidos ?? '',
  });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [guardando, setGuardando] = useState(false);

  if (!usuario) {
    return (
      <EmbeddedScreenFrame embedded={embedded}>
        <Text style={styles.title}>Sin sesión</Text>
        <Text accessibilityRole="alert" style={styles.error}>
          Inicia sesión para ver tus datos.
        </Text>
      </EmbeddedScreenFrame>
    );
  }

  const hayCambios = limpiar(nombres) !== base.nombres || limpiar(apellidos) !== base.apellidos;
  const descripcionPorRol: Record<string, string> = {
    administrador:
      'Desde tu perfil puedes mantener actualizados tus datos personales. Como rector o administrador, también tienes acceso a la gestión institucional, la supervisión académica y la configuración general de la plataforma.',
    coordinador:
      'Desde tu perfil puedes mantener actualizados tus datos personales. Como coordinador académico, acompañas el seguimiento de estudiantes, la organización de tutorías y la revisión de informes de acuerdo con los permisos de tu institución.',
    tutor:
      'Desde tu perfil puedes mantener actualizados tus datos personales. Como tutor, puedes consultar tus planes asignados, organizar tus sesiones y registrar el acompañamiento realizado a cada estudiante.',
    estudiante:
      'Desde tu perfil puedes mantener actualizados tus datos personales y consultar un resumen de tu participación en tutorías. Como estudiante, aquí encuentras información vinculada a tus solicitudes y al acompañamiento académico recibido.',
  };

  const editar = (poner: (v: string) => void) => (valor: string) => {
    poner(valor);
    setGuardado(false);
    setErrores({});
    setErrorGeneral(null);
  };

  const guardar = async () => {
    const locales: Record<string, string> = {};
    if (!limpiar(nombres)) locales.nombres = 'Ingresa tus nombres.';
    if (!limpiar(apellidos)) locales.apellidos = 'Ingresa tus apellidos.';
    setErrores(locales);
    if (Object.keys(locales).length > 0 || !hayCambios) return;

    setGuardando(true);
    setErrorGeneral(null);
    try {
      const nuevo = await actualizarMisDatos({
        nombres: limpiar(nombres),
        apellidos: limpiar(apellidos),
      });
      await actualizarUsuario(nuevo);
      setNombres(nuevo.nombres);
      setApellidos(nuevo.apellidos);
      setBase({ nombres: nuevo.nombres, apellidos: nuevo.apellidos });
      setGuardado(true);
    } catch (e) {
      const delServidor = erroresPorCampo(e);
      setErrores(delServidor);
      if (Object.keys(delServidor).length === 0) {
        setErrorGeneral(
          codigoDeError(e) === 'sesion_expirada'
            ? 'Tu sesión venció. Inicia sesión de nuevo.'
            : 'No pudimos guardar tus datos. Revisa tu conexión e inténtalo de nuevo.',
        );
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <EmbeddedScreenFrame embedded={embedded}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Mi perfil</Text>
        <Text style={styles.descripcion}>
          {descripcionPorRol[usuario.rol] ??
            'Desde tu perfil puedes mantener actualizados tus datos personales y consultar las funciones disponibles para tu rol en la institución.'}
        </Text>
        <Text style={styles.nota}>
          Tu correo ({usuario.email}) y tu rol los administra la institución.
        </Text>

        {usuario.rol === 'estudiante' ? (
          <View style={styles.desempeno}>
            <Text style={styles.seccion}>Mi desempeño en tutorías</Text>
            {desempeno.cargando ? <Text style={styles.nota}>Cargando tu resumen…</Text> : null}
            {desempeno.error ? <Aviso tipo="error">{desempeno.error}</Aviso> : null}
            {desempeno.datos?.rol === 'estudiante' ? (
              <>
                <Text style={styles.nota}>
                  Tutorías realizadas: {desempeno.datos.tutorias_realizadas} · Asistencias:{' '}
                  {desempeno.datos.asistencias}
                </Text>
                <Text style={styles.nota}>
                  Porcentaje de asistencia:{' '}
                  {desempeno.datos.porcentaje_asistencia === null
                    ? 'Sin datos'
                    : `${desempeno.datos.porcentaje_asistencia}%`}
                </Text>
              </>
            ) : null}
          </View>
        ) : null}

        <TextField
          label="Nombres"
          value={nombres}
          onChangeText={editar(setNombres)}
          error={errores.nombres}
          maxLength={NOMBRE_MAX}
          autoComplete="given-name"
        />
        <TextField
          label="Apellidos"
          value={apellidos}
          onChangeText={editar(setApellidos)}
          error={errores.apellidos}
          maxLength={NOMBRE_MAX}
          autoComplete="family-name"
        />

        {guardado ? (
          <Text accessibilityRole="alert" style={styles.exito}>
            Datos guardados.
          </Text>
        ) : null}
        {errorGeneral ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {errorGeneral}
          </Text>
        ) : null}
        <View style={styles.button}>
          <Button
            title="Guardar cambios"
            onPress={guardar}
            loading={guardando}
            disabled={!hayCambios}
          />
        </View>

        <SeguridadMfa />
      </ScrollView>
    </EmbeddedScreenFrame>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text, marginBottom: spacing.sm },
  button: { alignSelf: 'flex-start', maxWidth: '100%' },
  descripcion: { ...typography.body, color: colors.text, marginBottom: spacing.md },
  nota: { ...typography.body, color: colors.textMuted, marginBottom: spacing.lg },
  error: { ...typography.body, color: colors.error, marginBottom: spacing.md },
  exito: { ...typography.body, color: colors.success, marginBottom: spacing.md },
  desempeno: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  seccion: { ...typography.subtitle, color: colors.text, marginBottom: spacing.xs },
});
