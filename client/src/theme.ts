import { createTheme, responsiveFontSizes, alpha } from '@mui/material/styles';
import type { PaletteMode } from '@mui/material';

// Approche "Fuse-like" simplifiée : couleurs vives, surfaces neutres, contrastes soignés,
// arrondis modérés, boutons sans capitalisation et quelques overrides cohérents.

declare module '@mui/material/styles' {
  interface Theme {
    customShadows: { subtle: string; lifted: string; inset: string };
  }
  interface ThemeOptions {
    customShadows?: { subtle?: string; lifted?: string; inset?: string };
  }
}

const commonTypography: any = {
  fontFamily: 'Inter, system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif',
  h1: { fontWeight: 600, letterSpacing: '-0.015em' },
  h2: { fontWeight: 600, letterSpacing: '-0.01em' },
  h3: { fontWeight: 600, letterSpacing: '-0.01em' },
  h4: { fontWeight: 600 },
  h5: { fontWeight: 600 },
  h6: { fontWeight: 600 },
  button: { textTransform: 'none' as const, fontWeight: 600 }
};

const fusePrimary = {
  light: '#818CF8',
  main: '#6366F1', // Indigo / brand accent
  dark: '#4F46E5',
  contrastText: '#FFFFFF'
};
const fuseSecondary = {
  light: '#F9A8D4',
  main: '#EC4899',
  dark: '#DB2777',
  contrastText: '#ffffff'
};

const success = { light: '#4ade80', main: '#22c55e', dark: '#16a34a', contrastText: '#fff' };
const warning = { light: '#fbbf24', main: '#f59e0b', dark: '#d97706', contrastText: '#111' };
const error = { light: '#f87171', main: '#ef4444', dark: '#dc2626', contrastText: '#fff' };
const info = { light: '#38bdf8', main: '#0ea5e9', dark: '#0284c7', contrastText: '#fff' };

function createPalette(mode: PaletteMode) {
  if (mode === 'dark') {
    return {
      mode: 'dark' as const,
      primary: fusePrimary,
      secondary: fuseSecondary,
      success, warning, error, info,
      background: { default: '#121418', paper: '#1B1F25' },
      divider: alpha('#FFFFFF', 0.12)
    };
  }
  return {
    mode: 'light' as const,
    primary: fusePrimary,
    secondary: fuseSecondary,
    success, warning, error, info,
    background: { default: '#F7F8FA', paper: '#FFFFFF' },
    divider: alpha('#1F2937', 0.12)
  };
}

const shape = { borderRadius: 12 };

function createComponentOverrides(mode: PaletteMode) {
  const isDark = mode === 'dark';
  return {
    MuiCssBaseline: {
      styleOverrides: {
        'html, body, #root': { height: '100%' },
        body: { WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' },
        '::-webkit-scrollbar': { width: 10, height: 10 },
        '::-webkit-scrollbar-thumb': {
          backgroundColor: alpha(isDark ? '#6366F1' : '#6366F1', 0.35),
          borderRadius: 20,
          border: '2px solid transparent',
          backgroundClip: 'content-box'
        }
      }
    },
    MuiAppBar: {
      styleOverrides: {
        root: ({ theme }: any) => ({
          background: 'transparent', backdropFilter: 'blur(10px)',
          boxShadow: 'none', borderBottom: `1px solid ${alpha(theme.palette.divider, 0.6)}`
        })
      }
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: ({ theme }: any) => ({
          backgroundImage: 'none',
          border: `1px solid ${alpha(theme.palette.divider, 0.9)}`
        })
      }
    },
    MuiCard: {
      styleOverrides: {
        root: ({ theme }: any) => ({
          border: `1px solid ${alpha(theme.palette.divider, 0.7)}`,
          backgroundImage: 'none'
        })
      }
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 20 }
      }
    },
    MuiChip: {
      styleOverrides: {
        root: ({ theme }: any) => ({
          fontWeight: 500,
          '&.MuiChip-colorPrimary': { background: alpha(theme.palette.primary.main, 0.12) }
        })
      }
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: ({ theme }: any) => ({
          borderRadius: 8,
          backgroundColor: alpha(theme.palette.grey[900] || '#111', 0.92)
        })
      }
    },
    MuiInputBase: {
      styleOverrides: {
        root: ({ theme }: any) => ({ borderRadius: 10 })
      }
    },
  MuiTabs: { styleOverrides: { indicator: { height: 3, borderRadius: 3 } } }
  };
}

export function createAppTheme(mode: PaletteMode) {
  const theme = createTheme({
    palette: createPalette(mode),
    shape,
    typography: commonTypography,
    components: createComponentOverrides(mode),
    customShadows: {
      subtle: '0 1px 2px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)',
      lifted: '0 4px 12px rgba(0,0,0,0.12)',
      inset: 'inset 0 1px 2px rgba(0,0,0,0.18)'
    }
  });
  return responsiveFontSizes(theme);
}

// Exports de commodité (si d'autres endroits référencent encore light/dark)
export const lightTheme = createAppTheme('light');
export const darkTheme = createAppTheme('dark');
