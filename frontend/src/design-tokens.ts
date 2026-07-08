// AgentSwarm Design Tokens v2.0
// Dark Tech aesthetic — Linear / Vercel / Raycast inspired

export const colors = {
  // Surface hierarchy (darkest → lightest)
  base: '#09090B',
  surface: '#131316',
  elevated: '#1A1A1F',
  overlay: '#1F1F24',

  // Border hierarchy
  borderSubtle: '#252529',
  borderDefault: '#333338',
  borderStrong: '#44444A',

  // Accent — blue-purple gradient
  accentPrimary: '#6366F1',
  accentSecondary: '#8B5CF6',
  accentGlow: 'rgba(99,102,241,0.3)',

  // Semantic status
  success: '#22C55E',
  successSoft: 'rgba(34,197,94,0.12)',
  warning: '#F59E0B',
  warningSoft: 'rgba(245,158,11,0.12)',
  danger: '#EF4444',
  dangerSoft: 'rgba(239,68,68,0.12)',

  // Text hierarchy
  textPrimary: '#FAFAFA',
  textSecondary: '#A1A1AA',
  textMuted: '#52525B',
  textDisabled: '#3F3F46',
} as const;

export const spacing = {
  base: 4,
} as const;

export const radius = {
  sm: '6px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  full: '9999px',
} as const;

export const shadows = {
  accent: '0 0 30px -10px rgba(99,102,241,0.3)',
  success: '0 0 20px -8px rgba(34,197,94,0.2)',
  danger: '0 0 20px -8px rgba(239,68,68,0.2)',
  elevation: '0 4px 24px rgba(0,0,0,0.4)',
  floating: '0 8px 40px rgba(0,0,0,0.6)',
} as const;

export const easing = {
  cubic: [0.65, 0, 0.35, 1] as const,
  spring: { type: 'spring', stiffness: 300, damping: 25 } as const,
} as const;

export const typography = {
  fontSans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontMono: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
} as const;
