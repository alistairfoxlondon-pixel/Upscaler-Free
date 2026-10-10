import type { Request, Response } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { once } from 'node:events';
import { MAX_INPUT_BYTES, MAX_INPUT_PIXELS, MAX_OUTPUT_DIMENSION, MAX_OUTPUT_PIXELS, outputLimitMessage, type UpscaleOptions } from '../shared/upscale.ts';
import { normalizeStockMetadata } from '../shared/stock.ts';
import { AI_ENGINE, ENGINE, PIPELINE_VERSION, processImageUpscale, type UpscaleResult } from './upscaler.ts';
import { embedJpegXmp } from './stock-xmp.ts';
import { generateAiStockMetadata, stockMetadataAiConfigured } from './stock-metadata.ts';
import { realEsrganStatus } from './realesrgan.ts';
import { UpscaleError } from './errors.ts';

export const outputByteLimit = () => process.env.VERCEL ? 4 * 1024 * 1024 : 32 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_INPUT_BYTES, files: 1, fields: 12, parts: 13, fieldSize: 100, fieldNameSize: 32 } });
const stockUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: outputByteLimit(), files: 1, fields: 2, parts: 3, fieldSize: 8_000, fieldNameSize: 32 } });
const metadataUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_INPUT_BYTES, files: 1, fields: 0, parts: 1 } });

/** Per-instance, fail-fast backpressure; distributed rate limits belong at the deployment edge. */
export class ProcessingGate {
  private active = 0;
  acquire() {
    if (this.active >= 1) throw new UpscaleError('The upscaler is busy. Please try again in a moment.', 503, 'BUSY');
    this.active++;
    let released = false;
    return () => { if (!released) { released = true; this.active--; } };
  }
}
const gate = new ProcessingGate();

export function parseOptions(body: Record<string, unknown>): UpscaleOptions {
  const allowed = new Set(['scale', 'engine', 'preset', 'sharpness', 'denoise', 'detailBoost', 'contrast', 'brightness', 'saturation', 'format', 'quality']);
  const numeric = new Set(['scale', 'sharpness', 'denoise', 'detailBoost', 'contrast', 'brightness', 'saturation', 'quality']);
  const values: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!allowed.has(key)) throw new UpscaleError(`Unknown setting: ${key}.`);
    if (typeof value !== 'string' || !value.trim()) throw new UpscaleError(`Invalid value for ${key}.`);
    if (numeric.has(key)) {
      if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) throw new UpscaleError(`${key} must be a finite number.`);
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) throw new UpscaleError(`${key} must be a finite number.`);
      values[key] = parsed;
    } else values[key] = value;
  }
  // Omitted settings use the SAME defaults as the UI; they never become NaN or zero by coercion.
  return { ...values, scale: values.scale ?? 2 } as UpscaleOptions;
}

export const resultMetadata = ({ buffer: _buffer, ...metadata }: UpscaleResult) => metadata;

export async function systemStatus() {
  const realEsrgan = await realEsrganStatus();
  return {
    status: 'online', engine: ENGINE, pipelineVersion: PIPELINE_VERSION,
    libraries: [{ name: 'Sharp', version: sharp.versions.sharp, role: 'Colour-managed resampling, export and format conversion' }, { name: 'libvips', version: sharp.versions.vips, role: 'Native image processing' }],
    engines: {
      classic: { configured: true, name: ENGINE, neural: false },
      realesrgan: { ...realEsrgan, name: AI_ENGINE, model: 'RealESRGAN_x4plus', requiresGpuWorker: true, neural: realEsrgan.ready },
    },
    stockMetadata: { aiConfigured: stockMetadataAiConfigured(), autoGenerateOnUpload: true, maxKeywords: 49, titleLimit: 70, jpegXmpExport: true },
    supportedFormats: ['JPEG', 'PNG', 'WebP', 'AVIF', 'TIFF (one page)', 'GIF (still)'],
    exportFormats: ['JPEG with embedded XMP title and keywords'],
    limits: { inputBytes: MAX_INPUT_BYTES, outputBytes: outputByteLimit(), outputDimension: MAX_OUTPUT_DIMENSION, outputPixels: MAX_OUTPUT_PIXELS },
    privacy: { persistentStorage: false, processing: 'server memory', tracking: false, aiUpscalerWorkerConfigured: realEsrgan.configured, visionMetadataSentOnUploadWhenConfigured: true },
    neural: realEsrgan.ready,
  };
}

