import React, { useRef, useState } from 'react';
import { UploadCloud, Sparkles, AlertCircle, Clipboard } from 'lucide-react';
import { SAMPLE_IMAGES, SampleItem } from '../data/samples.ts';

interface UploadZoneProps {
  onFilesSelected: (files: File[]) => void;
  onSampleSelected: (sample: SampleItem) => void;
  disabled?: boolean;
}

export const UploadZone: React.FC<UploadZoneProps> = ({
  onFilesSelected,
  onSampleSelected,
  disabled = false,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateAndAddFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setErrorMessage(null);

    const validFiles: File[] = [];
    const MAX_SIZE = 35 * 1024 * 1024; // 35 MB

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (!file.type.startsWith('image/')) {
        setErrorMessage(`"${file.name}" is not an image file.`);
        continue;
      }
      if (file.size > MAX_SIZE) {
        setErrorMessage(`"${file.name}" exceeds the 35 MB limit.`);
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length > 0) {
      onFilesSelected(validFiles);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (!disabled && e.dataTransfer.files) {
      validateAndAddFiles(e.dataTransfer.files);
    }
  };

  return (
    <div className="space-y-4">
      {/* Main Drag & Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Add images: drop files here, click to browse, or paste"
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onClick={() => !disabled && fileInputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center p-8 sm:p-10 rounded-2xl border-2 border-dashed transition-all cursor-pointer text-center ${
          isDragOver
            ? 'border-cyan-400 bg-cyan-950/20 shadow-xl shadow-cyan-500/10'
            : 'border-slate-800 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-900/80'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          disabled={disabled}
          onChange={(e) => validateAndAddFiles(e.target.files)}
          className="hidden"
        />

        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 mb-3 border border-cyan-500/20">
          <UploadCloud className="h-6 w-6" />
        </div>

        <h3 className="text-base font-semibold text-white mb-1">
          Drop images here or <span className="text-cyan-400 hover:underline">browse</span>
        </h3>
        <p className="text-xs text-slate-400 mb-3">
          Paste with Ctrl+V · Up to 35 MB per image · Batch supported
        </p>

        {/* Concise format tags */}
        <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500">
          <span>PNG</span>
          <span>·</span>
          <span>JPG</span>
          <span>·</span>
          <span>WebP</span>
          <span>·</span>
          <span>AVIF</span>
          <span>·</span>
          <span>TIFF</span>
          <span>·</span>
          <span>BMP</span>
        </div>
      </div>

      {/* Error alert */}
      {errorMessage && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Sample Benchmarks */}
      <div className="rounded-xl bg-slate-900/40 border border-slate-800/80 p-3.5">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
            <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
            <span>Benchmark samples:</span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {SAMPLE_IMAGES.map((sample) => (
            <button
              key={sample.id}
              type="button"
              disabled={disabled}
              onClick={() => onSampleSelected(sample)}
              aria-label={`Load sample: ${sample.name}`}
              className="group relative flex items-center gap-2.5 p-2 rounded-lg border border-slate-800/90 bg-slate-950/60 hover:border-cyan-500/40 hover:bg-slate-900 transition-all text-left cursor-pointer"
            >
              <img
                src={sample.url}
                alt={sample.name}
                referrerPolicy="no-referrer"
                className="h-10 w-10 rounded object-cover shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-slate-200 truncate group-hover:text-cyan-300">
                  {sample.name}
                </div>
                <div className="text-[10px] text-slate-500 font-mono truncate">
                  {sample.category}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
