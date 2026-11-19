import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BlindajeGate } from '@/components/BlindajeGate';
import { InactividadGate } from '@/components/InactividadGate';
import { PrivacidadGate } from '@/components/PrivacidadGate';
import { RootNavigator } from '@/navigation/RootNavigator';
import { SessionProvider } from '@/store/session';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {/* En ventana privada no se monta nada de lo demás: ni sesión ni peticiones. */}
      <PrivacidadGate>
        <SessionProvider>
          <BlindajeGate>
            <InactividadGate>
              <RootNavigator />
            </InactividadGate>
          </BlindajeGate>
        </SessionProvider>
      </PrivacidadGate>
    </SafeAreaProvider>
  );
}
