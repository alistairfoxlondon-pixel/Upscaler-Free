import { once } from 'node:events';
import multer from 'multer';
import { processImageUpscale, type UpscaleOptions, MAX_INPUT_BYTES } from '../server/upscaler.ts';

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
  preset: String(body.preset || 'photo') as UpscaleOptions['preset'],
  sharpness: Number(body.sharpness),
  denoise: Number(body.denoise),
  detailBoost: Number(body.detailBoost),
  contrast: Number(body.contrast),
  brightness: Number(body.brightness),
  saturation: Number(body.saturation),
  format: String(body.format || 'png') as UpscaleOptions['format'],
  quality: Number(body.quality),
});

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await runUpload(req, res);
    if (!req.file?.buffer) return res.status(400).json({ error: 'Choose an image to upscale' });

    const result = await processImageUpscale(req.file.buffer, parseOptions(req.body || {}));
    const metadata = {
      originalWidth: result.originalWidth,
      originalHeight: result.originalHeight,
      upscaledWidth: result.upscaledWidth,
      upscaledHeight: result.upscaledHeight,
      originalSize: result.originalSize,
      upscaledSize: result.upscaledSize,
      processingTimeMs: result.processingTimeMs,
      format: result.format,
      mimeType: result.mimeType,
    };

    // The server never stores either image. It releases both buffers when this response completes.
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('X-Upscale-Metadata', Buffer.from(JSON.stringify(metadata)).toString('base64url'));
    res.status(200);
    // Chunked output avoids base64 overhead and supports results larger than buffered response limits.
    for (let offset = 0; offset < result.buffer.length; offset += 64 * 1024) {
      if (!res.write(result.buffer.subarray(offset, offset + 64 * 1024))) await once(res, 'drain');
    }
    return res.end();
  } catch (error: any) {
    const isLimit = error?.code === 'LIMIT_FILE_SIZE';
    const message = isLimit ? 'Image exceeds the 4 MB cloud upload limit' : error?.message || 'Image processing failed';
    const status = isLimit || /must be|exceeds|invalid|unsupported|unreadable|empty/i.test(message) ? 400 : 500;
    console.error('Upscale request failed:', message);
    return res.status(status).json({ error: message });
  }
}
