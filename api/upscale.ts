import multer from 'multer';
import {
  processImageUpscale,
  UpscaleError,
  type UpscaleOptions,
  MAX_INPUT_BYTES,
} from '../server/upscaler.ts';
import { sendImageResult, toErrorResponse } from '../server/http-utils.ts';

export const config = { api: { bodyParser: false } };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_INPUT_BYTES, files: 1, fields: 12 },
});

const runUpload = (req: any, res: any) =>
  new Promise<void>((resolve, reject) => {
    upload.single('file')(req, res, (error: unknown) => (error ? reject(error) : resolve()));
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

/**
 * Vercel enforces a 4.5 MB limit on function RESPONSE payloads as well as
 * requests. A 64 MP PNG can be >100 MB, so on Vercel we re-encode oversized
 * results with progressively smaller lossy settings and only then fail with a
 * clear message. Self-hosted Node servers stream any size (no platform cap).
 */
const VERCEL_MAX_OUTPUT_BYTES = 4.4 * 1024 * 1024;

async function fitVercelResponse(
  input: Buffer,
  options: UpscaleOptions,
  first: Awaited<ReturnType<typeof processImageUpscale>>
) {
  if (!process.env.VERCEL || first.buffer.length <= VERCEL_MAX_OUTPUT_BYTES) return first;

  const attempts: UpscaleOptions[] =
    options.format === 'png'
      ? [
          { ...options, format: 'webp', quality: 92 },
          { ...options, format: 'webp', quality: 82 },
          { ...options, format: 'jpg', quality: 85 },
        ]
      : options.format === 'webp'
        ? [{ ...options, quality: 82 }, { ...options, format: 'jpg', quality: 85 }]
        : [{ ...options, quality: 80 }];

  let last = first;
  for (const attempt of attempts) {
    try {
      last = await processImageUpscale(input, attempt);
    } catch {
      continue;
    }
    if (last.buffer.length <= VERCEL_MAX_OUTPUT_BYTES) return last;
  }
  throw new UpscaleError(
    `Result is ${Math.round(last.buffer.length / 1024 / 1024 * 10) / 10} MB — over the 4.5 MB serverless response limit. Try a smaller scale, JPG/WebP, or self-host for unlimited sizes.`
  );
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await runUpload(req, res);
    if (!req.file?.buffer) throw new UpscaleError('Choose an image to upscale');

    const options = parseOptions(req.body || {});
    const processed = await processImageUpscale(req.file.buffer, options);
    const result = await fitVercelResponse(req.file.buffer, options, processed);
    // The server never stores either image. It releases both buffers when this response completes.
    await sendImageResult(res, result);
  } catch (error: any) {
    const { status, message } = toErrorResponse(error);
    if (status >= 500) console.error('Upscale request failed:', message);
    return res.status(status).json({ error: message });
  }
}
