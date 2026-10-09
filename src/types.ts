export type UpscalePreset = 'photo' | 'digital_art' | 'anime' | 'document' | 'custom';
export type ExportFormat = 'jpg' | 'png' | 'webp';
export type ScaleFactor = 2 | 4 | 8;

export interface UpscaleSettings {
  scale: ScaleFactor;
  preset: UpscalePreset;
  sharpness: number; // 0 to 100
  denoise: number; // 0 to 100
  detailBoost: number; // 0 to 100
  contrast: number; // -50 to +50
  brightness: number; // -50 to +50
  saturation: number; // -50 to +50
  format: ExportFormat;
  quality: number; // 80 to 100
  autoDeleteOnDownload: boolean;
}

export interface UpscaleResultData {
  id: string;
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
    activeFilesInMemory: number;
    memoryUsageMb: number;
  };
}
