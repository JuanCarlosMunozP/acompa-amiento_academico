/** Presenta los datos y opciones de gestión del perfil de tutor. */
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { erroresPorCampo } from '@/api/auth';
import {
  actualizarMiPerfil,
  BIOGRAFIA_MAX,
  listarAsignaturas,
  obtenerMiPerfil,
  type Asignatura,
  type CambiosPerfil,
  type PerfilTutor,
} from '@/api/tutores';
import { obtenerMiDesempenoTutorias, type MiDesempenoTutorias } from '@/api/planes';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { useSession } from '@/store/session';
import { colors, spacing, typography } from '@/theme';

type Formulario = { biografia: string; asignaturas: number[]; disponible: boolean };

const desdePerfil = (p: PerfilTutor): Formulario => ({
  biografia: p.biografia,
  asignaturas: p.asignaturas.map((a) => a.id),
  disponible: p.disponible,
});

const mismasAsignaturas = (a: number[], b: number[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

const mensajeDe = (e: unknown, porDefecto: string) =>
  (e as { error?: { message?: string } })?.error?.message ?? porDefecto;

export function PerfilTutorScreen() {
  const { sesion } = useSession();
  const esTutor = sesion?.usuario.rol === 'tutor';

  const [intento, setIntento] = useState(0);
  const [resuelto, setResuelto] = useState(-1);
  const [errorCarga, setErrorCarga] = useState<{ intento: number; mensaje: string } | null>(null);
  const [errorDesempeno, setErrorDesempeno] = useState<{
    intento: number;
    mensaje: string;
  } | null>(null);
  const [perfil, setPerfil] = useState<PerfilTutor | null>(null);
  const [desempeno, setDesempeno] = useState<MiDesempenoTutorias | null>(null);
  const [catalogo, setCatalogo] = useState<Asignatura[]>([]);
  const [form, setForm] = useState<Formulario>({
    biografia: '',
    asignaturas: [],
    disponible: false,
  });

  const [guardando, setGuardando] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  const cargando = resuelto !== intento;

  useEffect(() => {
    if (!esTutor) return;
    let vigente = true;
    Promise.all([obtenerMiPerfil(), listarAsignaturas()])
      .then(([p, a]) => {
        if (!vigente) return;
        setPerfil(p);
        setCatalogo(a);
        setForm(desdePerfil(p));
        setResuelto(intento);
      })
      .catch((e) => {
        if (!vigente) return;
        setErrorCarga({
          intento,
          mensaje: mensajeDe(
            e,
            'No pudimos cargar tu perfil. Revisa tu conexión e inténtalo de nuevo.',
          ),
        });
        setResuelto(intento);
      });
    obtenerMiDesempenoTutorias()
      .then((d) => {
        if (vigente) setDesempeno(d);
      })
      .catch((e) => {
        if (vigente) {
          setErrorDesempeno({
            intento,
            mensaje: mensajeDe(e, 'No pudimos cargar tu desempeño. Inténtalo de nuevo más tarde.'),
          });
        }
      });
    return () => {
      vigente = false;
    };
  }, [esTutor, intento]);

  const editar = (cambios: Partial<Formulario>) => {
    setForm((f) => ({ ...f, ...cambios }));
    setGuardado(false);
    setErrores({});
    setErrorGeneral(null);
  };

  const alternarAsignatura = (id: number) =>
    editar({
      asignaturas: form.asignaturas.includes(id)
        ? form.asignaturas.filter((x) => x !== id)
        : [...form.asignaturas, id],
    });

  // Solo lo que cambió respecto a lo guardado en el servidor.
  const cambios: CambiosPerfil = {};
  if (perfil) {
    const base = desdePerfil(perfil);
    if (form.biografia.trim() !== base.biografia) cambios.biografia = form.biografia.trim();
    if (!mismasAsignaturas(form.asignaturas, base.asignaturas))
      cambios.asignaturas = form.asignaturas;
    if (form.disponible !== base.disponible) cambios.disponible = form.disponible;
  }
  const hayCambios = Object.keys(cambios).length > 0;

  const guardar = async () => {
    /* istanbul ignore next -- el botón de guardar está deshabilitado sin cambios */
    if (!hayCambios) return;
    if (form.disponible && form.asignaturas.length === 0) {
      setErrores({ disponible: 'Elige al menos una asignatura para estar disponible.' });
      return;
    }
    setGuardando(true);
    setErrores({});
    setErrorGeneral(null);
    try {
      const nuevo = await actualizarMiPerfil(cambios);
      setPerfil(nuevo);
      setForm(desdePerfil(nuevo));
      setGuardado(true);
    } catch (e) {
      const delServidor = erroresPorCampo(e);
      setErrores(delServidor);
      if (Object.keys(delServidor).length === 0) {
        setErrorGeneral(
          mensajeDe(e, 'No pudimos guardar tu perfil. Revisa tu conexión e inténtalo de nuevo.'),
        );
      }
    } finally {
      setGuardando(false);
    }
  };

  if (!esTutor) {
    return (
      <Screen>
        <Text style={styles.title}>Sin acceso</Text>
        <Text accessibilityRole="alert" style={styles.error}>
          El perfil de tutor es solo para tutores.
        </Text>
      </Screen>
    );
  }

  const mensajeCarga = errorCarga?.intento === intento ? errorCarga.mensaje : null;
  if (mensajeCarga) {
    return (
      <Screen>
        <Text style={styles.title}>Mi perfil de tutor</Text>
        <Text accessibilityRole="alert" style={styles.error}>
          {mensajeCarga}
        </Text>
        <Button title="Reintentar" onPress={() => setIntento((n) => n + 1)} />
      </Screen>
    );
  }
  if (cargando || !perfil) {
    return (
      <Screen>
        <Text style={styles.title}>Mi perfil de tutor</Text>
        <Text style={styles.nota}>Cargando…</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Mi perfil de tutor</Text>
        <Text style={styles.nota}>
          {perfil.usuario.nombres} {perfil.usuario.apellidos} · {perfil.usuario.email}
        </Text>

        <View style={styles.desempeno}>
          <Text style={styles.seccion}>Mi desempeño como docente</Text>
          {errorDesempeno?.intento === intento ? (
            <Text accessibilityRole="alert" style={styles.nota}>
              {errorDesempeno.mensaje}
            </Text>
          ) : desempeno?.rol === 'tutor' ? (
            <>
              <Text style={styles.nota}>Tutorías realizadas: {desempeno.tutorias_realizadas}</Text>
            </>
          ) : (
            <Text style={styles.nota}>Cargando tu desempeño…</Text>
          )}
        </View>

        <TextField
          label="Presentación"
          value={form.biografia}
          onChangeText={(t) => editar({ biografia: t })}
          error={errores.biografia}
          multiline
          numberOfLines={5}
          maxLength={BIOGRAFIA_MAX}
          textAlignVertical="top"
        />
        <Text style={styles.contador}>
          {form.biografia.length}/{BIOGRAFIA_MAX}
        </Text>

        <Text style={styles.seccion}>Asignaturas que dictas</Text>
        {catalogo.length === 0 ? (
          <Text style={styles.nota}>Aún no hay asignaturas disponibles. Avisa a coordinación.</Text>
        ) : (
          <View style={styles.chips}>
            {catalogo.map((a) => (
              <Chip
                key={a.id}
                label={a.nombre}
                selected={form.asignaturas.includes(a.id)}
                onPress={() => alternarAsignatura(a.id)}
              />
            ))}
          </View>
        )}
        {errores.asignaturas ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {errores.asignaturas}
          </Text>
        ) : null}

        <View style={styles.fila}>
          <View style={styles.filaTexto}>
            <Text style={styles.seccion}>Disponible para asignación</Text>
            <Text style={styles.nota}>
              Si está activo, coordinación puede asignarte estudiantes.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Disponible para asignación"
            value={form.disponible}
            onValueChange={(v) => editar({ disponible: v })}
            trackColor={{ true: colors.primary }}
          />
        </View>
        {errores.disponible ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {errores.disponible}
          </Text>
        ) : null}

        {guardado ? (
          <Text accessibilityRole="alert" style={styles.exito}>
            Perfil guardado.
          </Text>
        ) : null}
        {errorGeneral ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {errorGeneral}
          </Text>
        ) : null}

        <Button
          title="Guardar perfil"
          onPress={guardar}
          loading={guardando}
          disabled={!hayCambios}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text, marginBottom: spacing.sm },
  seccion: { ...typography.subtitle, color: colors.text, marginBottom: spacing.xs },
  nota: { ...typography.body, color: colors.textMuted, marginBottom: spacing.md },
  contador: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'right',
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
  fila: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  filaTexto: { flex: 1, marginRight: spacing.md },
  error: { ...typography.body, color: colors.error, marginBottom: spacing.md },
  exito: { ...typography.body, color: colors.success, marginBottom: spacing.md },
  desempeno: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
});
