/** WCAG relative-luminance contrast of white text on a hex colour. Preview only; the API enforces 4.5:1. */
export function contrastWithWhite(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const v = parseInt(m[1], 16);
  const ch = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * ch((v >> 16) & 255) + 0.7152 * ch((v >> 8) & 255) + 0.0722 * ch(v & 255);
  return 1.05 / (l + 0.05);
}

export const BRAND_PRESETS = [
  ["Indigo", "#4f46e5"],
  ["Royal", "#6d28d9"],
  ["Rani", "#be185d"],
  ["Maroon", "#9f1239"],
  ["Saffron", "#c2410c"],
  ["Mustard", "#a16207"],
  ["Emerald", "#047857"],
  ["Teal", "#0f766e"],
  ["Ocean", "#0369a1"],
  ["Charcoal", "#334155"],
] as const;
