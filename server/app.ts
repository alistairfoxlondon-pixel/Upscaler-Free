import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import {
  processImageUpscale,
  UpscaleError,
  SUPPORTED_PRESETS,
  MAX_INPUT_BYTES,
  MAX_INPUT_PIXELS,
  MAX_OUTPUT_DIMENSION,
  MAX_OUTPUT_PIXELS,
  type UpscaleOptions,
} from './upscaler.ts';
import { sendImageResult, toErrorResponse } from './http-utils.ts';

/**
 * Simple per-IP sliding-window rate limiter. On serverless each instance has
 * its own window; on the standalone Node server it protects the process from
 * trivial abuse. Disabled when the limit is <= 0.
 */
function createRateLimiter(limitPerMinute: number) {
  const hits = new Map<string, number[]>();
  const timer = setInterval(() => {
    const cutoff = Date.now() - 60_000;
    for (const [key, times] of hits) {
      const fresh = times.filter((t) => t > cutoff);
      if (fresh.length > 0) hits.set(key, fresh);
      else hits.delete(key);
    }
  }, 60_000);
  timer.unref?.();

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (limitPerMinute <= 0) return next();
    const key = req.ip || 'unknown';
    const cutoff = Date.now() - 60_000;
    const times = (hits.get(key) || []).filter((t) => t > cutoff);
    if (times.length >= limitPerMinute) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    }
    times.push(Date.now());
    hits.set(key, times);
    next();
  };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_INPUT_BYTES, files: 1, fields: 12 },
});

const parseOptions = (body: Record<string, unknown>): UpscaleOptions => ({
  scale: Number(body.scale),
  preset: String(body.preset || 'auto') as UpscaleOptions['preset'],
  sharpness: Number(body.sharpness),
  denoise: Number(body.denoise),
  detailBoost: Number(body.detailBoost),
  contrast: Number(body.contrast),
  brightness: Number(body.brightness),
  saturation: Number(body.saturation),
  format: String(body.format || 'png') as UpscaleOptions['format'],
  quality: Number(body.quality),
});

export interface CreateAppOptions {
  /** Max /api/upscale calls per IP per minute. <= 0 disables. Default: env or 60. */
  rateLimitPerMinute?: number;
}

/** Builds the Express app shared by the standalone server (server.ts). */
export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const rateLimitPerMinute =
    options.rateLimitPerMinute ?? Number(process.env.UPSCALE_RATE_LIMIT_PER_MINUTE ?? 60);

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.get('/api/system-status', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      status: 'online',
      engine: 'Sharp/libvips cloud resampling',
      libraries: [
        { name: 'Sharp', version: sharp.versions.sharp ?? 'unknown', role: 'Lanczos-3 resize and enhancement' },
        { name: 'libvips', version: sharp.versions.vips ?? 'unknown', role: 'Image processing engine' },
      ],
      supportedFormats: ['JPEG', 'PNG', 'WebP', 'AVIF', 'TIFF', 'GIF', 'HEIC'],
      exportFormats: ['JPG', 'PNG', 'WebP'],
      presets: [...SUPPORTED_PRESETS],
      limits: {
        maxInputBytes: MAX_INPUT_BYTES,
        maxInputPixels: MAX_INPUT_PIXELS,
        maxOutputDimension: MAX_OUTPUT_DIMENSION,
        maxOutputPixels: MAX_OUTPUT_PIXELS,
      },
      privacy: { ephemeralMode: true, persistentStorage: false, autoDeleteTtlMinutes: 0 },
    });
  });

  app.post('/api/upscale', createRateLimiter(rateLimitPerMinute), upload.single('file'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (!req.file?.buffer) {
        throw new UpscaleError('Choose an image to upscale');
      }
      const result = await processImageUpscale(req.file.buffer, parseOptions(req.body || {}));
      await sendImageResult(res, result);
    } catch (error) {
      const { status, message } = toErrorResponse(error);
      if (status >= 500) console.error('Upscale request failed:', message);
      res.status(status).json({ error: message });
    }
  });

  // Known API paths answer 405 (not a bare 404) for wrong methods.
  app.all('/api/upscale', (_req, res) => res.status(405).json({ error: 'Method not allowed' }));

  app.all('/api/*', (req, res) => res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` }));

  // Multer/body errors and anything else. Never touch a response already streaming.
  app.use((error: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(error);
    const { status, message } = toErrorResponse(error);
    res.status(status).json({ error: message });
  });

  return app;
}