export function securityHeaders(res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

export async function upscaleHandler(req: Request, res: Response) {
  securityHeaders(res);
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST to upload an image.', code: 'METHOD_NOT_ALLOWED' }); }
  let release: (() => void) | undefined;
  let clientAbort: AbortController | undefined;
  let onClientDisconnect: (() => void) | undefined;
  try {
    if (!req.is('multipart/form-data')) throw new UpscaleError('Upload an image using multipart/form-data.', 415, 'INVALID_CONTENT_TYPE');
    release = gate.acquire();
    await new Promise<void>((resolve, reject) => upload.single('file')(req, res, error => error ? reject(error) : resolve()));
    if (!req.file?.buffer) throw new UpscaleError('Choose an image to upscale.');
    if (req.aborted || res.destroyed) return;
    clientAbort = new AbortController();
    onClientDisconnect = () => { if (req.aborted || (res.destroyed && !res.writableEnded)) clientAbort?.abort(); };
    req.on('aborted', onClientDisconnect);
    res.on('close', onClientDisconnect);
    const result = await processImageUpscale(req.file.buffer, parseOptions(req.body || {}), clientAbort.signal);
    req.off('aborted', onClientDisconnect);
    res.off('close', onClientDisconnect);
    if (res.destroyed) return;
    if (result.buffer.length > outputByteLimit()) throw new UpscaleError('The result is too large to process on this server. Try a smaller scale.', 413, 'OUTPUT_BYTE_LIMIT');
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('X-Upscale-Metadata', Buffer.from(JSON.stringify(resultMetadata(result))).toString('base64url'));
    // Do not claim chunking bypasses host response limits. Vercel outputs are explicitly capped.
    res.status(200);
    const disconnected = new AbortController();
    const onClose = () => disconnected.abort();
    res.on('close', onClose);
    try {
      for (let offset = 0; offset < result.buffer.length && !res.destroyed; offset += 64 * 1024) {
        if (!res.write(result.buffer.subarray(offset, offset + 64 * 1024))) await once(res, 'drain', { signal: disconnected.signal });
      }
      if (!res.destroyed) res.end();
    } finally { res.off('close', onClose); }
  } catch (error) {
    if (res.destroyed) return;
    if (res.headersSent) { res.destroy(); return; }
    let failure: UpscaleError;
    if (error instanceof UpscaleError) failure = error;
    else if (error instanceof multer.MulterError) failure = new UpscaleError(error.code === 'LIMIT_FILE_SIZE' ? 'Image exceeds the 4 MB upload limit.' : 'Invalid upload. Send one image and only the supported settings.', error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.code);
    else failure = new UpscaleError('The upload could not be processed. Please try again.', 400, 'UPLOAD_FAILED');
    if (failure.status === 503) res.setHeader('Retry-After', '3');
    res.status(failure.status).json({ error: failure.message, code: failure.code });
  } finally {
    if (onClientDisconnect) {
      req.off('aborted', onClientDisconnect);
      res.off('close', onClientDisconnect);
    }
    // Clear our reference. Actual deallocation is managed by V8/libvips, not guaranteed instant erasure.
    if (req.file) req.file.buffer = Buffer.alloc(0);
    release?.();
  }
}

export async function stockMetadataHandler(req: Request, res: Response) {
  securityHeaders(res);
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST to generate stock metadata.', code: 'METHOD_NOT_ALLOWED' }); }
  let release: (() => void) | undefined;
  try {
    if (!req.is('multipart/form-data')) throw new UpscaleError('Upload an image using multipart/form-data.', 415, 'INVALID_CONTENT_TYPE');
    if (!stockMetadataAiConfigured()) throw new UpscaleError('Image-specific metadata AI is not configured on this server.', 503, 'STOCK_AI_NOT_CONFIGURED');
    release = gate.acquire();
    await new Promise<void>((resolve, reject) => metadataUpload.single('file')(req, res, error => error ? reject(error) : resolve()));
    if (!req.file?.buffer) throw new UpscaleError('Choose an image for metadata suggestions.');
    if (req.aborted || res.destroyed) return;
    const metadata = await generateAiStockMetadata(req.file.buffer);
    if (!res.destroyed) res.status(200).json(metadata);
  } catch (error) {
    if (res.destroyed) return;
    const failure = error instanceof UpscaleError ? error : error instanceof multer.MulterError
      ? new UpscaleError(error.code === 'LIMIT_FILE_SIZE' ? 'Image exceeds the 4 MB upload limit.' : 'Invalid metadata request.', error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.code)
      : new UpscaleError('AI metadata could not be generated. Please retry.', 502, 'STOCK_AI_FAILED');
    if (failure.status === 503) res.setHeader('Retry-After', '3');
    res.status(failure.status).json({ error: failure.message, code: failure.code });
  } finally {
    if (req.file) req.file.buffer = Buffer.alloc(0);
    release?.();
  }
}

export async function stockExportHandler(req: Request, res: Response) {
  securityHeaders(res);
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST to export a Stock-ready JPEG.', code: 'METHOD_NOT_ALLOWED' }); }
  let release: (() => void) | undefined;
  try {
    if (!req.is('multipart/form-data')) throw new UpscaleError('Upload the upscaled image using multipart/form-data.', 415, 'INVALID_CONTENT_TYPE');
    release = gate.acquire();
    await new Promise<void>((resolve, reject) => stockUpload.single('file')(req, res, error => error ? reject(error) : resolve()));
    if (!req.file?.buffer) throw new UpscaleError('Choose an upscaled image to export.');
    const fields = Object.keys(req.body ?? {});
    if (fields.some(field => !['title', 'keywords'].includes(field))) throw new UpscaleError('Only a title and keywords are accepted for Stock export.');
    let keywords: unknown;
    try { keywords = JSON.parse(String(req.body?.keywords ?? '[]')); }
    catch { throw new UpscaleError('Keywords must be a valid list.', 400, 'INVALID_STOCK_METADATA'); }
    const stockMetadata = normalizeStockMetadata({ title: req.body?.title, keywords, source: 'edited' }, 'edited');
    if (!stockMetadata.title) throw new UpscaleError('Add a short title before exporting the Stock JPEG.', 400, 'INVALID_STOCK_METADATA');
    if (!stockMetadata.keywords.length) throw new UpscaleError('Add at least one keyword before exporting the Stock JPEG.', 400, 'INVALID_STOCK_METADATA');
    if (req.aborted || res.destroyed) return;

    const input = req.file.buffer;
    const image = sharp(input, { failOn: 'warning', limitInputPixels: MAX_INPUT_PIXELS, sequentialRead: true });
    const meta = await image.metadata();
    if (!meta.format || !['jpeg', 'png', 'webp', 'avif', 'heif', 'tiff', 'gif'].includes(meta.format) || !meta.width || !meta.height) {
      throw new UpscaleError('Unsupported image. Upload a valid JPEG, PNG, WebP, AVIF, TIFF, or still GIF.', 415, 'UNSUPPORTED_FORMAT');
    }
    if ((meta.pages ?? 1) > 1) throw new UpscaleError('Animated and multi-page images are not supported.', 415, 'MULTI_FRAME_IMAGE');
    const swapped = Boolean(meta.orientation && meta.orientation >= 5 && meta.orientation <= 8);
    const width = swapped ? meta.height : meta.width;
    const height = swapped ? meta.width : meta.height;
    const outputLimit = outputLimitMessage(width, height, 1);
    if (outputLimit) throw new UpscaleError(outputLimit, 413, 'OUTPUT_PIXEL_LIMIT');

    const prepared = sharp(input, { failOn: 'warning', limitInputPixels: MAX_INPUT_PIXELS, sequentialRead: true })
      .autoOrient()
      .toColourspace('srgb')
      .flatten({ background: '#ffffff' });
    let jpeg: Buffer | undefined;
    let selectedQuality = 94;
    const exportDeadline = performance.now() + 45_000;
    for (const quality of [94, 91, 88, 85, 82, 78]) {
      const remainingSeconds = Math.floor((exportDeadline - performance.now()) / 1000);
      if (remainingSeconds < 1) throw new UpscaleError('JPEG export took too long. Choose a smaller output.', 422, 'STOCK_EXPORT_TIMEOUT');
      jpeg = await prepared.clone()
        .jpeg({ quality, progressive: true, mozjpeg: true, chromaSubsampling: '4:4:4' })
        .timeout({ seconds: remainingSeconds })
        .toBuffer();
      selectedQuality = quality;
      if (jpeg.length <= outputByteLimit()) break;
    }
    if (!jpeg || jpeg.length > outputByteLimit()) throw new UpscaleError('The Stock JPEG is too large for this server. Choose a smaller upscale or lower the output dimensions.', 413, 'OUTPUT_BYTE_LIMIT');
    const exported = embedJpegXmp(jpeg, stockMetadata);
    if (exported.length > outputByteLimit()) throw new UpscaleError('The Stock JPEG is too large to download from this server. Choose a smaller scale.', 413, 'OUTPUT_BYTE_LIMIT');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('X-Stock-Export-Quality', String(selectedQuality));
    res.setHeader('X-Stock-Alpha-Flattened', String(Boolean(meta.hasAlpha)));
    res.setHeader('X-Stock-Metadata-Embedded', 'true');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(exported);
  } catch (error) {
    if (res.destroyed) return;
    const failure = error instanceof UpscaleError ? error : error instanceof multer.MulterError
      ? new UpscaleError(error.code === 'LIMIT_FILE_SIZE' ? 'The upscaled image is too large to export as JPEG here. Choose a smaller scale first.' : 'Invalid Stock export request.', error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.code)
      : new UpscaleError('The Stock JPEG could not be created. Please retry.', 422, 'STOCK_EXPORT_FAILED');
    if (failure.status === 503) res.setHeader('Retry-After', '3');
    res.status(failure.status).json({ error: failure.message, code: failure.code });
  } finally {
    if (req.file) req.file.buffer = Buffer.alloc(0);
    release?.();
  }
}
