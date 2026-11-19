/** Permite asignar o actualizar el rol de una cuenta de usuario. */
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  asignarRol,
  listarRoles,
  listarUsuarios,
  type RolCatalogo,
  type UsuarioLista,
} from '@/api/usuarios';
import { Button } from '@/components/Button';
import { FormModal } from '@/components/FormModal';
import { Chip } from '@/components/Chip';
import { EmbeddedScreenFrame } from '@/components/EmbeddedScreenFrame';
import { TextField } from '@/components/TextField';
import { useSession } from '@/store/session';
import { colors, radius, spacing, typography } from '@/theme';
import { esSuperadmin, puedeAsignarRoles, puedeVerRoles, type Rol } from '@/types/roles';

type Consulta = { q: string; rol: Rol | null; pagina: number; n: number };

const FILTROS_ROL: { codigo: Rol | null; etiqueta: string }[] = [
  { codigo: null, etiqueta: 'Todos' },
  { codigo: 'estudiante', etiqueta: 'Estudiantes' },
  { codigo: 'tutor', etiqueta: 'Tutores' },
  { codigo: 'coordinador', etiqueta: 'Coordinadores' },
  { codigo: 'administrador', etiqueta: 'Rector' },
  { codigo: 'superadmin', etiqueta: 'Superadmin' },
];

const mensajeDe = (e: unknown, porDefecto: string) =>
  (e as { error?: { message?: string } })?.error?.message ?? porDefecto;

const nombreCompleto = (u: UsuarioLista) => `${u.nombres} ${u.apellidos}`.trim();

