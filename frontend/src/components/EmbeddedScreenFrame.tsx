import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Screen } from '@/components/Screen';

export function EmbeddedScreenFrame({
  embedded,
  children,
}: {
  embedded: boolean;
  children: ReactNode;
}) {
  return embedded ? <View style={{ flex: 1 }}>{children}</View> : <Screen>{children}</Screen>;
}
