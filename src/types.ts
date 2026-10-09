export type UpscalePreset = 'photo' | 'digital_art' | 'anime' | 'document' | 'custom';
export type ExportFormat = 'jpg' | 'png' | 'webp';
export type ScaleFactor = 2 | 4 | 8;
export type UpscaleEngine = 'esrgan' | 'lanczos';

export interface UpscaleSettings {
  scale: ScaleFactor;
  preset: UpscalePreset;
  sharpness: number; // 0 to 100
  denoise: number; // 0 to 100
  format: ExportFormat;
  quality: number; // 80 to 100
}

export interface UpscaleResultData {
  id: string;
  dataUrl?: string;
  downloadUrl: string;
  originalName: string;
  format: string;
  mimeType: string;
  originalWidth: number;
  originalHeight: number;
  upscaledWidth: number;
  upscaledHeight: number;
  originalSize: number;
  upscaledSize: number;
  processingTimeMs: number;
  scale: number;
  preset: string;
  engine: UpscaleEngine;
  engineNote?: string;
}

export interface ImageQueueItem {
  id: string;
  name: string;
  file?: File;
  previewUrl: string;
  originalWidth?: number;
  originalHeight?: number;
  originalSize: number;
  status: 'idle' | 'processing' | 'success' | 'error';
  progress: number;
  errorMessage?: string;
  result?: UpscaleResultData;
  isSample?: boolean;
  samplePath?: string;
  settingsSnapshot: UpscaleSettings;
}
