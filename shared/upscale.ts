/** One contract for the UI, standalone server, and serverless functions. */
export const SUPPORTED_SCALES = [2, 4, 8] as const;
export const SUPPORTED_FORMATS = ['png', 'jpg', 'webp'] as const;
export const SUPPORTED_PRESETS = ['photo', 'digital_art', 'anime', 'document', 'pixel_art', 'custom'] as const;
export const SUPPORTED_ENGINES = ['classic', 'realesrgan'] as const;
export const MAX_INPUT_BYTES = 4 * 1024 * 1024;
export const MAX_INPUT_PIXELS = 40_000_000;
export const MAX_OUTPUT_DIMENSION = 12_000;
export const MAX_OUTPUT_PIXELS = 64_000_000;
export const MAX_BATCH_SIZE = 20;
export const MAX_BROWSER_BYTES = 160 * 1024 * 1024;

export type ScaleFactor = typeof SUPPORTED_SCALES[number];
export type ExportFormat = typeof SUPPORTED_FORMATS[number];
export type UpscalePreset = typeof SUPPORTED_PRESETS[number];
export type UpscaleEngine = typeof SUPPORTED_ENGINES[number];
export interface UpscaleOptions {
  scale: number;
  engine?: UpscaleEngine;
  preset?: UpscalePreset;
  sharpness?: number;
  denoise?: number;
  detailBoost?: number;
  contrast?: number;
  brightness?: number;
  saturation?: number;
  format?: ExportFormat;
  quality?: number;
}
export interface UpscaleSettings extends Required<UpscaleOptions> { scale: ScaleFactor }

// Faithful by default. Smoothing and extra sharpening are deliberate, opt-in edits.
export const PRESET_DEFAULTS = {
  photo: { sharpness: 0, denoise: 0, detailBoost: 0 },
  digital_art: { sharpness: 0, denoise: 0, detailBoost: 0 },
  anime: { sharpness: 0, denoise: 0, detailBoost: 0 },
  document: { sharpness: 15, denoise: 0, detailBoost: 0 },
  pixel_art: { sharpness: 0, denoise: 0, detailBoost: 0 },
  custom: { sharpness: 0, denoise: 0, detailBoost: 0 },
} satisfies Record<UpscalePreset, Pick<UpscaleSettings, 'sharpness' | 'denoise' | 'detailBoost'>>;

export const DEFAULT_SETTINGS: UpscaleSettings = {
  scale: 2, engine: 'classic', preset: 'photo', ...PRESET_DEFAULTS.photo,
  contrast: 0, brightness: 0, saturation: 0, format: 'webp', quality: 95,
};

export function outputLimitMessage(width: number, height: number, scale: number): string | null {
  const w = width * scale, h = height * scale;
  if (w > MAX_OUTPUT_DIMENSION || h > MAX_OUTPUT_DIMENSION || w * h > MAX_OUTPUT_PIXELS) {
    return `${w.toLocaleString('en')} × ${h.toLocaleString('en')} is too large. Choose a smaller scale (max 12,000 px / 64 MP).`;
  }
  return null;
}

export function withPreset(settings: UpscaleSettings, preset: UpscalePreset): UpscaleSettings {
  return {
    ...settings,
    preset,
    format: 'webp',
    quality: preset === 'pixel_art' || preset === 'document' ? 100 : 95,
    ...PRESET_DEFAULTS[preset],
    ...(preset === 'pixel_art' || preset === 'document' ? { engine: 'classic' as const } : {}),
    contrast: 0,
    brightness: 0,
    saturation: 0,
  };
}

export function sameSettings(a: UpscaleSettings, b: UpscaleSettings): boolean {
  return (
    a.scale === b.scale &&
    a.engine === b.engine &&
    a.preset === b.preset &&
    a.format === b.format &&
    a.quality === b.quality &&
    a.sharpness === b.sharpness &&
    a.denoise === b.denoise &&
    a.detailBoost === b.detailBoost &&
    a.contrast === b.contrast &&
    a.brightness === b.brightness &&
    a.saturation === b.saturation
  );
}
