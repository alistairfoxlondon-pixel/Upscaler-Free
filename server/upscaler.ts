import sharp, { type Metadata } from 'sharp';
import {
  SUPPORTED_SCALES,
  SUPPORTED_FORMATS,
  SUPPORTED_PRESETS,
  MAX_INPUT_BYTES,
  MAX_INPUT_PIXELS,
  MAX_OUTPUT_DIMENSION,
  MAX_OUTPUT_PIXELS,
  PRESET_PARAMS,
  AUTO_PARAMS,
  type UpscalePreset,
  type ExportFormat,
} from './presets.ts';

export {
  SUPPORTED_SCALES,
  SUPPORTED_FORMATS,
  SUPPORTED_PRESETS,
  MAX_INPUT_BYTES,
  MAX_INPUT_PIXELS,
  MAX_OUTPUT_DIMENSION,
  MAX_OUTPUT_PIXELS,
} from './presets.ts';
export type { UpscalePreset, ExportFormat } from './presets.ts';

/** Profiles larger than this are stripped: they bloat every output for little web benefit. */
const MAX_ICC_BYTES = 512 * 1024;
/** Above this many output pixels the WebP encoder drops to a much faster effort level. */
const WEBP_FAST_EFFORT_PIXELS = 16_000_000;

export type ContentKind = keyof typeof AUTO_PARAMS;

export interface UpscaleOptions {
  scale: number;
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

export interface UpscaleResult {
  buffer: Buffer;
  mimeType: string;
  format: string;
  originalWidth: number;
  originalHeight: number;
  upscaledWidth: number;
  upscaledHeight: number;
  originalSize: number;
  upscaledSize: number;
  processingTimeMs: number;
  /** The preset actually applied ('auto' resolves to a concrete kind). */
  preset: string;
  /** Content class detected for the 'auto' preset (undefined for named presets). */
  contentKind?: ContentKind;
}

/** Error with an HTTP status so API handlers never leak 500s or libvips jargon for client mistakes. */
export class UpscaleError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'UpscaleError';
    this.statusCode = statusCode;
  }
}

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

const round2 = (value: number) => Number(value.toFixed(2));

/**
 * Sharpening curves per content class. Hard-edge content (documents, line art)
 * needs a narrower mask with a tighter overshoot cap, otherwise unsharp masking
 * clips whites/blacks and grows halos; photos tolerate — and benefit from — a
 * wider, stronger mask. Values were chosen by sweeping the 50-image quality
 * benchmark (scripts/quality-benchmark.mts): the photo curve nets measurably
 * sharper than a plain Lanczos resize while the document/lineart curves stay
 * clip-free.
 */
const SHARPEN_PROFILES: Record<ContentKind, {
  base: number; combined: number; denoise: number;
  m1Base: number; m1Detail: number; m2Base: number; m2Sharp: number; y2: number; y3: number;
}> = {
  photo: { base: 0.65, combined: 1.0, denoise: 0.6, m1Base: 0.3, m1Detail: 250, m2Base: 1.6, m2Sharp: 60, y2: 6, y3: 12 },
  lineart: { base: 0.4, combined: 0.7, denoise: 0.5, m1Base: 0.4, m1Detail: 250, m2Base: 1.5, m2Sharp: 80, y2: 5, y3: 10 },
  document: { base: 0.35, combined: 0.6, denoise: 0.4, m1Base: 0.45, m1Detail: 250, m2Base: 1.5, m2Sharp: 80, y2: 5, y3: 10 },
  flat: { base: 0.4, combined: 0.7, denoise: 0.5, m1Base: 0.5, m1Detail: 250, m2Base: 1.4, m2Sharp: 100, y2: 6, y3: 12 },
};

/** Named presets map onto a sharpening profile. */
const PRESET_PROFILE: Record<Exclude<UpscalePreset, 'auto'>, ContentKind> = {
  photo: 'photo',
  digital_art: 'lineart',
  anime: 'lineart',
  document: 'document',
  custom: 'photo',
};

export function normalizeOptions(options: UpscaleOptions): Required<UpscaleOptions> {
  const scale = Number(options.scale);
  if (!SUPPORTED_SCALES.includes(scale as (typeof SUPPORTED_SCALES)[number])) {
    throw new UpscaleError('Scale must be 2, 4, or 8');
  }

  const format = options.format ?? 'png';
  if (!SUPPORTED_FORMATS.includes(format)) throw new UpscaleError('Format must be jpg, png, or webp');

  const preset = SUPPORTED_PRESETS.includes(options.preset as UpscalePreset)
    ? (options.preset as UpscalePreset)
    : 'auto';

  // For 'auto' the real enhancement values are resolved per-image from the
  // detected content class inside processImageUpscale(); these are fallbacks.
  const defaults = preset === 'auto' ? PRESET_PARAMS.photo : PRESET_PARAMS[preset];

  return {
    scale,
    preset,
    sharpness: clamp(options.sharpness, 0, 100, defaults.sharpness),
    denoise: clamp(options.denoise, 0, 100, defaults.denoise),
    detailBoost: clamp(options.detailBoost, 0, 100, defaults.detailBoost),
    contrast: clamp(options.contrast, -50, 50, 0),
    brightness: clamp(options.brightness, -50, 50, 0),
    saturation: clamp(options.saturation, -50, 50, 0),
    format,
    quality: clamp(options.quality, 70, 100, 95),
  };
}

