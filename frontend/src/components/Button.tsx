import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors, radius, spacing, typography } from '@/theme';

type Props = {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'link';
  compact?: boolean;
  /** Color de acento; por defecto el primario. */
  color?: string;
};

export function Button({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
  compact = false,
  color = colors.primary,
}: Props) {
  const link = variant === 'link';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: loading || disabled, busy: loading }}
      disabled={loading || disabled}
      onPress={onPress}
      style={[
        styles.base,
        link ? styles.link : [styles.primary, { backgroundColor: color }],
        compact && styles.compact,
        (loading || disabled) && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={link ? color : colors.primaryText} />
      ) : (
        <Text
          style={[
            styles.text,
            link && styles.linkText,
            link && { color },
            compact && styles.compactText,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
  },
  primary: { backgroundColor: colors.primary },
  link: { backgroundColor: 'transparent' },
  compact: { alignSelf: 'flex-start', maxWidth: '100%', paddingHorizontal: spacing.sm },
  compactText: { flexShrink: 1, textAlign: 'center' },
  disabled: { opacity: 0.6 },
  text: { ...typography.subtitle, color: colors.primaryText },
  linkText: { color: colors.primary },
});
