import type { ThemeName } from "./types";

/**
 * UI tokens as resolved values, for places CSS variables cannot reach
 * (canvas export, SVG gradients). Must stay in sync with app/globals.css.
 */
export interface UiTokens {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentContrast: string;
  accentSoft: string;
}

export const UI_TOKENS: Record<ThemeName, UiTokens> = {
  light: {
    bg: "#F6F6F2",
    surface: "#FFFFFF",
    surface2: "#EFEFEA",
    border: "#E2E2DB",
    borderStrong: "#CFCFC6",
    text: "#121514",
    textMuted: "#5A615E",
    textFaint: "#8A908D",
    accent: "#0A7F71",
    accentContrast: "#FFFFFF",
    accentSoft: "#DDF3EE",
  },
  dark: {
    bg: "#0A0D0C",
    surface: "#111514",
    surface2: "#181D1B",
    border: "#232A27",
    borderStrong: "#323B37",
    text: "#ECF0EE",
    textMuted: "#9AA3A0",
    textFaint: "#6B7471",
    accent: "#45E0C8",
    accentContrast: "#04211D",
    accentSoft: "#0F2B27",
  },
};

export const THEME_STORAGE_KEY = "flume-theme";
