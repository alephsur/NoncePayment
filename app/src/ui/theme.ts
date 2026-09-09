export const theme = {
  bg: '#0B0B0F',
  surface: '#16161D',
  surfaceAlt: '#1F1F29',
  border: '#2A2A36',
  text: '#F5F5F7',
  textMuted: '#8A8A99',
  accent: '#14F195',   // verde Solana
  accentAlt: '#9945FF', // morado Solana
  danger: '#FF5C5C',
  warning: '#FFB020',
} as const;

export const spacing = (n: number) => n * 8;
