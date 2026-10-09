import sharp from 'sharp';

export interface UpscaleOptions {
  scale: number; // 2, 4, 8, or custom 1.5 to 8
  preset: 'photo' | 'digital_art' | 'anime' | 'document' | 'custom';
  sharpness?: number; // 0 to 100
  denoise?: number; // 0 to 100
  detailBoost?: number; // 0 to 100
  contrast?: number; // -50 to +50
  brightness?: number; // -50 to +50
  saturation?: number; // -50 to +50
  format?: 'jpg' | 'png' | 'webp';
  quality?: number; // 80 to 100
  stripMetadata?: boolean;
}

export interface UpscaleResult {
  buffer: Buffer;
  mimeType: string;
  format: string;
  originalWidth: number;
  originalHeight: number;
  upscaledWidth: number;
  upscaledHeight: number;
  originalSize: number;
  upscaledSize: number;
  processingTimeMs: number;
}

export async function processImageUpscale(
  inputBuffer: Buffer,
  options: UpscaleOptions
): Promise<UpscaleResult> {
  const startTime = Date.now();
  const scale = Math.min(8, Math.max(1, Number(options.scale) || 2));
  const targetFormat = options.format || 'png';
  const quality = Math.min(100, Math.max(70, Number(options.quality) || 92));

  // 1. Inspect original image metadata & auto-orient rotation
  const originalMeta = await sharp(inputBuffer).metadata();
  if (!originalMeta.width || !originalMeta.height) {
    throw new Error('Invalid or unreadable image file');
  }

  // Handle EXIF orientation swap
  const isSwapped =
    originalMeta.orientation && originalMeta.orientation >= 5 && originalMeta.orientation <= 8;
  const originalWidth = isSwapped ? originalMeta.height : originalMeta.width;
  const originalHeight = isSwapped ? originalMeta.width : originalMeta.height;

  const targetWidth = Math.round(originalWidth * scale);
  const targetHeight = Math.round(originalHeight * scale);

  // Safety ceiling: prevent exceeding 14000x14000
  const MAX_DIMENSION = 14000;
  if (targetWidth > MAX_DIMENSION || targetHeight > MAX_DIMENSION) {
    throw new Error(
      `Resulting dimensions (${targetWidth}×${targetHeight}) exceed safe limit of ${MAX_DIMENSION}px. Please select a smaller scale.`
    );
  }

  // 2. Resolve Preset Parameters (tuned for VISIBLE, HIGH-QUALITY IMPROVEMENT)
  let sharpness = options.sharpness ?? 60;
  let denoise = options.denoise ?? 30;
  let detailBoost = options.detailBoost ?? 50;
  let contrast = options.contrast ?? 0;
  let brightness = options.brightness ?? 0;
  let saturation = options.saturation ?? 0;

  switch (options.preset) {
    case 'photo':
      sharpness = options.sharpness ?? 65;
      denoise = options.denoise ?? 30;
      detailBoost = options.detailBoost ?? 60;
      break;
    case 'digital_art':
      sharpness = options.sharpness ?? 80;
      denoise = options.denoise ?? 25;
      detailBoost = options.detailBoost ?? 70;
      break;
    case 'anime':
      sharpness = options.sharpness ?? 85;
      denoise = options.denoise ?? 40;
      detailBoost = options.detailBoost ?? 80;
      break;
    case 'document':
      sharpness = options.sharpness ?? 95;
      denoise = options.denoise ?? 45;
      detailBoost = options.detailBoost ?? 50;
      contrast = options.contrast ?? 12;
      break;
    case 'custom':
      break;
  }

  // 3. Multi-Stage High-Performance Cloud Enhancement Pipeline
  let pipeline = sharp(inputBuffer, {
    failOn: 'none',
    limitInputPixels: 268402689,
  }).rotate();

  // Stage A: High-Order Resampling using Lanczos-3 Windowed Sinc Filter
  pipeline = pipeline.resize({
    width: targetWidth,
    height: targetHeight,
    kernel: sharp.kernel.lanczos3,
    fit: 'fill',
    fastShrinkOnLoad: false,
  });

  // Stage B: Denoise & Artifact Suppression
  if (denoise > 20) {
    if (denoise >= 60) {
      pipeline = pipeline.median(3);
    } else {
      const blurSigma = (denoise / 100) * 0.55;
      if (blurSigma > 0.25) {
        pipeline = pipeline.blur(blurSigma);
      }
    }
  }

  // Stage C: Adaptive Local Contrast & Micro-Texture Synthesis (CLAHE)
  // This brings out skin pores, hair strands, fabric textures, and foliage details
  if (detailBoost > 20 && options.preset !== 'document') {
    const claheSlope = Math.max(1, Math.min(6, Math.round(1 + (detailBoost / 100) * 3)));
    pipeline = pipeline.clahe({
      width: 10,
      height: 10,
      maxSlope: claheSlope,
    });
  }

  // Stage D: Multi-Pass High-Frequency Edge Sharpening
  // Uses dual threshold unsharp masking:
  // sigma: radius of edge detection (scales with magnification)
  // m1: threshold for flat areas to avoid noise amplification
  // m2: threshold for high-contrast edges to produce crisp, clean lines
  if (sharpness > 0 || detailBoost > 0) {
    const sigma = Math.max(0.9, 1.0 + (scale > 2 ? 0.6 : 0.2) + (sharpness / 100) * 1.2);
    const flatThreshold = Math.max(0.3, 1.2 - (detailBoost / 100) * 0.7);
    const jaggedThreshold = Math.max(0.8, 2.5 - (sharpness / 100) * 1.4);

    pipeline = pipeline.sharpen({
      sigma: Number(sigma.toFixed(2)),
      m1: Number(flatThreshold.toFixed(2)),
      m2: Number(jaggedThreshold.toFixed(2)),
    });
  }

  // Stage E: Color Vibrancy & Tonal Polishing
  // Counteract color wash-out from interpolation
  const effSaturation = saturation !== 0 ? saturation : detailBoost > 40 ? 5 : 0;
  const effContrast = contrast;
  const effBrightness = brightness;

  if (effContrast !== 0 || effBrightness !== 0 || effSaturation !== 0) {
    const brightnessMultiplier = 1 + effBrightness / 100;
    const saturationMultiplier = Math.max(0.5, 1 + effSaturation / 100);

    pipeline = pipeline.modulate({
      brightness: Math.max(0.6, Math.min(1.4, brightnessMultiplier)),
      saturation: Math.max(0.5, Math.min(1.6, saturationMultiplier)),
    });

    if (effContrast !== 0) {
      const slope = 1 + effContrast / 100;
      const intercept = 128 * (1 - slope);
      pipeline = pipeline.linear(slope, intercept);
    }
  }

  // Stage F: Output Format Encoding
  let mimeType = 'image/png';
  if (targetFormat === 'jpg') {
    mimeType = 'image/jpeg';
    pipeline = pipeline.flatten({ background: '#ffffff' });
    pipeline = pipeline.jpeg({
      quality,
      progressive: true,
      mozjpeg: true,
      chromaSubsampling: '4:4:4',
    });
  } else if (targetFormat === 'webp') {
    mimeType = 'image/webp';
    pipeline = pipeline.webp({
      quality,
      effort: 5,
      lossless: quality >= 98,
      smartSubsample: true,
    });
  } else {
    // Default PNG
    mimeType = 'image/png';
    pipeline = pipeline.png({
      compressionLevel: 8,
      progressive: true,
      adaptiveFiltering: true,
    });
  }

  const outputBuffer = await pipeline.toBuffer();
  const processingTimeMs = Date.now() - startTime;

  return {
    buffer: outputBuffer,
    mimeType,
    format: targetFormat,
    originalWidth,
    originalHeight,
    upscaledWidth: targetWidth,
    upscaledHeight: targetHeight,
    originalSize: inputBuffer.length,
    upscaledSize: outputBuffer.length,
    processingTimeMs,
  };
}
