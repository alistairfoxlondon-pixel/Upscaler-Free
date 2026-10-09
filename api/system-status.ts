import sharp from 'sharp';
import {
  SUPPORTED_PRESETS,
  MAX_INPUT_BYTES,
  MAX_INPUT_PIXELS,
  MAX_OUTPUT_DIMENSION,
  MAX_OUTPUT_PIXELS,
} from '../server/upscaler.ts';

export default function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    status: 'online',
    engine: 'Sharp/libvips cloud resampling',
    deployment: 'Vercel Node.js function',
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
}
