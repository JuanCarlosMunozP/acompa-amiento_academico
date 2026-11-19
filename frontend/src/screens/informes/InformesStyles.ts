/** Define estilos compartidos por las vistas y componentes de informes. */
import { StyleSheet } from 'react-native';

import { colors, radius, spacing, typography } from '@/theme';

export const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs },
  section: {
    ...typography.subtitle,
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  informeCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  informeTitle: { ...typography.subtitle, color: colors.text, marginBottom: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  searchButton: { alignSelf: 'flex-start', maxWidth: '100%' },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  indicador: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 135,
    minWidth: 0,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  indicadorAlerta: { borderColor: colors.error },
  indicadorValor: { ...typography.title, color: colors.primary },
  indicadorLabel: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs },
  row: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  rowTitle: { ...typography.subtitle, color: colors.text, fontWeight: '700' },
  rowText: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs },
});
