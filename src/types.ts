export type UpscalePreset = 'photo' | 'digital_art' | 'anime' | 'document' | 'custom';
export type ExportFormat = 'jpg' | 'png' | 'webp';
export type ScaleFactor = 2 | 4 | 8;

export interface UpscaleSettings {
  scale: ScaleFactor;
  preset: UpscalePreset;
  sharpness: number;
  denoise: number;
  detailBoost: number;
  contrast: number;
  brightness: number;
  saturation: number;
  format: ExportFormat;
  quality: number;
}

export interface UpscaleResultData {
  id: string;
  dataUrl: string;
  originalName: string;
  format: ExportFormat;
  mimeType: string;
  originalWidth: number;
  originalHeight: number;
  upscaledWidth: number;
  upscaledHeight: number;
  originalSize: number;
  upscaledSize: number;
  processingTimeMs: number;
  scale: ScaleFactor;
  preset: UpscalePreset;
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
  settingsSnapshot: UpscaleSettings;
}

export interface SystemInfo {
  status: string;
  engine: string;
  libraries: Array<{ name: string; version: string; role: string }>;
  supportedFormats: string[];
  exportFormats: string[];
  privacy: {
    ephemeralMode: boolean;
    persistentStorage: boolean;
    autoDeleteTtlMinutes: number;
  };
}
