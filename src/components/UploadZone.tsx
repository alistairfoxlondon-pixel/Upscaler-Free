import { useRef, useState } from 'react';
import { ImagePlus, Sparkles } from 'lucide-react';
import { SAMPLE_IMAGES, type SampleItem } from '../data/samples.ts';

interface UploadZoneProps {
  onFilesSelected: (files: File[]) => void;
  onSampleSelected: (sample: SampleItem) => void;
  disabled?: boolean;
  variant?: 'full' | 'compact';
}

export const UploadZone: React.FC<UploadZoneProps> = ({
  onFilesSelected,
  onSampleSelected,
  disabled = false,
  variant = 'full',
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const acceptFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    onFilesSelected(Array.from(fileList));
  };

  const input = (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      accept="image/jpeg,image/png,image/webp,image/avif,image/tiff,image/gif,image/heic,image/heif"
      disabled={disabled}
      onChange={(e) => {
        acceptFiles(e.target.files);
        e.target.value = '';
      }}
      className="hidden"
    />
  );

  if (variant === 'compact') {
    return (
      <div className="space-y-2">
        {input}
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px] font-medium text-ink-soft transition hover:border-brand/40 hover:text-ink disabled:opacity-50"
          >
            <ImagePlus className="h-3.5 w-3.5" /> Upload
          </button>
          <div className="flex gap-1.5">
            {SAMPLE_IMAGES.map((sample) => (
              <button
                key={sample.id}
                type="button"
                disabled={disabled}
                onClick={() => onSampleSelected(sample)}
                title={`Try the ${sample.category.toLowerCase()} sample`}
                className="h-7 w-7 cursor-pointer overflow-hidden rounded-lg border border-line transition hover:border-brand/60 disabled:opacity-50"
              >
                <img src={sample.url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {input}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload images: click, drag and drop, or paste"
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setIsDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          if (!disabled && e.dataTransfer.files) acceptFiles(e.dataTransfer.files);
        }}
        onClick={() => !disabled && fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors sm:py-14 ${
          isDragOver
            ? 'border-brand bg-brand-soft'
            : 'border-line-strong bg-surface hover:border-brand/50'
        } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
      >
        <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <ImagePlus className="h-5 w-5" />
        </span>
        <p className="text-sm font-semibold text-ink">
          Drop images, <span className="text-brand underline underline-offset-2">browse</span>, or paste
        </p>
        <p className="mt-1 text-xs text-ink-soft">
          PNG · JPG · WebP · AVIF · TIFF · GIF — 4 MB each, up to 20 at once
        </p>
      </div>

      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
          <Sparkles className="h-3 w-3 text-brand" /> Try a sample
        </p>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {SAMPLE_IMAGES.map((sample) => (
            <button
              key={sample.id}
              type="button"
              disabled={disabled}
              onClick={() => onSampleSelected(sample)}
              title={sample.description}
              className="group flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface p-1.5 text-left transition hover:border-brand/50 disabled:opacity-50"
            >
              <img src={sample.url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink-soft group-hover:text-ink">
                {sample.category}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
