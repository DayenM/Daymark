import type { Theme } from "./types";

type Look = "light" | "dark" | "neu";

// Palette values live in styles.css under [data-palette]; this only maps a theme to its look + palette.
export const themeLooks: Record<Theme, { look: Look; palette: string }> = {
  glass_light: { look: "light", palette: "mono" },
  glass_dark: { look: "dark", palette: "mono_dark" },
  neumorphic: { look: "neu", palette: "mono" },
  sakura_milk: { look: "light", palette: "sakura_milk" },
  peach_matcha: { look: "light", palette: "peach_matcha" },
  cherry_cola: { look: "dark", palette: "cherry_cola" },
  midnight_ocean: { look: "dark", palette: "midnight_ocean" },
};

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const { look, palette } = themeLooks[theme] ?? themeLooks.glass_dark;
  root.dataset.theme = look === "neu" ? "neumorphism" : "glassmorphism";
  root.dataset.glassVariant = look === "neu" ? "" : look;
  root.dataset.palette = palette;
}

// Same curve for the workspace and the Today panel so cards fade together with the window surface.
export function applyGlassAlpha(percent: number, theme: Theme | undefined) {
  const level = theme === "neumorphic" ? 0 : percent / 40;
  const style = document.documentElement.style;
  // At 40% every surface (cards, inputs, secondary buttons) is mostly see-through; Acrylic keeps text legible.
  style.setProperty("--glass-surface-alpha", String(.94 - level * .66));
  style.setProperty("--glass-content-alpha", String(.98 - level * .64));
  style.setProperty("--glass-secondary-alpha", String(.88 - level * .58));
  return level;
}
