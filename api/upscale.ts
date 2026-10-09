import type { Request, Response } from 'express';
import { processImageUpscale, UpscaleOptions } from '../server/upscaler.ts';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15mb',
    },
  },
};

export default async function handler(req: any, res: any) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { image, name, scale, preset, sharpness, denoise, format, quality } = req.body || {};

    if (!image) {
      return res.status(400).json({ error: 'No image provided in request body' });
    }

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const inputBuffer = Buffer.from(base64Data, 'base64');

    const options: UpscaleOptions = {
      scale: Number(scale) || 2,
      preset: preset || 'photo',
      sharpness: sharpness !== undefined ? Number(sharpness) : undefined,
      denoise: denoise !== undefined ? Number(denoise) : undefined,
      format: format || 'png',
      quality: quality ? Number(quality) : 95,
    };

    const result = await processImageUpscale(inputBuffer, options);

    return res.status(200).json({
      success: true,
      originalName: name || 'image',
      dataUrl: result.dataUrl,
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
    });
  } catch (error: any) {
    console.error('Vercel upscale error:', error);
    return res.status(500).json({ error: error.message || 'Image processing failed' });
  }
}
