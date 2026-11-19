import { useEffect, useState } from 'react';

import { mensajeDe } from '@/utils/errores';

type Estado<T> = { intento: number; datos?: T; error?: string };

/**
 * Carga datos de la API con estados de «cargando», error y reintento.
 *
 * - `cargando` es verdadero hasta que responde la última petición (derivado, sin estado extra).
 * - Una respuesta de una petición ya reemplazada (nuevo `recargar` o cambio de `dependencias`)
 *   se descarta.
 * - `actualizar` cambia los datos en memoria (p. ej. tras crear un elemento) sin volver a pedir.
 */
export function useCarga<T>(
  cargar: () => Promise<T>,
  {
    habilitado = true,
    dependencias = [] as unknown[],
    error: textoError = 'No pudimos cargar los datos.',
  } = {},
) {
  const [intento, setIntento] = useState(0);
  const [estado, setEstado] = useState<Estado<T> | null>(null);

  useEffect(() => {
    if (!habilitado) return;
    let vigente = true;
    cargar()
      .then((datos) => vigente && setEstado({ intento, datos }))
      .catch((e) => vigente && setEstado({ intento, error: mensajeDe(e, textoError) }));
    return () => {
      vigente = false;
    };
    // `cargar` se vuelve a crear en cada render: el efecto depende de lo que realmente la cambia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habilitado, intento, ...dependencias]);

  const vigente = estado?.intento === intento;
  return {
    datos: vigente ? estado?.datos : undefined,
    error: vigente ? estado?.error : undefined,
    cargando: habilitado && !vigente,
    recargar: () => setIntento((n) => n + 1),
    actualizar: (cambio: (datos: T) => T) =>
      setEstado((previo) =>
        previo?.datos !== undefined ? { ...previo, datos: cambio(previo.datos) } : previo,
      ),
  };
}
