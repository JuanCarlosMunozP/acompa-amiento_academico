import { createNavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList } from './RootNavigator';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * Deja solo la pantalla de inicio de sesión, sin historial: al cerrar la sesión (a propósito, por
 * inactividad o por seguridad) no se puede volver atrás a pantallas privadas ni a un inicio vacío.
 */
export function irAlLogin() {
  if (navigationRef.isReady()) {
    navigationRef.resetRoot({ index: 0, routes: [{ name: 'Login' }] });
  }
}
