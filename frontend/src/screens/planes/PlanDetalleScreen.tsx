/** Presenta el expediente de nivelación: registro, acompañamiento y cierre. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { fechaValida } from '@/api/academico';
import {
  actualizarActividad,
  agregarActividad,
  asignarTutor,
  cerrarPlan,
  etiquetaResultado,
  ETIQUETA_PLAN,
  listarTutoresElegibles,
  notaValida,
  obtenerSeguimiento,
} from '@/api/planes';
import {
  fechaLocal,
  obtenerEvaluacionPosteriorPlan,
  registrarEvaluacionPosterior,
} from '@/api/seguimiento';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { FormModal } from '@/components/FormModal';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { useCarga } from '@/hooks/useCarga';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { useSession } from '@/store/session';
import { colors, radius, spacing, typography } from '@/theme';
import { puedeVerRoles } from '@/types/roles';
import { erroresDeCampos, mensajeDe } from '@/utils/errores';
import { AcompanamientoPlan } from './AcompanamientoPlan';
import { VerificacionPlan } from './VerificacionPlan';

type Props = NativeStackScreenProps<RootStackParamList, 'PlanDetalle'>;

const codigoDe = (e: unknown) => (e as { error?: { code?: string } })?.error?.code;

/** Expediente de nivelación: avance, actividades, acompañamiento, cierre y verificación. */
export function PlanDetalleScreen({ route, navigation }: Props) {
  const { planId } = route.params;
  const { sesion } = useSession();
  const coordina = puedeVerRoles(sesion?.usuario.rol);

  const carga = useCarga(() => obtenerSeguimiento(planId), {
    habilitado: !!sesion,
    dependencias: [planId],
    error: 'No pudimos cargar el plan. Revisa tu conexión e inténtalo de nuevo.',
  });
  const plan = carga.datos;
  const vigente = plan?.estado === 'pendiente' || plan?.estado === 'asignado';
  const elegibles = useCarga(() => listarTutoresElegibles(planId), {
    habilitado: coordina && !!vigente,
    dependencias: [planId, plan?.tutor],
    error: 'No pudimos cargar los tutores disponibles.',
  });
  const evaluacionPosterior = useCarga(() => obtenerEvaluacionPosteriorPlan(planId), {
    habilitado: !!plan?.puede_gestionar && plan.estado === 'cerrado',
    dependencias: [planId, plan?.estado, plan?.puede_gestionar],
    error: 'No pudimos consultar la evaluación posterior.',
  });

  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [fecha, setFecha] = useState(() => fechaLocal(1));
  const [valoracion, setValoracion] = useState('');
  const [notaFinal, setNotaFinal] = useState('');
  const [notaPosterior, setNotaPosterior] = useState('');
  const [observacionesPosteriores, setObservacionesPosteriores] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmarCierre, setConfirmarCierre] = useState(false);
  const [mostrarCierrePlan, setMostrarCierrePlan] = useState(false);
  const [mostrarActividad, setMostrarActividad] = useState(false);
  const [mostrarEvaluacionPosterior, setMostrarEvaluacionPosterior] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  if (!sesion) {
    return (
      <Screen>
        <Aviso tipo="error">Inicia sesión para ver el plan.</Aviso>
      </Screen>
    );
  }
  if (carga.error) {
    return (
      <Screen>
        <Aviso tipo="error">{carga.error}</Aviso>
        <Button title="Reintentar" onPress={carga.recargar} />
      </Screen>
    );
  }
  if (!plan) {
    return (
      <Screen>
        <Aviso tipo="nota">Cargando…</Aviso>
      </Screen>
    );
  }

  // Ejecuta una acción, vuelve a cargar el plan y muestra el resultado o el error.
  const ejecutar = async (accion: () => Promise<unknown>) => {
    setOcupado(true);
    setError(null);
    setMensaje(null);
    try {
      await accion();
      carga.recargar();
      return true;
    } catch (e) {
      setError(mensajeDe(e, 'No pudimos completar la acción. Inténtalo de nuevo.'));
      return false;
    } finally {
      setOcupado(false);
    }
  };

  const agregar = async () => {
    const locales: Record<string, string> = {};
    if (!titulo.trim()) locales.titulo = 'Escribe el título de la actividad.';
    if (!fechaValida(fecha)) locales.fecha_limite = 'Usa el formato AAAA-MM-DD.';
    setErrores(locales);
    if (Object.keys(locales).length > 0) return;

    setOcupado(true);
    setError(null);
    setMensaje(null);
    try {
      await agregarActividad(planId, {
        titulo: titulo.trim(),
        descripcion: descripcion.trim(),
        fecha_limite: fecha,
      });
      setTitulo('');
      setDescripcion('');
      setMostrarActividad(false);
      carga.recargar();
      setMensaje('Actividad agregada.');
    } catch (e) {
      const porCampo = erroresDeCampos(e);
      setErrores(porCampo);
      if (Object.keys(porCampo).length === 0) {
        setError(mensajeDe(e, 'No pudimos agregar la actividad. Inténtalo de nuevo.'));
      }
    } finally {
      setOcupado(false);
    }
  };

  const cerrar = async (forzar: boolean) => {
    const locales: Record<string, string> = {};
    if (!valoracion.trim()) locales.valoracion = 'Escribe la valoración descriptiva.';
    const nota = notaValida(notaFinal);
    if (nota === null) locales.nota_final = 'La nota debe estar entre 1,0 y 5,0.';
    setErrores(locales);
    if (nota === null || Object.keys(locales).length > 0) return;
    setOcupado(true);
    setError(null);
    setMensaje(null);
    try {
      await cerrarPlan(planId, { valoracion: valoracion.trim(), nota_final: nota, forzar });
      setConfirmarCierre(false);
      setMostrarCierrePlan(false);
      carga.recargar();
      setMensaje('Expediente cerrado.');
    } catch (e) {
      if (codigoDe(e) === 'actividades_pendientes') {
        setConfirmarCierre(true);
        setError(mensajeDe(e, 'Quedan actividades sin cumplir.'));
      } else {
        const porCampo = erroresDeCampos(e);
        setErrores(porCampo);
        if (Object.keys(porCampo).length === 0) {
          setError(mensajeDe(e, 'No pudimos cerrar el expediente. Inténtalo de nuevo.'));
        }
      }
    } finally {
      setOcupado(false);
    }
  };

  const abierto = plan.estado === 'asignado';
  const esDocenteResponsable = sesion.usuario.rol === 'tutor' && plan.tutor === sesion.usuario.id;

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{plan.asignatura_nombre}</Text>
        <Text style={styles.nota}>{plan.estudiante_nombre}</Text>
        <Text style={styles.nota}>
          {`${ETIQUETA_PLAN[plan.estado]} · ${plan.fecha_inicio} al ${plan.fecha_fin}`}
        </Text>
        <Text style={styles.nota}>
          {plan.docente_nombre ? `Docente: ${plan.docente_nombre}` : 'Sin docente asignado'}
        </Text>
        {plan.atrasado ? <Aviso tipo="error">Este plan va atrasado.</Aviso> : null}
        {mensaje ? <Aviso tipo="exito">{mensaje}</Aviso> : null}
        {error && !mostrarActividad && !mostrarCierrePlan ? (
          <Aviso tipo="error">{error}</Aviso>
        ) : null}

        <Text style={styles.seccion}>Desempeños no alcanzados</Text>
        <Text style={styles.cuerpo}>
          {plan.desempenos_no_alcanzados || 'Sin desempeños registrados.'}
        </Text>

        <Text style={styles.seccion}>Objetivos</Text>
        <Text style={styles.cuerpo}>{plan.objetivos}</Text>

        <Text style={styles.seccion}>Avance</Text>
        <Text style={styles.cuerpo}>
          {plan.progreso === null
            ? 'Aún no hay actividades.'
            : `${plan.progreso} % · ${plan.actividades_completadas} de ${plan.actividades_total} actividades`}
        </Text>

        <Text style={styles.seccion}>Encuentros de acompañamiento</Text>
        {plan.sesiones.length === 0 ? (
          <Aviso tipo="nota">Todavía no se han programado encuentros para este expediente.</Aviso>
        ) : (
          plan.sesiones.map((sesion) => (
            <View style={styles.actividad} key={sesion.id}>
              <Text style={styles.nombre}>
                {new Date(sesion.inicio).toLocaleString('es-CO', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
              <Text style={styles.nota}>
                {sesion.modalidad === 'virtual' ? 'Virtual' : `Presencial · ${sesion.lugar}`}
                {` · ${sesion.estado === 'programada' ? 'Programada' : 'Cancelada'}`}
              </Text>
              {sesion.enlace_virtual ? (
                <Text style={styles.nota}>{sesion.enlace_virtual}</Text>
              ) : null}
            </View>
          ))
        )}
        {plan.puede_gestionar && abierto ? (
          <Button
            title="Programar encuentro"
            onPress={() => navigation.navigate('ProgramarSesion', { planId })}
          />
        ) : null}

        {plan.estado === 'cerrado' ? (
          <Aviso tipo="nota">
            {`Cerrado el ${plan.fecha_cierre}. Resultado: ${etiquetaResultado(plan.resultado)}${
              plan.nota_final ? `. Nota: ${plan.nota_final.replace('.', ',')}` : ''
            }.${plan.nota_cierre ? ` ${plan.nota_cierre}` : ''}`}
          </Aviso>
        ) : null}

        {plan.estado === 'cerrado' && plan.puede_gestionar ? (
          <>
            <Text style={styles.seccion}>Evaluación posterior a la recuperación</Text>
            {evaluacionPosterior.error ? (
              <Aviso tipo="error">{evaluacionPosterior.error}</Aviso>
            ) : null}
            {evaluacionPosterior.datos?.[0] ? (
              <View style={styles.actividad}>
                <Text style={styles.nombre}>
                  Nota inicial {evaluacionPosterior.datos[0].nota_inicial} → nota posterior{' '}
                  {evaluacionPosterior.datos[0].nota_posterior}
                </Text>
                <Text style={styles.nota}>
                  Mejora: {evaluacionPosterior.datos[0].mejora} ·{' '}
                  {evaluacionPosterior.datos[0].recuperacion_efectiva
                    ? 'Recuperación efectiva (nota ≥ 3,00)'
                    : 'No alcanzó la nota aprobatoria'}
                </Text>
                {evaluacionPosterior.datos[0].observaciones ? (
                  <Text style={styles.nota}>{evaluacionPosterior.datos[0].observaciones}</Text>
                ) : null}
              </View>
            ) : (
              <>
                <Button
                  title="Guardar evaluación"
                  onPress={() => setMostrarEvaluacionPosterior(true)}
                />
                <FormModal
                  visible={mostrarEvaluacionPosterior}
                  onClose={() => !ocupado && setMostrarEvaluacionPosterior(false)}
                >
                  <Text style={styles.nombre}>Registrar evaluación posterior</Text>
                  <TextField
                    label="Nota posterior (1,00 a 5,00)"
                    value={notaPosterior}
                    onChangeText={setNotaPosterior}
                    keyboardType="decimal-pad"
                  />
                  <TextField
                    label="Observaciones (opcional)"
                    value={observacionesPosteriores}
                    onChangeText={setObservacionesPosteriores}
                    multiline
                  />
                  <Button
                    title="Registrar evaluación posterior"
                    disabled={ocupado || !notaPosterior.trim()}
                    loading={ocupado}
                    onPress={() =>
                      void ejecutar(async () => {
                        await registrarEvaluacionPosterior({
                          plan: planId,
                          nota_posterior: notaPosterior.replace(',', '.'),
                          observaciones: observacionesPosteriores,
                        });
                        setMensaje('Evaluación posterior registrada y mejora calculada.');
                        evaluacionPosterior.recargar();
                        setMostrarEvaluacionPosterior(false);
                        carga.recargar();
                      })
                    }
                  />
                </FormModal>
              </>
            )}
          </>
        ) : null}

        <Text style={styles.seccion}>Actividades</Text>
        {plan.actividades.length === 0 ? (
          <Aviso tipo="nota">No hay actividades registradas.</Aviso>
        ) : null}
        {plan.actividades.map((a) => (
          <View key={a.id} style={styles.actividad}>
            <Text style={styles.nombre}>{a.titulo}</Text>
            {a.descripcion ? <Text style={styles.nota}>{a.descripcion}</Text> : null}
            <Text style={styles.nota}>
              {a.completada
                ? `Completada · límite ${a.fecha_limite}`
                : `Pendiente · límite ${a.fecha_limite}${a.vencida ? ' (vencida)' : ''}`}
            </Text>
            {plan.puede_gestionar && abierto ? (
              <Button
                title={a.completada ? `Reabrir ${a.titulo}` : `Marcar completada ${a.titulo}`}
                variant="link"
                disabled={ocupado}
                onPress={() =>
                  void ejecutar(() => actualizarActividad(a.id, { completada: !a.completada }))
                }
              />
            ) : null}
          </View>
        ))}

        {plan.puede_gestionar && abierto ? (
          <>
            <Button
              title="Nueva actividad"
              onPress={() => setMostrarActividad(true)}
              variant="link"
            />
            <FormModal
              visible={mostrarActividad}
              onClose={() => !ocupado && setMostrarActividad(false)}
            >
              <Text style={styles.seccion}>Nueva actividad</Text>
              {error ? <Aviso tipo="error">{error}</Aviso> : null}
              <TextField
                label="Título de la actividad"
                value={titulo}
                onChangeText={setTitulo}
                error={errores.titulo}
              />
              <TextField
                label="Descripción (opcional)"
                value={descripcion}
                onChangeText={setDescripcion}
                multiline
                error={errores.descripcion}
              />
              <TextField
                label="Fecha límite (AAAA-MM-DD)"
                value={fecha}
                onChangeText={setFecha}
                autoCapitalize="none"
                error={errores.fecha_limite}
              />
              <Button title="Agregar actividad" onPress={agregar} loading={ocupado} />
              <Button
                title="Cancelar"
                onPress={() => setMostrarActividad(false)}
                variant="link"
                disabled={ocupado}
              />
            </FormModal>
          </>
        ) : null}

        {esDocenteResponsable && abierto ? (
          <>
            <Button
              title="Cerrar el expediente"
              onPress={() => setMostrarCierrePlan(true)}
              variant="link"
            />
            <FormModal
              visible={mostrarCierrePlan}
              onClose={() => !ocupado && setMostrarCierrePlan(false)}
            >
              <Text style={styles.seccion}>Cerrar el expediente</Text>
              {error ? <Aviso tipo="error">{error}</Aviso> : null}
              <TextField
                label="Valoración descriptiva"
                value={valoracion}
                onChangeText={setValoracion}
                multiline
                error={errores.valoracion}
              />
              <TextField
                label="Nota (1,0 a 5,0)"
                value={notaFinal}
                onChangeText={setNotaFinal}
                keyboardType="decimal-pad"
                error={errores.nota_final}
              />
              {confirmarCierre ? (
                <Button
                  title="Cerrar de todos modos"
                  onPress={() => void cerrar(true)}
                  disabled={ocupado}
                />
              ) : (
                <Button
                  title="Cerrar expediente"
                  onPress={() => void cerrar(false)}
                  disabled={ocupado}
                />
              )}
              <Button
                title="Cancelar"
                onPress={() => setMostrarCierrePlan(false)}
                variant="link"
                disabled={ocupado}
              />
            </FormModal>
          </>
        ) : null}

        <AcompanamientoPlan
          planId={planId}
          actividades={plan.actividades}
          rol={sesion.usuario.rol}
          esDocenteResponsable={esDocenteResponsable}
          abierto={abierto}
          onCambio={carga.recargar}
        />
        <VerificacionPlan
          plan={plan}
          coordina={coordina}
          esDocenteResponsable={esDocenteResponsable}
          onCambio={carga.recargar}
        />

        {coordina && vigente ? (
          <>
            <Text style={styles.seccion}>
              {plan.tutor ? 'Cambiar de docente' : 'Asignar docente'}
            </Text>
            <Text style={styles.nota}>
              Solo aparecen docentes habilitados, disponibles y que trabajan esta área. La lista
              prioriza menor carga; revisa los desempeños descritos arriba antes de asignar.
            </Text>
            {elegibles.error ? <Aviso tipo="error">{elegibles.error}</Aviso> : null}
            {elegibles.datos && elegibles.datos.length === 0 ? (
              <Aviso tipo="nota">Ningún docente está habilitado y disponible para esta área.</Aviso>
            ) : null}
            {elegibles.datos?.map((t, indice) => (
              <Button
                key={t.id}
                title={`${indice === 0 ? 'Mejor opción por carga' : 'Asignar a'}: ${t.nombre} (${t.carga} plan(es))`}
                variant="link"
                disabled={ocupado || t.id === plan.tutor}
                onPress={() =>
                  void ejecutar(async () => {
                    const r = await asignarTutor(planId, t.id);
                    setMensaje(
                      r.notificacion && !(r.notificacion.tutor && r.notificacion.estudiante)
                        ? 'Docente asignado, pero no pudimos enviar todos los avisos por correo.'
                        : 'Docente asignado y notificado.',
                    );
                  })
                }
              />
            ))}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text },
  seccion: {
    ...typography.subtitle,
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  cuerpo: { ...typography.body, color: colors.text },
  nombre: { ...typography.subtitle, color: colors.text },
  nota: { ...typography.body, color: colors.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm },
  actividad: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
});
