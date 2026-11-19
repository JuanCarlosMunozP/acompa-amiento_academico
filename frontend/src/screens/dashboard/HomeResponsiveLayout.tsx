/** Ajusta la distribución del contenido de inicio al espacio disponible. */
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { colors, institution, radius, spacing, typography } from '@/theme';

export type HomeNavigationLink = {
  label: string;
  active?: boolean;
  onPress: () => void;
};

type Props = {
  links: HomeNavigationLink[];
  onLogout: () => void;
  children: React.ReactNode;
};

export function HomeResponsiveLayout({ links, onLogout, children }: Props) {
  const { width } = useWindowDimensions();
  const mobile = width <= 768;

  return (
    <>
      <View style={styles.header}>
        <Text style={styles.title}>{institution.appName}</Text>
      </View>
      <View style={[styles.layout, mobile && styles.mobileLayout]}>
        <View style={[styles.sidebar, mobile && styles.mobileSidebar]}>
          <ScrollView style={styles.sidebarScroll} contentContainerStyle={styles.sidebarItems}>
            {links.map((link) => (
              <Pressable
                key={link.label}
                accessibilityRole="button"
                accessibilityState={{ selected: Boolean(link.active) }}
                onPress={link.onPress}
                style={[styles.link, link.active && styles.linkActive]}
              >
                <Text style={styles.linkText}>{link.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable accessibilityRole="button" onPress={onLogout} style={styles.logout}>
            <Text style={styles.logoutText}>Cerrar sesión</Text>
          </Pressable>
        </View>
        <View style={styles.content}>{children}</View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.navegacion,
    marginHorizontal: -spacing.md,
    marginTop: -spacing.md,
    paddingHorizontal: spacing.md,
  },
  title: { ...typography.subtitle, color: colors.primaryText, fontWeight: '700' },
  layout: { flex: 1, flexDirection: 'row', alignItems: 'stretch', minHeight: 0 },
  mobileLayout: { position: 'relative' },
  sidebar: {
    width: 250,
    flexShrink: 0,
    alignSelf: 'stretch',
    minHeight: 0,
    flexDirection: 'column',
    backgroundColor: colors.navegacion,
    marginTop: 0,
    marginLeft: -spacing.md,
    marginRight: spacing.md,
    marginBottom: -spacing.md,
    padding: spacing.sm,
  },
  mobileSidebar: {
    width: '28%',
    minWidth: 88,
    maxWidth: 300,
  },
  sidebarScroll: { flex: 1, minHeight: 0 },
  sidebarItems: { gap: spacing.xs, alignItems: 'stretch' },
  link: {
    width: '100%',
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
  },
  linkActive: { backgroundColor: 'rgba(255,255,255,0.18)' },
  linkText: {
    ...typography.body,
    color: colors.primaryText,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'center',
  },
  logout: {
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderTopColor: 'rgba(255,255,255,0.2)',
    borderTopWidth: 1,
  },
  logoutText: { ...typography.body, color: colors.secondary, fontWeight: '700' },
  content: { flex: 1, minWidth: 0 },
});
