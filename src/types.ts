import type { UpscaleSettings, ScaleFactor, ExportFormat, UpscalePreset, UpscaleEngine } from '../shared/upscale.ts';
import type { StockMetadata } from '../shared/stock.ts';
export type { UpscaleSettings, ScaleFactor, ExportFormat, UpscalePreset, UpscaleEngine, StockMetadata };

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
  stockMetadata: StockMetadata;
  stockMetadataStatus: 'unavailable' | 'ready' | 'generating' | 'error';
  settingsSnapshot: UpscaleSettings;
}
