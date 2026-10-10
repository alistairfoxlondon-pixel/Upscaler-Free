import type { UpscaleSettings, ScaleFactor, ExportFormat, UpscalePreset } from '../shared/upscale.ts';
export type { UpscaleSettings, ScaleFactor, ExportFormat, UpscalePreset };

export interface UpscaleMetadata {
  mimeType: string;
  format: ExportFormat;
  originalWidth: number;
  originalHeight: number;
  upscaledWidth: number;
  upscaledHeight: number;
  originalSize: number;
  upscaledSize: number;
  processingTimeMs: number;
  engine: string;
  pipelineVersion: string;
  hasAlpha: boolean;
  warnings: string[];
  settings: UpscaleSettings;
}
export interface UpscaleResultData extends UpscaleMetadata {
  url: string;
  blob: Blob;
  scale: ScaleFactor;
}
export interface ImageQueueItem {
  id: string;
  name: string;
  file: File;
  previewUrl: string;
  previewAvailable: boolean;
  originalWidth?: number;
  originalHeight?: number;
  originalSize: number;
  status: 'idle' | 'processing' | 'success' | 'error';
  errorMessage?: string;
  result?: UpscaleResultData;
  settingsSnapshot: UpscaleSettings;
}
