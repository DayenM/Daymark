import type { FontFamily, Theme } from "../types";
import { Icon, type IconName } from "./Icon";
import { themeLooks } from "../themes";

const options: { value: Theme; title: string; description: string; icon: IconName }[] = [
  { value: "glass_light", title: "Glass terang", description: "Lembut dan bercahaya", icon: "sun" },
  { value: "glass_dark", title: "Glass gelap", description: "Hitam pekat berlapis kaca", icon: "moon" },
  { value: "neumorphic", title: "Neumorphic", description: "Permukaan tactile", icon: "layers" },
  { value: "sakura_milk", title: "Sakura Milk", description: "Pink sakura & krem susu", icon: "spark" },
  { value: "peach_matcha", title: "Peach Matcha", description: "Peach hangat & matcha", icon: "sun" },
  { value: "cherry_cola", title: "Cherry Cola", description: "Cherry gelap & pink neon", icon: "spark" },
  { value: "midnight_ocean", title: "Midnight Ocean", description: "Navy pekat & biru es", icon: "moon" },
];

const fonts: { value: FontFamily; label: string; source: string }[] = [
  { value: "plus-jakarta-sans", label: "Plus Jakarta Sans", source: "Terpasang lokal" },
  { value: "geist", label: "Geist", source: "Terpasang lokal" },
  { value: "inter", label: "Inter", source: "Terpasang lokal" },
  { value: "atkinson-hyperlegible-next", label: "Atkinson Hyperlegible Next", source: "Terpasang lokal" },
  { value: "segoe-ui", label: "Segoe UI", source: "Font sistem" },
  { value: "aptos", label: "Aptos", source: "Font sistem" },
  { value: "arial", label: "Arial", source: "Font sistem" },
];

export function AppearancePicker({ theme, fontFamily = "segoe-ui", transparency, onTheme, onFontFamily, onTransparency, compact = false }: {
  theme: Theme;
  fontFamily?: FontFamily;
  transparency: number;
  onTheme: (theme: Theme) => void;
  onFontFamily?: (fontFamily: FontFamily) => void;
  onTransparency: (percent: number) => void;
  compact?: boolean;
}) {
  return (
    <div className={`appearance-picker${compact ? " appearance-picker-compact" : ""}`}>
      <div className="theme-options" role="group" aria-label="Pilih tema Daymark">
        {options.map(option => <button key={option.value} type="button" className={`theme-option theme-look-${themeLooks[option.value].look}${theme === option.value ? " selected" : ""}`} aria-pressed={theme === option.value} onClick={() => onTheme(option.value)}>
          <span className="theme-swatch" data-palette={themeLooks[option.value].palette}><i /><i /><i /><Icon name={option.icon} size={17} className="theme-preview-icon" /></span>
          <strong>{option.title}</strong>
          <span className="theme-description">{option.description}</span>
          {theme === option.value && <span className="theme-selected"><Icon name="check" size={12} /> Aktif</span>}
        </button>)}
      </div>
      {!compact && <label className="font-family-picker">
        <span className="font-family-copy"><span className="font-family-sample" aria-hidden="true">Aa</span><span><strong>Font Daymark</strong><small>Dipakai di seluruh Daymark; font sistem mengikuti ketersediaan Windows</small></span></span>
        <select className="font-family-select" aria-label="Pilih font Daymark" value={fontFamily} onChange={event => onFontFamily?.(event.target.value as FontFamily)}>
          {fonts.map(font => <option key={font.value} value={font.value}>{font.label} · {font.source}</option>)}
        </select>
      </label>}
      <label className="appearance-opacity">
        <span className="appearance-opacity-copy">
          <span className="appearance-opacity-icon"><Icon name="eye" size={16} /></span>
          <span><strong>Transparansi panel Hari Ini</strong><small>0% paling pekat · 40% lebih bening</small></span>
          <output>{transparency}%</output>
        </span>
        <input type="range" min="0" max="40" step="1" value={transparency} aria-label="Transparansi panel Hari Ini" onChange={event => onTransparency(Number(event.target.value))} />
      </label>
    </div>
  );
}
