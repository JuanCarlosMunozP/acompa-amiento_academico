import { ReactNode, useEffect } from 'react';
import { Platform } from 'react-native';

import { useSession } from '@/store/session';
import { activarBlindaje, BLINDAJE_ACTIVO } from '@/utils/blindaje';

type Props = { children: ReactNode; activo?: boolean };

/** Activa el endurecimiento contra la consola del navegador (solo web y en producción). */
export function BlindajeGate({
  children,
  activo = Platform.OS === 'web' && BLINDAJE_ACTIVO,
}: Props) {
  const { cerrar } = useSession();

  useEffect(() => {
    if (!activo) return;
    return activarBlindaje({ alDetectarHerramientas: () => void cerrar('seguridad') });
  }, [activo, cerrar]);

  return <>{children}</>;
}