/**
 * Cheap content classification from a small greyscale thumbnail:
 * white/black coverage, tonal spread, and edge density. Deterministic,
 * runs in milliseconds, and only feeds the 'auto' preset.
 */
export async function detectContentKind(input: Buffer): Promise<ContentKind> {
  try {
    const { data, info } = await sharp(input, { sequentialRead: true })
      .rotate()
      .resize(96, 96, { fit: 'inside', kernel: 'lanczos3' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const w = info.width;
    const h = info.height;
    const n = w * h;
    if (n === 0) return 'photo';

    let sum = 0;
    let sumSq = 0;
    let white = 0;
    let black = 0;
    let edges = 0;
    for (let i = 0; i < n; i++) {
      const v = data[i];
      sum += v;
      sumSq += v * v;
      if (v > 240) white++;
      else if (v < 15) black++;
    }
    const mean = sum / n;
    const stdev = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const lap = Math.abs(-4 * data[i] + data[i - 1] + data[i + 1] + data[i - w] + data[i + w]);
        if (lap > 24) edges++;
      }
    }
    const whiteFrac = white / n;
    const blackFrac = black / n;
    const edgeFrac = edges / n;

    // Text on a light or dark page: lots of paper, sparse hard edges.
    if ((whiteFrac > 0.45 || blackFrac > 0.45) && edgeFrac > 0.01) return 'document';
    // Hard, high-contrast edges (illustration, line art, UI screenshots).
    if (edgeFrac > 0.05 && stdev > 35) return 'lineart';
    // Nearly flat graphics (logos, gradients, solid fills).
    if (stdev < 15 && edgeFrac < 0.005) return 'flat';
    return 'photo';
  } catch {
    return 'photo';
  }
}

/**
 * Deterministic cloud enhancement based on libvips via Sharp.
 * This is high-quality resampling, not a generative neural model: it does not invent detail.
 */
