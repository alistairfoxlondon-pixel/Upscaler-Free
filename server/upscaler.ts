import sharp, { type Sharp, type SharpOptions, type OutputInfo } from 'sharp';
import {
  MAX_INPUT_BYTES, MAX_INPUT_PIXELS, MAX_OUTPUT_DIMENSION, MAX_OUTPUT_PIXELS,
  SUPPORTED_FORMATS, SUPPORTED_PRESETS, SUPPORTED_SCALES, PRESET_DEFAULTS,
  outputLimitMessage, type UpscaleOptions, type UpscaleSettings,
} from '../shared/upscale.ts';
import { UpscaleError, imageError } from './errors.ts';

export { MAX_INPUT_BYTES, MAX_OUTPUT_DIMENSION, MAX_OUTPUT_PIXELS, SUPPORTED_FORMATS, SUPPORTED_SCALES };
export type { UpscaleOptions };
export const ENGINE = 'libvips NoHalo · centre-aligned';
export const PIPELINE_VERSION = '2.0.0';

// Limit native cache/thread amplification. The request gate bounds active image pipelines too.
sharp.cache({ memory: 16, files: 0, items: 20 });
sharp.concurrency(2);

export interface UpscaleResult {
  buffer: Buffer;
  mimeType: string;
  format: UpscaleSettings['format'];
  originalWidth: number;
  originalHeight: number;
  upscaledWidth: number;
  upscaledHeight: number;
  originalSize: number;
  upscaledSize: number;
  processingTimeMs: number;
  engine: string;
  pipelineVersion: string;
  hasAlpha: boolean;
  warnings: string[];
  settings: UpscaleSettings;
}

function bounded(value: unknown, min: number, max: number, fallback: number, name: string) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new UpscaleError(`${name} must be a finite number.`);
  return Math.min(max, Math.max(min, value));
}

export function normalizeOptions(options: UpscaleOptions): UpscaleSettings {
  if (!options || !SUPPORTED_SCALES.includes(options.scale as UpscaleSettings['scale'])) throw new UpscaleError('Scale must be 2, 4, or 8.');
  const format = options.format ?? 'png';
  if (!SUPPORTED_FORMATS.includes(format)) throw new UpscaleError('Format must be jpg, png, or webp.');
  const preset = options.preset ?? 'photo';
  if (!SUPPORTED_PRESETS.includes(preset)) throw new UpscaleError('Invalid image preset.');
  const defaults = PRESET_DEFAULTS[preset];
  return {
    scale: options.scale as UpscaleSettings['scale'], preset, format,
    sharpness: bounded(options.sharpness, 0, 100, defaults.sharpness, 'Sharpness'),
    denoise: bounded(options.denoise, 0, 100, defaults.denoise, 'Smoothing'),
    detailBoost: bounded(options.detailBoost, 0, 100, defaults.detailBoost, 'Detail'),
    contrast: bounded(options.contrast, -50, 50, 0, 'Contrast'),
    brightness: bounded(options.brightness, -50, 50, 0, 'Brightness'),
    saturation: bounded(options.saturation, -50, 50, 0, 'Saturation'),
    quality: Math.round(bounded(options.quality, 70, 100, 95, 'Quality')),
  };
}

