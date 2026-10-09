export type UpscalePreset = 'auto' | 'photo' | 'digital_art' | 'anime' | 'document' | 'custom';
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

export const DEFAULT_SETTINGS: UpscaleSettings = {
  scale: 2,
  preset: 'auto',
  sharpness: 45,
  denoise: 10,
  detailBoost: 35,
  contrast: 0,
  brightness: 0,
  saturation: 0,
  format: 'png',
  quality: 95,
};

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
  preset: string;
  contentKind?: string;
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
  presets: string[];
  limits: {
    maxInputBytes: number;
    maxInputPixels: number;
    maxOutputDimension: number;
    maxOutputPixels: number;
  };
  privacy: {
    ephemeralMode: boolean;
    persistentStorage: boolean;
    autoDeleteTtlMinutes: number;
  };
}
