import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';

import App from './src/App';
import { silenciarRegistrosNativos } from './src/utils/blindaje';

// En el APK instalado no se escribe nada en logcat (la versión web tiene su propio blindaje).
if (!__DEV__ && Platform.OS !== 'web') silenciarRegistrosNativos();

registerRootComponent(App);
