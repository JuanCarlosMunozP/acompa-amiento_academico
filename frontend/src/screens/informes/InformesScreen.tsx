/** Consulta y organiza los informes disponibles para el usuario. */
import { useLayoutEffect, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { descargarInforme, obtenerInformeAcompanamiento } from '@/api/seguimiento';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { FormModal } from '@/components/FormModal';
import { EmbeddedScreenFrame } from '@/components/EmbeddedScreenFrame';
import { useCarga } from '@/hooks/useCarga';
import { useSession } from '@/store/session';
import { puedeTomarAsistencia, puedeVerRoles } from '@/types/roles';
import {
  cerrarSesionConBitacora,
  listarAgendaSesiones,
  listarInformesBitacora,
  type FiltrosInformeBitacora,
} from '@/api/planes';
import { TextField } from '@/components/TextField';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { InformeBitacoraCard } from '@/screens/informes/InformeBitacoraCard';
import {
  Indicador,
  TablaAsistencia,
  TablaAsignaturas,
  TablaGrupos,
  TablaRecuperaciones,
  TablaTutores,
} from '@/screens/informes/InformeTablas';
import { styles } from '@/screens/informes/InformesStyles';

type Props = NativeStackScreenProps<RootStackParamList, 'Informes'>;

type Seccion = 'grupos' | 'asistencia' | 'asignaturas' | 'tutores' | 'recuperaciones';
const secciones: { id: Seccion; nombre: string }[] = [
  { id: 'grupos', nombre: 'Tablero por grado' },
  { id: 'asistencia', nombre: 'Asistencia' },
  { id: 'asignaturas', nombre: 'Asignaturas' },
  { id: 'tutores', nombre: 'Tutores' },
  { id: 'recuperaciones', nombre: 'Recuperación' },
];
export function InformesScreen({ navigation }: Props) {
  const { sesion } = useSession();
  const rol = sesion?.usuario.rol;
  useLayoutEffect(() => {
    navigation.setOptions({
      title: rol === 'tutor' ? 'Mis informes' : 'Informes de acompañamiento',
    });
  }, [navigation, rol]);
  return <InformesPanel onOpenAgenda={() => navigation.navigate('Agenda')} />;
}

export function InformesPanel({
  embedded = false,
  onOpenAgenda,
}: {
  embedded?: boolean;
  onOpenAgenda: () => void;
}) {
  const { sesion } = useSession();
  const rol = sesion?.usuario.rol;
  const coordina = puedeVerRoles(sesion?.usuario.rol);
  const permitido = puedeTomarAsistencia(sesion?.usuario.rol);
  const [grupo, setGrupo] = useState<number | null>(null);
  const [asignatura, setAsignatura] = useState<number | null>(null);
  const [tutor, setTutor] = useState<number | null>(null);
  const [seccion, setSeccion] = useState<Seccion>('grupos');
  const [borradorFiltros, setBorradorFiltros] = useState<FiltrosInformeBitacora>({});
  const [filtrosAplicados, setFiltrosAplicados] = useState<FiltrosInformeBitacora>({});
  const [sesionInforme, setSesionInforme] = useState<number | null>(null);
  const [mostrarFormularioInforme, setMostrarFormularioInforme] = useState(false);
  const [temasInforme, setTemasInforme] = useState('');
  const [desarrolloInforme, setDesarrolloInforme] = useState('');
  const [acuerdosInforme, setAcuerdosInforme] = useState('');
  const [observacionesInforme, setObservacionesInforme] = useState('');
  const [guardandoInforme, setGuardandoInforme] = useState(false);
  const [errorInforme, setErrorInforme] = useState('');
  const [error, setError] = useState('');
  const [exportando, setExportando] = useState(false);
  const informe = useCarga(() => obtenerInformeAcompanamiento({ grupo, asignatura, tutor }), {
    habilitado: coordina,
    dependencias: [grupo, asignatura, tutor],
    error: 'No pudimos cargar los informes.',
  });
  const bitacoras = useCarga(() => listarInformesBitacora(coordina ? filtrosAplicados : {}), {
    habilitado: permitido,
    dependencias: [
      coordina,
      filtrosAplicados.docente,
      filtrosAplicados.grado,
      filtrosAplicados.estudiante,
      filtrosAplicados.materia,
    ],
    error: 'No pudimos cargar los informes de sesión.',
  });
  const agendaTutor = useCarga(listarAgendaSesiones, {
    habilitado: rol === 'tutor',
    error: 'No pudimos cargar tus sesiones asignadas.',
  });
  const sesionesParaInformar = (agendaTutor.datos ?? []).filter(
    (item) => item.estado !== 'cancelada' && !item.bitacora && new Date(item.fin) <= new Date(),
  );

  const guardarInformeTutor = async () => {
    /* istanbul ignore next -- el botón de guardar solo está activo con una sesión y su desarrollo */
    if (sesionInforme === null || !desarrolloInforme.trim()) return;
    setGuardandoInforme(true);
    setErrorInforme('');
    try {
      await cerrarSesionConBitacora(sesionInforme, {
        temas: temasInforme.trim(),
        desarrollo: desarrolloInforme.trim(),
        acuerdos: acuerdosInforme.trim(),
        observaciones: observacionesInforme.trim(),
      });
      setSesionInforme(null);
      setTemasInforme('');
      setDesarrolloInforme('');
      setAcuerdosInforme('');
      setObservacionesInforme('');
      setSesionInforme(null);
      setMostrarFormularioInforme(false);
      agendaTutor.recargar();
      bitacoras.recargar();
    } catch (e) {
      setErrorInforme(
        (e as { error?: { message?: string } })?.error?.message ??
          'No se pudo guardar el informe. Revisa la sesión e inténtalo de nuevo.',
      );
    } finally {
      setGuardandoInforme(false);
    }
  };

  const aplicarFiltrosInformes = () => {
    setFiltrosAplicados({
      docente: borradorFiltros.docente?.trim() ?? '',
      grado: borradorFiltros.grado?.trim() ?? '',
      estudiante: borradorFiltros.estudiante?.trim() ?? '',
      materia: borradorFiltros.materia?.trim() ?? '',
    });
    setBorradorFiltros({});
  };

  const exportar = async () => {
    try {
      setExportando(true);
      setError('');
      const response = await descargarInforme(seccion, { grupo, asignatura, tutor });
      const disposition = response.headers.get('Content-Disposition');
      const nombre = disposition?.match(/filename="?([^";]+)"?/i)?.[1] ?? `informe-${seccion}.csv`;
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(await response.blob());
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = nombre;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const data = new Uint8Array(await response.arrayBuffer());
        let binary = '';
        for (const byte of data) binary += String.fromCharCode(byte);
        const uri = `${FileSystem.cacheDirectory}${nombre}`;
        await FileSystem.writeAsStringAsync(uri, btoa(binary), {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
      }
    } catch {
      setError('No pudimos generar el archivo.');
    } finally {
      setExportando(false);
    }
  };

  if (!permitido)
    return (
      <EmbeddedScreenFrame embedded={embedded}>
        <Aviso tipo="error">Esta sección es para tutores y coordinación.</Aviso>
      </EmbeddedScreenFrame>
    );
  if (rol === 'tutor') {
    return (
      <EmbeddedScreenFrame embedded={embedded}>
        <ScrollView>
          <Text style={styles.title}>Mis informes</Text>
          <Text style={styles.subtitle}>
            Registra el informe de una sesión terminada y consulta tus informes anteriores. Una vez
            guardado, no puedes modificarlo.
          </Text>
          <Aviso tipo="nota">
            Si detectas un error en un informe, solicita la corrección a rectoría o coordinación.
          </Aviso>
          <Text style={styles.section}>Registrar informe de tutoría</Text>
          {agendaTutor.error ? <Aviso tipo="error">{agendaTutor.error}</Aviso> : null}
          {agendaTutor.cargando ? (
            <Aviso tipo="nota">Cargando tus sesiones asignadas…</Aviso>
          ) : null}
          {sesionesParaInformar.length === 0 && !agendaTutor.cargando ? (
            <Aviso tipo="nota">
              No tienes sesiones terminadas y asignadas que todavía requieran un informe.
            </Aviso>
          ) : null}
          <View style={styles.chips}>
            {sesionesParaInformar.map((item) => (
              <Chip
                key={item.id}
                label={`${item.estudiante_nombre} · ${item.asignatura_nombre} · ${new Date(item.inicio).toLocaleDateString('es-CO')}`}
                selected={sesionInforme === item.id}
                onPress={() => {
                  setSesionInforme(item.id);
                  setTemasInforme('');
                  setDesarrolloInforme('');
                  setAcuerdosInforme('');
                  setObservacionesInforme('');
                  setErrorInforme('');
                  setMostrarFormularioInforme(true);
                }}
              />
            ))}
          </View>
          <FormModal
            visible={mostrarFormularioInforme && sesionInforme !== null}
            onClose={() => setMostrarFormularioInforme(false)}
          >
            <Text style={styles.informeTitle}>Registrar informe de tutoría</Text>
            {sesionesParaInformar.find((item) => item.id === sesionInforme) ? (
              <Text style={styles.subtitle}>
                {sesionesParaInformar.find((item) => item.id === sesionInforme)?.estudiante_nombre}
                {' · '}
                {sesionesParaInformar.find((item) => item.id === sesionInforme)?.asignatura_nombre}
              </Text>
            ) : null}
            <View style={styles.informeCard}>
              <TextField
                label="Temas tratados"
                value={temasInforme}
                onChangeText={setTemasInforme}
                multiline
              />
              <TextField
                label="Desarrollo de la tutoría"
                value={desarrolloInforme}
                onChangeText={setDesarrolloInforme}
                multiline
              />
              <TextField
                label="Acuerdos y próximos pasos"
                value={acuerdosInforme}
                onChangeText={setAcuerdosInforme}
                multiline
              />
              <TextField
                label="Observaciones"
                value={observacionesInforme}
                onChangeText={setObservacionesInforme}
                multiline
              />
              {errorInforme ? <Aviso tipo="error">{errorInforme}</Aviso> : null}
              <Button
                title="Guardar informe"
                onPress={() => void guardarInformeTutor()}
                loading={guardandoInforme}
                disabled={!desarrolloInforme.trim()}
              />
            </View>
          </FormModal>
          <Button title="Ver mi agenda" onPress={onOpenAgenda} />
          {bitacoras.error ? <Aviso tipo="error">{bitacoras.error}</Aviso> : null}
          {bitacoras.cargando ? <Aviso tipo="nota">Cargando informes…</Aviso> : null}
          {bitacoras.datos?.length === 0 ? (
            <Aviso tipo="nota">Todavía no has registrado informes de sesión.</Aviso>
          ) : null}
          {bitacoras.datos?.map((item) => (
            <InformeBitacoraCard key={item.id} informe={item} editable={false} />
          ))}
        </ScrollView>
      </EmbeddedScreenFrame>
    );
  }
  const datos = informe.datos;
  return (
    <EmbeddedScreenFrame embedded={embedded}>
      <ScrollView>
        <Text style={styles.title}>Informes de acompañamiento</Text>
        {datos ? <Text style={styles.subtitle}>{datos.periodo.nombre}</Text> : null}
        <Text style={styles.section}>Informes registrados por tutores</Text>
        <Aviso tipo="nota">
          Estos informes documentan acompañamientos que el estudiante ya recibió. Si el tutor
          solicita corregir un error, rectoría o coordinación puede editar el informe; el tutor
          puede consultarlo, pero no modificarlo.
        </Aviso>
        <Text style={styles.subtitle}>
          Los tutores registran los informes al cerrar sus sesiones. Rectoría y coordinación pueden
          revisarlos y editarlos, pero no crear informes.
        </Text>
        <>
          <Text style={styles.section}>
            Buscar informes por docente, grado, estudiante o materia
          </Text>
          <TextField
            label="Nombre del docente"
            value={borradorFiltros.docente ?? ''}
            onChangeText={(docente) => setBorradorFiltros((actual) => ({ ...actual, docente }))}
            placeholder="Ej. Ana Gómez"
          />
          <TextField
            label="Grado del estudiante"
            value={borradorFiltros.grado ?? ''}
            onChangeText={(grado) => setBorradorFiltros((actual) => ({ ...actual, grado }))}
            placeholder="Ej. Octavo"
          />
          <TextField
            label="Nombre del estudiante"
            value={borradorFiltros.estudiante ?? ''}
            onChangeText={(estudiante) =>
              setBorradorFiltros((actual) => ({ ...actual, estudiante }))
            }
            placeholder="Ej. Juan Pérez"
          />
          <TextField
            label="Materia de la tutoría"
            value={borradorFiltros.materia ?? ''}
            onChangeText={(materia) => setBorradorFiltros((actual) => ({ ...actual, materia }))}
            placeholder="Ej. Matemáticas"
          />
          <View style={styles.searchButton}>
            <Button title="Buscar informes" onPress={aplicarFiltrosInformes} />
          </View>
        </>
        {bitacoras.error ? <Aviso tipo="error">{bitacoras.error}</Aviso> : null}
        {bitacoras.cargando ? <Aviso tipo="nota">Cargando informes registrados…</Aviso> : null}
        {bitacoras.datos?.length === 0 ? (
          <Aviso tipo="nota">No hay informes que coincidan con esos filtros.</Aviso>
        ) : null}
        {bitacoras.datos?.map((item) => (
          <InformeBitacoraCard
            key={item.id}
            informe={item}
            editable
            onGuardado={bitacoras.recargar}
          />
        ))}
        {informe.error ? <Aviso tipo="error">{informe.error}</Aviso> : null}
        {error ? <Aviso tipo="error">{error}</Aviso> : null}
        {informe.cargando && !datos ? <Aviso tipo="nota">Cargando informes…</Aviso> : null}
        {datos ? (
          <>
            <View style={styles.cards}>
              <Indicador etiqueta="Estudiantes" valor={datos.cards.estudiantes} />
              <Indicador etiqueta="Críticos" valor={datos.cards.criticos} alerta />
              <Indicador etiqueta="En riesgo" valor={datos.cards.en_riesgo} alerta />
              <Indicador etiqueta="Planes en curso" valor={datos.cards.planes_en_curso} />
              <Indicador
                etiqueta="Recuperaciones efectivas"
                valor={datos.cards.recuperaciones_efectivas}
              />
            </View>
            <>
              <Text style={styles.section}>Filtrar por grupo</Text>
              <View style={styles.chips}>
                <Chip label="Todos" selected={grupo === null} onPress={() => setGrupo(null)} />
                {datos.filtros.grupos.map((item) => (
                  <Chip
                    key={item.id}
                    label={item.nombre}
                    selected={grupo === item.id}
                    onPress={() => setGrupo(grupo === item.id ? null : item.id)}
                  />
                ))}
              </View>
              <Text style={styles.section}>Filtrar por asignatura</Text>
              <View style={styles.chips}>
                <Chip
                  label="Todas"
                  selected={asignatura === null}
                  onPress={() => setAsignatura(null)}
                />
                {datos.filtros.asignaturas.map((item) => (
                  <Chip
                    key={item.id}
                    label={item.nombre}
                    selected={asignatura === item.id}
                    onPress={() => setAsignatura(asignatura === item.id ? null : item.id)}
                  />
                ))}
              </View>
              {datos.filtros.tutores.length ? (
                <>
                  <Text style={styles.section}>Filtrar por tutor</Text>
                  <View style={styles.chips}>
                    <Chip label="Todos" selected={tutor === null} onPress={() => setTutor(null)} />
                    {datos.filtros.tutores.map((item) => (
                      <Chip
                        key={item.id}
                        label={item.nombre}
                        selected={tutor === item.id}
                        onPress={() => setTutor(tutor === item.id ? null : item.id)}
                      />
                    ))}
                  </View>
                </>
              ) : null}
            </>
            <Text style={styles.section}>Reporte</Text>
            <View style={styles.chips}>
              {secciones.map((item) => (
                <Chip
                  key={item.id}
                  label={item.nombre}
                  selected={seccion === item.id}
                  onPress={() => setSeccion(item.id)}
                />
              ))}
            </View>
            <Button
              title={`Exportar ${seccion} a CSV`}
              onPress={() => void exportar()}
              loading={exportando}
            />
            {seccion === 'grupos' ? <TablaGrupos datos={datos} /> : null}
            {seccion === 'asistencia' ? <TablaAsistencia datos={datos} /> : null}
            {seccion === 'asignaturas' ? <TablaAsignaturas datos={datos} /> : null}
            {seccion === 'tutores' ? <TablaTutores datos={datos} /> : null}
            {seccion === 'recuperaciones' ? <TablaRecuperaciones datos={datos} /> : null}
          </>
        ) : null}
      </ScrollView>
    </EmbeddedScreenFrame>
  );
}
