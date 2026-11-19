import crypto from "node:crypto";
import type { FormSettings } from "../schema.js";

/* A form's accent colour, turned into the colour tokens Relay's stylesheet uses.
   The creator picks one colour; Relay adjusts it so text stays readable: darker on the light
   page, lighter on the dark one, with white or ink text on buttons, whichever reads better. */

type RGB = [number, number, number];

const parse = (hex: string): RGB => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
};
const toHex = (c: RGB) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (c: RGB, to: RGB, t: number): RGB => c.map((v, i) => v + (to[i]! - v) * t) as RGB;

function luminance([r, g, b]: RGB): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export const contrast = (a: RGB, b: RGB) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
const INK: RGB = [0x17, 0x19, 0x23];
const LIGHT_BG: RGB = [0xf7, 0xf7, 0xf5];
const DARK_BG: RGB = [0x0f, 0x10, 0x16];

/** Move a colour toward black or white in small steps until it reaches the contrast ratio. */
function readableOn(c: RGB, bg: RGB, ratio: number, toward: RGB): RGB {
  let out = c;
  for (let i = 0; i < 20 && contrast(out, bg) < ratio; i++) out = mix(out, toward, 0.08);
  return out;
}
const textOn = (c: RGB) => (contrast(WHITE, c) >= contrast(INK, c) ? "#FFFFFF" : "#171923");

/** The stylesheet for a form's brand colour, or "" when it has none. */
export function themeCss(settings: FormSettings): string {
  const accent = settings.brand?.accent;
  if (!accent) return "";
  const a = parse(accent);
  const light = readableOn(a, LIGHT_BG, 4.5, BLACK);
  const dark = readableOn(a, DARK_BG, 4.5, WHITE);
  const rgba = (alpha: number) => `rgba(${a.join(", ")}, ${alpha})`;
  return `/* Relay form theme */
:root {
  --accent: ${toHex(a)};
  --primary: ${toHex(light)};
  --primary-hover: ${toHex(mix(light, BLACK, 0.12))};
  --on-primary: ${textOn(light)};
  --accent-soft: ${rgba(0.1)};
  --accent-ring: ${rgba(0.32)};
}
@media (prefers-color-scheme: dark) {
  :root {
    --primary: ${toHex(dark)};
    --primary-hover: ${toHex(mix(dark, WHITE, 0.12))};
    --on-primary: ${textOn(dark)};
    --accent-soft: ${rgba(0.16)};
    --accent-ring: ${rgba(0.45)};
  }
}
`;
}

/** Cache-busting version for a theme, so a changed colour is never served stale. */
export const themeVersion = (css: string) => crypto.createHash("sha256").update(css).digest("hex").slice(0, 10);
