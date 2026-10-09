import sharp from 'sharp';

export const SUPPORTED_SCALES = [2, 4, 8] as const;
export const SUPPORTED_FORMATS = ['jpg', 'png', 'webp'] as const;
export const MAX_INPUT_BYTES = 4 * 1024 * 1024;
export const MAX_OUTPUT_DIMENSION = 12_000;
export const MAX_OUTPUT_PIXELS = 64_000_000;

export interface UpscaleOptions {
  scale: number;
  preset?: 'photo' | 'digital_art' | 'anime' | 'document' | 'custom';
  sharpness?: number;
  denoise?: number;
  detailBoost?: number;
  contrast?: number;
  brightness?: number;
  saturation?: number;
  format?: 'jpg' | 'png' | 'webp';
  quality?: number;
}

export interface UpscaleResult {
  buffer: Buffer;
  dataUrl: string;
  mimeType: string;
  format: string;
  originalWidth: number;
  originalHeight: number;
  upscaledWidth: number;
  upscaledHeight: number;
  originalSize: number;
  upscaledSize: number;
  processingTimeMs: number;
}

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

export function normalizeOptions(options: UpscaleOptions): Required<UpscaleOptions> {
  const scale = Number(options.scale);
  if (!SUPPORTED_SCALES.includes(scale as (typeof SUPPORTED_SCALES)[number])) {
    throw new Error('Scale must be 2, 4, or 8');
  }

  const format = options.format ?? 'png';
  if (!SUPPORTED_FORMATS.includes(format)) throw new Error('Format must be jpg, png, or webp');

  const presets = ['photo', 'digital_art', 'anime', 'document', 'custom'] as const;
  const preset = presets.includes(options.preset as (typeof presets)[number])
    ? (options.preset as Required<UpscaleOptions>['preset'])
    : 'photo';

  const defaults = {
    photo: { sharpness: 45, denoise: 20, detailBoost: 35 },
    digital_art: { sharpness: 65, denoise: 25, detailBoost: 55 },
    anime: { sharpness: 65, denoise: 30, detailBoost: 55 },
    document: { sharpness: 75, denoise: 15, detailBoost: 65 },
    custom: { sharpness: 45, denoise: 20, detailBoost: 40 },
  }[preset];

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
 * Deterministic cloud enhancement based on libvips via Sharp.
 * This is high-quality resampling, not a generative neural model: it does not invent detail.
 */
export async function processImageUpscale(
  inputBuffer: Buffer,
  rawOptions: UpscaleOptions
): Promise<UpscaleResult> {
  const startTime = Date.now();
  if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length === 0) throw new Error('Image is empty');
  if (inputBuffer.length > MAX_INPUT_BYTES) throw new Error('Image exceeds the 4 MB cloud limit');

  const options = normalizeOptions(rawOptions);
  const source = sharp(inputBuffer, { failOn: 'error', limitInputPixels: 40_000_000 });
  const meta = await source.metadata();
  const supportedInputs = new Set(['jpeg', 'png', 'webp', 'avif', 'tiff', 'gif', 'heif']);
  if (!meta.format || !supportedInputs.has(meta.format) || !meta.width || !meta.height) {
    throw new Error('Unsupported or unreadable raster image (use JPEG, PNG, WebP, AVIF, TIFF, GIF, or HEIC)');
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
    throw new Error(
      `Requested output ${targetWidth}×${targetHeight} exceeds the 12,000 px / 64 MP safety limit`
    );
  }

  let pipeline = sharp(inputBuffer, {
    failOn: 'error',
    limitInputPixels: 40_000_000,
    sequentialRead: true,
  }).rotate();

  // A very light pre-filter suppresses block noise before enlargement. Keep blur below one pixel.
  if (options.denoise > 15) {
    const sigma = 0.3 + (options.denoise / 100) * 0.55;
    pipeline = pipeline.blur(Number(sigma.toFixed(2)));
  }

  pipeline = pipeline.resize({
    width: targetWidth,
    height: targetHeight,
    kernel: sharp.kernel.lanczos3,
    fit: 'fill',
    fastShrinkOnLoad: false,
  });

  if (options.sharpness > 0 || options.detailBoost > 0) {
    const combined = options.sharpness * 0.7 + options.detailBoost * 0.3;
    pipeline = pipeline.sharpen({
      sigma: Number((0.5 + combined / 250).toFixed(2)),
      m1: Number((0.7 + options.detailBoost / 125).toFixed(2)),
      m2: Number((1.5 + options.sharpness / 80).toFixed(2)),
      x1: 2,
      y2: 10,
      y3: 20,
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
    pipeline = pipeline.webp({
      quality: options.quality,
      effort: 4,
      lossless: options.quality >= 100,
      smartSubsample: true,
    });
  } else {
    mimeType = 'image/png';
    pipeline = pipeline.png({ compressionLevel: 7, progressive: true });
  }

  const outputBuffer = await pipeline.toBuffer();
  return {
    buffer: outputBuffer,
    dataUrl: `data:${mimeType};base64,${outputBuffer.toString('base64')}`,
    mimeType,
    format: options.format,
    originalWidth,
    originalHeight,
    upscaledWidth: targetWidth,
    upscaledHeight: targetHeight,
    originalSize: inputBuffer.length,
    upscaledSize: outputBuffer.length,
    processingTimeMs: Date.now() - startTime,
  };
}
