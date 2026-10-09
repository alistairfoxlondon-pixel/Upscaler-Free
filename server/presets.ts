/**
 * Shared constants between the server pipeline and the browser UI.
 * Keep this module dependency-free (no sharp imports) so the client can bundle it.
 */

export const SUPPORTED_SCALES = [2, 4, 8] as const;
export const SUPPORTED_FORMATS = ['jpg', 'png', 'webp'] as const;
export const SUPPORTED_PRESETS = ['auto', 'photo', 'digital_art', 'anime', 'document', 'custom'] as const;

export const MAX_INPUT_BYTES = 4 * 1024 * 1024;
export const MAX_INPUT_PIXELS = 40_000_000;
export const MAX_OUTPUT_DIMENSION = 12_000;
export const MAX_OUTPUT_PIXELS = 64_000_000;
export const MAX_BATCH_SIZE = 20;

export type UpscalePreset = (typeof SUPPORTED_PRESETS)[number];
export type ExportFormat = (typeof SUPPORTED_FORMATS)[number];

/** Enhancement defaults per named preset (tuned via scripts/quality-benchmark.mts). */
export const PRESET_PARAMS: Record<Exclude<UpscalePreset, 'auto'>, { sharpness: number; denoise: number; detailBoost: number }> = {
  photo: { sharpness: 45, denoise: 10, detailBoost: 35 },
  digital_art: { sharpness: 60, denoise: 15, detailBoost: 50 },
  anime: { sharpness: 60, denoise: 25, detailBoost: 50 },
  document: { sharpness: 50, denoise: 5, detailBoost: 40 },
  custom: { sharpness: 45, denoise: 10, detailBoost: 40 },
};

/** What the 'auto' preset resolves to per detected content class. */
export const AUTO_PARAMS: Record<'photo' | 'document' | 'lineart' | 'flat', { sharpness: number; denoise: number; detailBoost: number }> = {
  photo: PRESET_PARAMS.photo,
  document: PRESET_PARAMS.document,
  lineart: { sharpness: 55, denoise: 15, detailBoost: 45 },
  flat: { sharpness: 35, denoise: 5, detailBoost: 30 },
};

/** Human-readable output for the settings UI. */
export const PRESET_LABELS: Record<UpscalePreset, string> = {
  auto: 'Auto',
  photo: 'Photo',
  digital_art: 'Art',
  anime: 'Art',
  document: 'Text',
  custom: 'Custom',
};

/**
 * Client-side pre-flight check mirroring the server limits so users see the
 * problem before a request is wasted.
 */
export function checkOutputLimits(
  width: number | undefined,
  height: number | undefined,
  scale: number
): { ok: boolean; message?: string } {
  if (!width || !height) return { ok: true };
  const outW = Math.round(width * scale);
  const outH = Math.round(height * scale);
  if (outW > MAX_OUTPUT_DIMENSION || outH > MAX_OUTPUT_DIMENSION) {
    return { ok: false, message: `Output would be ${outW}×${outH}px — over the ${MAX_OUTPUT_DIMENSION.toLocaleString()} px per-side limit. Try ${scale === 8 ? '4×' : '2×'}.` };
  }
  if (outW * outH > MAX_OUTPUT_PIXELS) {
    return { ok: false, message: `Output would be ${Math.round((outW * outH) / 1_000_000)} MP — over the 64 MP limit. Try ${scale === 8 ? '4×' : '2×'}.` };
  }
  return { ok: true };
}
