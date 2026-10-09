import { once } from 'node:events';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { processImageUpscale, type UpscaleOptions, MAX_INPUT_BYTES } from './server/upscaler.ts';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_INPUT_BYTES, files: 1, fields: 12 },
});

app.disable('x-powered-by');
app.get('/api/system-status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    status: 'online',
    engine: 'Sharp/libvips cloud resampling',
    libraries: [{ name: 'Sharp', version: '0.34', role: 'Lanczos-3 resize and enhancement' }],
    supportedFormats: ['JPEG', 'PNG', 'WebP', 'AVIF', 'TIFF', 'GIF', 'HEIC'],
    exportFormats: ['JPG', 'PNG', 'WebP'],
    privacy: { ephemeralMode: true, persistentStorage: false, autoDeleteTtlMinutes: 0 },
  });
});

app.post('/api/upscale', upload.single('file'), async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: 'Choose an image to upscale' });
    const body = req.body as Record<string, string>;
    const options: UpscaleOptions = {
      scale: Number(body.scale),
      preset: body.preset as UpscaleOptions['preset'],
      sharpness: Number(body.sharpness),
      denoise: Number(body.denoise),
      detailBoost: Number(body.detailBoost),
      contrast: Number(body.contrast),
      brightness: Number(body.brightness),
      saturation: Number(body.saturation),
      format: body.format as UpscaleOptions['format'],
      quality: Number(body.quality),
    };
    const result = await processImageUpscale(req.file.buffer, options);
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
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('X-Upscale-Metadata', Buffer.from(JSON.stringify(metadata)).toString('base64url'));
    res.status(200);
    for (let offset = 0; offset < result.buffer.length; offset += 64 * 1024) {
      if (!res.write(result.buffer.subarray(offset, offset + 64 * 1024))) await once(res, 'drain');
    }
    return res.end();
  } catch (error: any) {
    const message = error?.code === 'LIMIT_FILE_SIZE'
      ? 'Image exceeds the 4 MB cloud upload limit'
      : error?.message || 'Image processing failed';
    return res.status(/must be|exceeds|invalid|unsupported|unreadable|empty/i.test(message) ? 400 : 500).json({ error: message });
  }
});

app.all('/api/*', (req, res) => res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` }));
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error?.code === 'LIMIT_FILE_SIZE' ? 'Image exceeds the 4 MB cloud upload limit' : 'Upload failed';
  res.status(400).json({ error: message });
});

async function start() {
  if (process.env.NODE_ENV === 'production') {
    const dist = path.resolve('dist');
    app.use(express.static(dist, { maxAge: '1y', immutable: true }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`OpenUpscale listening on http://0.0.0.0:${PORT}`));
}

start();
