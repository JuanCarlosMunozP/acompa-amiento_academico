import { StyleSheet, Switch, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/theme';

type Props = {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
};

export function SwitchField({ label, value, onValueChange, disabled }: Props) {
  return (
    <View style={styles.fila}>
      <Text style={styles.label}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: colors.primary }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  label: { ...typography.body, color: colors.text, flex: 1, marginRight: spacing.md },
});
