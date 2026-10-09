import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import JSZip from 'jszip';
import { ephemeralStorage } from './server/storage.ts';
import { processImageUpscale, UpscaleOptions } from './server/upscaler.ts';

const app = express();
const PORT = 3000;

// CORS & Preflight handling for iframe environments
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Middleware for JSON and urlencoded requests (up to 50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// In-memory Multer storage ensures zero temporary files left on disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 35 * 1024 * 1024, // 35 MB max per image
    files: 20, // Max 20 batch files
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Please upload standard image files.`));
    }
  },
});

// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

// System & Engine Info
app.get('/api/system-status', (_req, res) => {
  const stats = ephemeralStorage.getStats();
  const mem = process.memoryUsage();
  res.json({
    status: 'online',
    engine: 'OpenUpscale Cloud Super-Resolution Engine',
    libraries: [
      { name: 'Sharp (libvips)', version: '0.35.5', role: 'Multi-kernel Lanczos-3 & Bilateral Resampling' },
      { name: 'Adaptive Unsharp Kernel', version: '2.1', role: 'High-frequency edge enhancement & de-ringing' },
      { name: 'JSZip', version: '3.10.2', role: 'In-memory batch archive streaming' },
    ],
    supportedFormats: ['JPG', 'JPEG', 'PNG', 'WEBP', 'AVIF', 'BMP', 'TIFF', 'GIF', 'SVG'],
    exportFormats: ['JPG', 'PNG', 'WEBP'],
    privacy: {
      ephemeralMode: true,
      persistentStorage: false,
      autoDeleteTtlMinutes: 15,
      activeFilesInMemory: stats.activeFiles,
      memoryUsageMb: Math.round(mem.rss / 1024 / 1024),
    },
  });
});

// Single Image Upscale (Supports both Multipart Form-Data and JSON Base64)
app.post('/api/upscale', upload.single('file'), async (req, res) => {
  try {
    let inputBuffer: Buffer | null = null;
    let originalName = 'image';

    if (req.file && req.file.buffer) {
      inputBuffer = req.file.buffer;
      originalName = req.file.originalname || `image_${Date.now()}`;
    } else if (req.body && req.body.image) {
      const base64Data = req.body.image.replace(/^data:image\/\w+;base64,/, '');
      inputBuffer = Buffer.from(base64Data, 'base64');
      originalName = req.body.name || `image_${Date.now()}`;
    }

    if (!inputBuffer) {
      return res.status(400).json({ error: 'No image file or base64 data provided' });
    }

    const options: UpscaleOptions = {
      scale: (Number(req.body.scale) || 2) as 2 | 4 | 8,
      preset: req.body.preset || 'photo',
      sharpness: req.body.sharpness !== undefined ? Number(req.body.sharpness) : undefined,
      denoise: req.body.denoise !== undefined ? Number(req.body.denoise) : undefined,
      format: req.body.format || 'png',
      quality: req.body.quality ? Number(req.body.quality) : 95,
    };

    const result = await processImageUpscale(inputBuffer, options);
    const fileId = crypto.randomUUID();

    // Store in ephemeral memory cache for direct link downloads if needed
    ephemeralStorage.store({
      id: fileId,
      originalName,
      format: result.format,
      mimeType: result.mimeType,
      buffer: result.buffer,
      originalWidth: result.originalWidth,
      originalHeight: result.originalHeight,
      upscaledWidth: result.upscaledWidth,
      upscaledHeight: result.upscaledHeight,
      originalSize: result.originalSize,
      upscaledSize: result.upscaledSize,
      processingTimeMs: result.processingTimeMs,
      scale: options.scale,
      preset: options.preset || 'photo',
    });

    res.json({
      success: true,
      id: fileId,
      dataUrl: result.dataUrl,
      downloadUrl: `/api/files/${fileId}`,
      originalName,
      format: result.format,
      mimeType: result.mimeType,
      originalWidth: result.originalWidth,
      originalHeight: result.originalHeight,
      upscaledWidth: result.upscaledWidth,
      upscaledHeight: result.upscaledHeight,
      originalSize: result.originalSize,
      upscaledSize: result.upscaledSize,
      processingTimeMs: result.processingTimeMs,
      scale: options.scale,
      preset: options.preset || 'photo',
    });
  } catch (error: any) {
    console.error('Upscale error:', error);
    res.status(500).json({ error: error.message || 'Failed to process image' });
  }
});

// Stream or Download Image by ID
app.get('/api/files/:id', (req, res) => {
  const { id } = req.params;
  const deleteAfter = req.query.deleteAfter === 'true';
  const download = req.query.download === 'true';

  const item = ephemeralStorage.get(id);
  if (!item) {
    return res.status(404).json({ error: 'Image not found or expired from cloud storage' });
  }

  const baseName = item.originalName.replace(/\.[^/.]+$/, '');
  const downloadFilename = `${baseName}_upscaled_${item.scale}x.${item.format}`;

  res.setHeader('Content-Type', item.mimeType);
  res.setHeader('Content-Length', item.buffer.length);
  res.setHeader('Cache-Control', 'public, max-age=300');

  if (download) {
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
  } else {
    res.setHeader('Content-Disposition', `inline; filename="${downloadFilename}"`);
  }

  res.send(item.buffer);

  if (deleteAfter) {
    setTimeout(() => {
      ephemeralStorage.delete(id);
    }, 1000);
  }
});

// Explicit Delete Endpoint
app.delete('/api/files/:id', (req, res) => {
  const { id } = req.params;
  const deleted = ephemeralStorage.delete(id);
  res.json({ success: true, deleted, id });
});

// Batch Download as ZIP Archive
app.post('/api/batch-zip', async (req, res) => {
  try {
    const { ids, deleteAfter } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }

    const items = ephemeralStorage.getMultiple(ids);
    if (items.length === 0) {
      return res.status(404).json({ error: 'No matching files found' });
    }

    const zip = new JSZip();
    for (const item of items) {
      const baseName = item.originalName.replace(/\.[^/.]+$/, '');
      const filename = `${baseName}_upscaled_${item.scale}x.${item.format}`;
      zip.file(filename, item.buffer);
    }

    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipFilename = `OpenUpscale_Batch_${timestamp}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
    res.setHeader('Content-Length', zipBuffer.length);
    res.send(zipBuffer);

    if (deleteAfter) {
      setTimeout(() => {
        for (const id of ids) {
          ephemeralStorage.delete(id);
        }
      }, 2000);
    }
  } catch (error: any) {
    console.error('Batch zip error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate zip archive' });
  }
});

// Purge / Cleanup Endpoint
app.post('/api/cleanup', (req, res) => {
  const { all } = req.body;
  if (all) {
    const count = ephemeralStorage.clearAll();
    return res.json({ success: true, cleared: count });
  }
  const expiredCount = ephemeralStorage.purgeExpired();
  res.json({ success: true, expiredCleared: expiredCount });
});

// CRITICAL: All unhandled /api calls return JSON 404, never fallback to Vite SPA HTML
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
});

// Global error handler for API errors
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.path.startsWith('/api')) {
    console.error('API Error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  }
  next(err);
});

// -------------------------------------------------------------
// Vite Middleware & Static Serving Setup
// -------------------------------------------------------------
async function setupServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // In production, serve built files
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[OpenUpscale] Cloud Image Upscaler running on http://0.0.0.0:${PORT}`);
  });
}

setupServer();