export function AsignarRolScreen({ embedded = false }: { embedded?: boolean }) {
  const { sesion } = useSession();
  const yo = sesion?.usuario;
  const puedeVer = puedeVerRoles(yo?.rol) || yo?.rol === 'tutor';
  const puedeAsignar = puedeAsignarRoles(yo?.rol);

  const [q, setQ] = useState('');
  const [filtroRol, setFiltroRol] = useState<Rol | null>(null);
  const [usuarios, setUsuarios] = useState<UsuarioLista[]>([]);
  const [total, setTotal] = useState(0);
  const [hayMas, setHayMas] = useState(false);
  // La consulta en curso; cada cambio sube `n`. "Cargando" = la última consulta aún no responde.
  const [consulta, setConsulta] = useState<Consulta>({ q: '', rol: null, pagina: 1, n: 0 });
  const [resuelta, setResuelta] = useState(-1);
  const [errorCarga, setErrorCarga] = useState<{ n: number; mensaje: string } | null>(null);
  const cargando = resuelta !== consulta.n;

  const [roles, setRoles] = useState<RolCatalogo[]>([]);
  const [seleccionado, setSeleccionado] = useState<UsuarioLista | null>(null);
  const [nuevoRol, setNuevoRol] = useState<Rol | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [confirmacion, setConfirmacion] = useState<string | null>(null);

  useEffect(() => {
    if (!puedeVer) return;
    let vigente = true; // ignora respuestas de consultas que ya fueron reemplazadas
    listarUsuarios({ q: consulta.q, rol: consulta.rol, page: consulta.pagina })
      .then((r) => {
        if (!vigente) return;
        setUsuarios((previos) => (consulta.pagina === 1 ? r.results : [...previos, ...r.results]));
        setTotal(r.count);
        setHayMas(r.next !== null);
        setResuelta(consulta.n);
      })
      .catch((e) => {
        if (!vigente) return;
        // Una búsqueda nueva que falla no deja a la vista resultados de la anterior.
        if (consulta.pagina === 1) {
          setUsuarios([]);
          setTotal(0);
          setHayMas(false);
        }
        setErrorCarga({
          n: consulta.n,
          mensaje: mensajeDe(
            e,
            'No pudimos cargar los usuarios. Revisa tu conexión e inténtalo de nuevo.',
          ),
        });
        setResuelta(consulta.n);
      });
    return () => {
      vigente = false;
    };
  }, [consulta, puedeVer]);

  useEffect(() => {
    if (!puedeVer || !puedeAsignar) return;
    listarRoles()
      .then(setRoles)
      .catch(() => undefined);
  }, [puedeVer, puedeAsignar]);

  useEffect(() => {
    const termino = q.trim();
    if (termino.length < 2) return;

    const temporizador = setTimeout(() => {
      setConsulta((actual) => ({
        q: termino,
        rol: filtroRol,
        pagina: 1,
        n: actual.n + 1,
      }));
    }, 250);
    return () => clearTimeout(temporizador);
  }, [filtroRol, q]);

  const nuevaConsulta = (cambios: Partial<Consulta>) =>
    setConsulta((c) => ({ ...c, pagina: 1, ...cambios, n: c.n + 1 }));

  const buscar = () => nuevaConsulta({ q, rol: filtroRol });

  const elegirFiltro = (rol: Rol | null) => {
    setFiltroRol(rol);
    nuevaConsulta({ q, rol });
  };

  const elegirUsuario = (u: UsuarioLista) => {
    /* istanbul ignore next -- las filas están deshabilitadas sin permiso; el servidor vuelve a validar */
    if (!puedeAsignar) return;
    setSeleccionado(u);
    setNuevoRol(u.rol);
    setErrorGuardar(null);
    setConfirmacion(null);
  };

  const guardar = async () => {
    /* istanbul ignore next -- el botón está deshabilitado sin un rol distinto elegido */
    if (!seleccionado || !nuevoRol || nuevoRol === seleccionado.rol) return;
    setGuardando(true);
    setErrorGuardar(null);
    try {
      const r = await asignarRol(seleccionado.id, nuevoRol);
      setUsuarios((previos) =>
        previos.map((u) =>
          u.id === seleccionado.id ? { ...u, rol: r.rol, rol_nombre: r.rol_nombre } : u,
        ),
      );
      setConfirmacion(`${nombreCompleto(seleccionado)} ahora es ${r.rol_nombre}.`);
      setSeleccionado(null);
    } catch (e) {
      setErrorGuardar(
        mensajeDe(e, 'No pudimos guardar el rol. Revisa tu conexión e inténtalo de nuevo.'),
      );
    } finally {
      setGuardando(false);
    }
  };

  if (!puedeVer) {
    return (
      <EmbeddedScreenFrame embedded={embedded}>
        <Text style={styles.title}>Sin acceso</Text>
        <Text accessibilityRole="alert" style={styles.error}>
          No tienes permiso para gestionar roles.
        </Text>
      </EmbeddedScreenFrame>
    );
  }

  const mensajeError = errorCarga?.n === consulta.n ? errorCarga.mensaje : null;
  const consultaActual = consulta.q === q.trim() && consulta.rol === filtroRol;
  const esYo = seleccionado !== null && seleccionado.id === yo?.id;
  const resultadosDesplegables =
    q.trim().length >= 2 ? (
      <View style={styles.sugerencias}>
        <Text style={styles.sugerenciasTitulo}>Usuarios encontrados</Text>
        <ScrollView
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          style={styles.listaSugerencias}
        >
          {!mensajeError && (!consultaActual || cargando) ? (
            <Text style={styles.nota}>Buscando usuarios…</Text>
          ) : null}
          {mensajeError && consultaActual ? (
            <>
              <Text accessibilityRole="alert" style={styles.error}>
                {mensajeError}
              </Text>
              <Button
                title="Reintentar"
                onPress={() => nuevaConsulta({ q: q.trim(), rol: filtroRol })}
                variant="link"
              />
            </>
          ) : null}
          {!mensajeError && consultaActual && !cargando && usuarios.length === 0 ? (
            <Text style={styles.nota}>No encontramos usuarios con ese filtro.</Text>
          ) : null}
          {consultaActual &&
            usuarios.map((u) => (
              <Pressable
                key={u.id}
                accessibilityRole="button"
                accessibilityLabel={`${nombreCompleto(u)}, ${u.rol_nombre}`}
                disabled={!puedeAsignar}
                onPress={() => elegirUsuario(u)}
                style={styles.sugerencia}
              >
                <Text style={styles.filaNombre}>
                  {nombreCompleto(u)}
                  {u.is_active ? '' : ' (inactivo)'}
                </Text>
                <Text style={styles.nota}>{u.email}</Text>
                <Text style={styles.rolEtiqueta}>{u.rol_nombre}</Text>
              </Pressable>
            ))}
        </ScrollView>
      </View>
    ) : null;

  return (
    <EmbeddedScreenFrame embedded={embedded}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Usuarios</Text>
        {yo?.rol === 'tutor' ? (
          <Text style={styles.nota}>Estudiantes con planes de tutoría asignados a ti.</Text>
        ) : !puedeAsignar ? (
          <Text style={styles.nota}>Solo lectura: únicamente rectoría puede cambiar roles.</Text>
        ) : null}

        <TextField
          label="Buscar por nombre o correo"
          value={q}
          onChangeText={(texto) => {
            setQ(texto);
            if (texto.trim().length < 2) nuevaConsulta({ q: texto.trim(), rol: filtroRol });
          }}
          onSubmitEditing={buscar}
          returnKeyType="search"
          autoCapitalize="none"
        />
        {resultadosDesplegables}
        <Button title="Buscar" onPress={buscar} variant="link" />

        {yo?.rol !== 'tutor' ? (
          <View style={styles.chips}>
            {FILTROS_ROL.filter((f) => f.codigo !== 'superadmin' || esSuperadmin(yo?.rol)).map(
              (f) => (
                <Chip
                  key={f.codigo ?? 'todos'}
                  label={f.etiqueta}
                  selected={filtroRol === f.codigo}
                  onPress={() => elegirFiltro(f.codigo)}
                />
              ),
            )}
          </View>
        ) : null}

        {confirmacion ? (
          <Text accessibilityRole="alert" style={styles.exito}>
            {confirmacion}
          </Text>
        ) : null}

        {seleccionado ? (
          <FormModal
            visible={seleccionado !== null}
            onClose={() => !guardando && setSeleccionado(null)}
          >
            <View style={styles.panel}>
              <Text style={styles.panelTitulo}>Asignar rol a {nombreCompleto(seleccionado)}</Text>
              <Text style={styles.nota}>{seleccionado.email}</Text>
              {esYo ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  No puedes cambiar tu propio rol. Pídeselo a otro administrador.
                </Text>
              ) : (
                <>
                  {roles
                    .filter((r) => r.codigo !== 'superadmin' || esSuperadmin(yo?.rol))
                    .map((r) => {
                      const activo = nuevoRol === r.codigo;
                      return (
                        <Pressable
                          key={r.codigo}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: activo }}
                          accessibilityLabel={r.nombre}
                          onPress={() => setNuevoRol(r.codigo)}
                          style={[styles.opcion, activo && styles.opcionActiva]}
                        >
                          <Text style={styles.opcionNombre}>{r.nombre}</Text>
                          <Text style={styles.nota}>{r.descripcion}</Text>
                        </Pressable>
                      );
                    })}
                  {errorGuardar ? (
                    <Text accessibilityRole="alert" style={styles.error}>
                      {errorGuardar}
                    </Text>
                  ) : null}
                  <Button
                    title="Guardar rol"
                    onPress={guardar}
                    loading={guardando}
                    disabled={nuevoRol === seleccionado.rol}
                  />
                </>
              )}
              <Button title="Cancelar" onPress={() => setSeleccionado(null)} variant="link" />
            </View>
          </FormModal>
        ) : null}

        {mensajeError && q.trim().length < 2 ? (
          <>
            <Text accessibilityRole="alert" style={styles.error}>
              {mensajeError}
            </Text>
            <Button
              title="Reintentar"
              onPress={() => nuevaConsulta({ pagina: consulta.pagina })}
              variant="link"
            />
          </>
        ) : null}

        {q.trim().length < 2 && !mensajeError && !cargando && usuarios.length === 0 ? (
          <Text style={styles.nota}>No encontramos usuarios con ese filtro.</Text>
        ) : null}
        {q.trim().length < 2 && total > 0 ? (
          <Text style={styles.nota}>
            {total} {total === 1 ? 'usuario' : 'usuarios'}
          </Text>
        ) : null}

        {q.trim().length < 2 &&
          usuarios.map((u) => (
            <Pressable
              key={u.id}
              accessibilityRole="button"
              accessibilityLabel={`${nombreCompleto(u)}, ${u.rol_nombre}`}
              disabled={!puedeAsignar}
              onPress={() => elegirUsuario(u)}
              style={styles.fila}
            >
              <View style={styles.filaTexto}>
                <Text style={styles.filaNombre}>
                  {nombreCompleto(u)}
                  {u.is_active ? '' : ' (inactivo)'}
                </Text>
                <Text style={styles.nota}>{u.email}</Text>
              </View>
              <Text style={styles.rolEtiqueta}>{u.rol_nombre}</Text>
            </Pressable>
          ))}

        {q.trim().length < 2 && hayMas ? (
          <Button
            title="Cargar más"
            onPress={() => setConsulta((c) => ({ ...c, pagina: c.pagina + 1, n: c.n + 1 }))}
            loading={cargando}
            variant="link"
          />
        ) : null}
      </ScrollView>
    </EmbeddedScreenFrame>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text, marginBottom: spacing.md },
  nota: { ...typography.body, color: colors.textMuted, marginBottom: spacing.sm },
  error: { ...typography.body, color: colors.error, marginBottom: spacing.md },
  exito: { ...typography.body, color: colors.success, marginBottom: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm },
  sugerencias: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  sugerenciasTitulo: {
    ...typography.body,
    color: colors.textMuted,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  listaSugerencias: { maxHeight: 280 },
  sugerencia: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  panelTitulo: { ...typography.subtitle, color: colors.text, marginBottom: spacing.xs },
  opcion: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm + 2,
    marginBottom: spacing.sm,
  },
  opcionActiva: { borderColor: colors.primary, backgroundColor: '#EEF2FB' },
  opcionNombre: { ...typography.subtitle, color: colors.text },
  fila: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  filaTexto: { flex: 1, minWidth: 0, marginRight: spacing.sm },
  filaNombre: { ...typography.subtitle, color: colors.text },
  rolEtiqueta: { ...typography.body, color: colors.primary, fontWeight: '600' },
});