export async function processImageUpscale(
  inputBuffer: Buffer,
  rawOptions: UpscaleOptions
): Promise<UpscaleResult> {
  const startTime = Date.now();
  if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length === 0) {
    throw new UpscaleError('Image is empty');
  }
  if (inputBuffer.length > MAX_INPUT_BYTES) {
    throw new UpscaleError('Image exceeds the 4 MB cloud limit');
  }

  const options = normalizeOptions(rawOptions);

  let meta: Metadata;
  try {
    meta = await sharp(inputBuffer, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch (error: any) {
    if (/pixel limit|too large|exceeds/i.test(String(error?.message))) {
      throw new UpscaleError(`Image exceeds the ${Math.round(MAX_INPUT_PIXELS / 1_000_000)} megapixel decode limit`);
    }
    throw new UpscaleError('The image could not be decoded. It may be corrupt, truncated, or an unsupported format.');
  }

  const supportedInputs = new Set(['jpeg', 'png', 'webp', 'avif', 'tiff', 'gif', 'heif']);
  if (!meta.format || !supportedInputs.has(meta.format) || !meta.width || !meta.height) {
    throw new UpscaleError('Unsupported or unreadable raster image (use JPEG, PNG, WebP, AVIF, TIFF, GIF, or HEIC)');
  }

  const swapped = Boolean(meta.orientation && meta.orientation >= 5 && meta.orientation <= 8);
  const originalWidth = swapped ? meta.height : meta.width;
  const originalHeight = swapped ? meta.width : meta.height;
  const targetWidth = Math.round(originalWidth * options.scale);
  const targetHeight = Math.round(originalHeight * options.scale);

  if (
    targetWidth > MAX_OUTPUT_DIMENSION ||
    targetHeight > MAX_OUTPUT_DIMENSION ||
    targetWidth * targetHeight > MAX_OUTPUT_PIXELS
  ) {
    throw new UpscaleError(
      `Requested output ${targetWidth}×${targetHeight} exceeds the 12,000 px / 64 MP safety limit`
    );
  }

  // Resolve the 'auto' preset from the actual image content.
  let contentKind: UpscaleResult['contentKind'];
  let resolvedPreset: string = options.preset;
  let sharpness = options.sharpness;
  let denoise = options.denoise;
  let detailBoost = options.detailBoost;
  let sharpenProfile: ContentKind = options.preset === 'auto' ? 'photo' : PRESET_PROFILE[options.preset];
  if (options.preset === 'auto') {
    contentKind = await detectContentKind(inputBuffer);
    resolvedPreset = contentKind;
    ({ sharpness, denoise, detailBoost } = AUTO_PARAMS[contentKind]);
    sharpenProfile = contentKind;
  }

  let pipeline = sharp(inputBuffer, {
    failOn: 'error',
    limitInputPixels: MAX_INPUT_PIXELS,
    sequentialRead: true,
  }).rotate();

  // Keep the color profile so wide-gamut photos keep their colors (bounded size).
  if (meta.icc && meta.icc.length > 0 && meta.icc.length <= MAX_ICC_BYTES) {
    pipeline = pipeline.keepIccProfile();
  }

  // Smooth compression artifacts before enlargement. The curve is continuous and
  // starts at the smallest sigma libvips can actually apply (below ~0.6 the 3x3
  // Gaussian kernel rounds to identity, i.e. a silent no-op): every denoise
  // value above 0 now has a real effect.
  if (denoise > 0) {
    pipeline = pipeline.blur(round2(0.6 + (denoise / 100) * 0.45));
  }

  pipeline = pipeline.resize({
    width: targetWidth,
    height: targetHeight,
    kernel: sharp.kernel.lanczos3,
    fit: 'fill',
    fastShrinkOnLoad: false,
  });

  if (sharpness > 0 || detailBoost > 0) {
    // Content-aware unsharp masking: sigma grows with the combined strength and
    // with denoise (so heavy smoothing never leaves the result net-blurrier than
    // the plain resize), while the overshoot cap (y2/y3) and the flat/peak
    // thresholds (m1/m2) are tuned per content class to avoid clipping and halos.
    const profile = SHARPEN_PROFILES[sharpenProfile];
    const combined = sharpness * 0.7 + detailBoost * 0.3;
    const sigma = Math.min(1.8, profile.base + (combined / 100) * profile.combined + (denoise / 100) * profile.denoise);
    pipeline = pipeline.sharpen({
      sigma: round2(sigma),
      m1: round2(profile.m1Base + detailBoost / profile.m1Detail),
      m2: round2(profile.m2Base + sharpness / profile.m2Sharp),
      x1: 2,
      y2: profile.y2,
      y3: profile.y3,
    });
  }

  const brightness = 1 + options.brightness / 100;
  const saturation = 1 + options.saturation / 100;
  if (brightness !== 1 || saturation !== 1) pipeline = pipeline.modulate({ brightness, saturation });
  if (options.contrast !== 0) {
    const contrast = 1 + options.contrast / 100;
    pipeline = pipeline.linear(contrast, 128 * (1 - contrast));
  }

  let mimeType: string;
  if (options.format === 'jpg') {
    mimeType = 'image/jpeg';
    pipeline = pipeline
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: options.quality, progressive: true, mozjpeg: true, chromaSubsampling: '4:4:4' });
  } else if (options.format === 'webp') {
    mimeType = 'image/webp';
    const outputPixels = targetWidth * targetHeight;
    pipeline = pipeline.webp({
      quality: options.quality,
      // libwebp encoding dominates runtime at very large outputs; effort 2 is
      // ~2.5x faster than 3-4 there with the same measured fidelity and ~3% size.
      effort: outputPixels > WEBP_FAST_EFFORT_PIXELS ? 2 : 4,
      lossless: options.quality >= 100,
      smartSubsample: true,
    });
  } else {
    mimeType = 'image/png';
    pipeline = pipeline.png({ compressionLevel: 7, progressive: true });
  }

  let outputBuffer: Buffer;
  try {
    outputBuffer = await pipeline.toBuffer();
  } catch (error: any) {
    const message = String(error?.message || '');
    if (/premature|truncated|corrupt|unable to|unsupported/i.test(message)) {
      throw new UpscaleError('The image could not be processed. It may be corrupt or truncated.');
    }
    throw new UpscaleError('Image processing failed on the server. Try a smaller scale or image.', 500);
  }

  return {
    buffer: outputBuffer,
    mimeType,
    format: options.format,
    originalWidth,
    originalHeight,
    upscaledWidth: targetWidth,
    upscaledHeight: targetHeight,
    originalSize: inputBuffer.length,
    upscaledSize: outputBuffer.length,
    processingTimeMs: Date.now() - startTime,
    preset: resolvedPreset,
    contentKind,
  };
}