/** Faithful raster enlargement, NOT a neural reconstruction model. No image files are written. */
export async function processImageUpscale(inputBuffer: Buffer, rawOptions: UpscaleOptions): Promise<UpscaleResult> {
  const start = performance.now();
  if (!Buffer.isBuffer(inputBuffer) || !inputBuffer.length) throw new UpscaleError('Image is empty.');
  if (inputBuffer.length > MAX_INPUT_BYTES) throw new UpscaleError('Image exceeds the 4 MB upload limit.', 413, 'FILE_TOO_LARGE');
  const options = normalizeOptions(rawOptions);
  const deadline = start + 45_000;
  const timed = (pipeline: Sharp) => {
    const remaining = Math.floor((deadline - performance.now()) / 1000);
    if (remaining < 1) throw new UpscaleError('This image took too long. Try a smaller scale.', 422, 'PROCESSING_TIMEOUT');
    return pipeline.timeout({ seconds: remaining });
  };
  const inputOptions: SharpOptions = { failOn: 'warning', limitInputPixels: MAX_INPUT_PIXELS, sequentialRead: true };
  try {
    const meta = await sharp(inputBuffer, inputOptions).metadata();
    if (!meta.format || !['jpeg', 'png', 'webp', 'avif', 'heif', 'tiff', 'gif'].includes(meta.format) || !meta.width || !meta.height) {
      throw new UpscaleError('Unsupported image. Use JPG, PNG, WebP, AVIF, TIFF, or a still GIF.', 415, 'UNSUPPORTED_FORMAT');
    }
    if ((meta.pages ?? 1) > 1) throw new UpscaleError('Animated and multi-page images are not supported. Choose one frame or page first.', 415, 'MULTI_FRAME_IMAGE');
    const swapped = Boolean(meta.orientation && meta.orientation >= 5 && meta.orientation <= 8);
    const originalWidth = swapped ? meta.height : meta.width;
    const originalHeight = swapped ? meta.width : meta.height;
    const upscaledWidth = originalWidth * options.scale;
    const upscaledHeight = originalHeight * options.scale;
    const limit = outputLimitMessage(originalWidth, originalHeight, options.scale);
    if (limit) throw new UpscaleError(limit, 413, 'OUTPUT_PIXEL_LIMIT');
    const pixelArt = options.preset === 'pixel_art';
    const pad = pixelArt ? 0 : 3;
    const warnings: string[] = [];
    if (meta.hasAlpha && options.format === 'jpg') warnings.push('JPG uses a white background. Choose PNG or WebP to keep transparency.');
    if (options.scale === 8) warnings.push('8× makes a larger image, not eight times more detail.');

    // A separate source-sized stage is essential: Sharp reorders blur AFTER resize in one chain.
    // Working in sRGB strips EXIF/GPS while respecting embedded colour profiles.
    let source = sharp(inputBuffer, inputOptions).autoOrient().toColourspace('srgb');
    if (options.denoise > 0 && !pixelArt) source = source.blur(0.3 + options.denoise / 125);
    if (pad) source = source.extend({ top: pad, bottom: pad, left: pad, right: pad, extendWith: 'copy' });
    const prepared = await timed(source).raw().toBuffer({ resolveWithObject: true });

    let enlarged: { data: Buffer; info: OutputInfo };
    if (pixelArt) {
      enlarged = await timed(sharp(prepared.data, { raw: prepared.info }).resize(upscaledWidth, upscaledHeight, { kernel: 'nearest' }))
        .raw().toBuffer({ resolveWithObject: true });
    } else {
      // Map pixel centres, not corners: x_out = scale * (x_in + 0.5) - 0.5.
      // NoHalo avoids cubic overshoot. Copy-padding prevents dark/transparent image borders.
      // Keep affine separate from sharpening: libvips handles alpha premultiplication itself.
      enlarged = await timed(sharp(prepared.data, { raw: prepared.info }).affine(
        [[options.scale, 0], [0, options.scale]],
        { interpolator: sharp.interpolators.nohalo, idx: 0.5, idy: 0.5, odx: -0.5, ody: -0.5 },
      )).raw().toBuffer({ resolveWithObject: true });
    }

    let pipeline = sharp(enlarged.data, { raw: enlarged.info }).extract({
      left: pad * options.scale, top: pad * options.scale, width: upscaledWidth, height: upscaledHeight,
    });
    if (!pixelArt && (options.sharpness > 0 || options.detailBoost > 0)) {
      const amount = (options.sharpness * 0.8 + options.detailBoost * 0.2) / 100;
      pipeline = pipeline.sharpen({ sigma: 0.5 + amount * 0.5, m1: amount * 0.4, m2: amount * 1.5, x1: 3, y2: 5, y3: 5 });
    }
    if (options.brightness || options.saturation) pipeline = pipeline.modulate({ brightness: 1 + options.brightness / 100, saturation: 1 + options.saturation / 100 });
    // Explicitly preserve alpha while adjusting RGB, including semi-transparent antialiased edges.
    if (options.contrast) {
      const multiplier = 1 + options.contrast / 100;
      const offset = 128 * (1 - multiplier);
      pipeline = enlarged.info.channels === 4
        ? pipeline.linear([multiplier, multiplier, multiplier, 1], [offset, offset, offset, 0])
        : pipeline.linear(multiplier, offset);
    }

    const mimeType = options.format === 'jpg' ? 'image/jpeg' : `image/${options.format}`;
    if (options.format === 'jpg') pipeline = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: options.quality, progressive: true, mozjpeg: true, chromaSubsampling: '4:4:4' });
    else if (options.format === 'webp') pipeline = pipeline.webp({ quality: options.quality, alphaQuality: 100, effort: 4, lossless: options.quality === 100, smartSubsample: true });
    else pipeline = pipeline.png({ compressionLevel: 6, palette: false });

    const { data: buffer, info } = await timed(pipeline).toBuffer({ resolveWithObject: true });
    return {
      buffer, mimeType, format: options.format, originalWidth, originalHeight,
      upscaledWidth: info.width, upscaledHeight: info.height,
      originalSize: inputBuffer.length, upscaledSize: buffer.length,
      processingTimeMs: Math.round(performance.now() - start),
      engine: pixelArt ? 'libvips nearest neighbour' : ENGINE,
      pipelineVersion: PIPELINE_VERSION,
      hasAlpha: options.format !== 'jpg' && Boolean(meta.hasAlpha), warnings, settings: options,
    };
  } catch (error) { throw imageError(error); }
}
