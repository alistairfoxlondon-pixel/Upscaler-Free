import type { Request, Response } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { once } from 'node:events';
import { MAX_INPUT_BYTES, MAX_OUTPUT_DIMENSION, MAX_OUTPUT_PIXELS, type UpscaleOptions } from '../shared/upscale.ts';
import { ENGINE, PIPELINE_VERSION, processImageUpscale, type UpscaleResult } from './upscaler.ts';
import { UpscaleError } from './errors.ts';

export const outputByteLimit = () => process.env.VERCEL ? 4 * 1024 * 1024 : 32 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_INPUT_BYTES, files: 1, fields: 10, parts: 11, fieldSize: 100, fieldNameSize: 32 } });

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
  const allowed = new Set(['scale', 'preset', 'sharpness', 'denoise', 'detailBoost', 'contrast', 'brightness', 'saturation', 'format', 'quality']);
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

export function systemStatus() {
  return {
    status: 'online', engine: ENGINE, pipelineVersion: PIPELINE_VERSION,
    libraries: [{ name: 'Sharp', version: sharp.versions.sharp, role: 'Colour-managed, low-halo enlargement' }, { name: 'libvips', version: sharp.versions.vips, role: 'Native resampling' }],
    supportedFormats: ['JPEG', 'PNG', 'WebP', 'AVIF', 'TIFF (one page)', 'GIF (still)'],
    exportFormats: ['PNG', 'JPG', 'WebP'],
    limits: { inputBytes: MAX_INPUT_BYTES, outputBytes: outputByteLimit(), outputDimension: MAX_OUTPUT_DIMENSION, outputPixels: MAX_OUTPUT_PIXELS },
    privacy: { persistentStorage: false, processing: 'server memory', tracking: false },
    neural: false,
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
  try {
    if (!req.is('multipart/form-data')) throw new UpscaleError('Upload an image using multipart/form-data.', 415, 'INVALID_CONTENT_TYPE');
    release = gate.acquire();
    await new Promise<void>((resolve, reject) => upload.single('file')(req, res, error => error ? reject(error) : resolve()));
    if (!req.file?.buffer) throw new UpscaleError('Choose an image to upscale.');
    if (req.aborted || res.destroyed) return;
    const result = await processImageUpscale(req.file.buffer, parseOptions(req.body || {}));
    if (res.destroyed) return;
    if (result.buffer.length > outputByteLimit()) throw new UpscaleError('The result is too large to download on this server. Choose WebP, JPG, or a smaller scale.', 413, 'OUTPUT_BYTE_LIMIT');
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
    // Clear our reference. Actual deallocation is managed by V8/libvips, not guaranteed instant erasure.
    if (req.file) req.file.buffer = Buffer.alloc(0);
    release?.();
  }
}
