import { AlertTriangle, CheckCircle2, Download, FileArchive, Play, RefreshCw, Trash2 } from 'lucide-react';
import type { ImageQueueItem } from '../types.ts';
import { formatBytes } from '../lib/format.ts';
import { MAX_BATCH_SIZE } from '@/server/presets.ts';

interface BatchQueueProps {
  items: ImageQueueItem[];
  selectedId: string | null;
  onSelectItem: (id: string) => void;
  onProcessItem: (id: string) => void;
  onProcessAll: () => void;
  onRemoveItem: (id: string) => void;
  onClearAll: () => void;
  onDownloadItem: (item: ImageQueueItem) => void;
  onDownloadAllZip: () => void;
  isProcessingAny: boolean;
  isGeneratingZip: boolean;
}

export const BatchQueue: React.FC<BatchQueueProps> = ({
  items,
  selectedId,
  onSelectItem,
  onProcessItem,
  onProcessAll,
  onRemoveItem,
  onClearAll,
  onDownloadItem,
  onDownloadAllZip,
  isProcessingAny,
  isGeneratingZip,
}) => {
  if (items.length === 0) return null;

  const done = items.filter((i) => i.status === 'success').length;
  const pending = items.filter((i) => i.status === 'idle').length;
  const failed = items.filter((i) => i.status === 'error').length;

  return (
    <div className="rounded-2xl border border-line bg-surface p-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ink">
          Queue
          <span className="ml-1.5 font-mono text-[11px] font-normal text-ink-faint tabular-nums">
            {done}/{items.length}{pending > 0 ? ` · ${pending} to go` : ''}{failed > 0 ? ` · ${failed} failed` : ''}
          </span>
        </p>
        <div className="flex items-center gap-1.5">
          {(pending > 0 || failed > 0) && (
            <button
              onClick={onProcessAll}
              disabled={isProcessingAny}
              className="flex cursor-pointer items-center gap-1 rounded-lg bg-brand px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-brand-strong disabled:opacity-40"
            >
              <Play className="h-3 w-3 fill-current" /> Upscale all ({pending + failed})
            </button>
          )}
          {done > 0 && (
            <button
              onClick={onDownloadAllZip}
              disabled={isGeneratingZip}
              className="flex cursor-pointer items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-ink-soft transition hover:border-line-strong hover:text-ink disabled:opacity-40"
            >
              <FileArchive className="h-3 w-3" /> {isGeneratingZip ? 'Zipping…' : `ZIP (${done})`}
            </button>
          )}
          <button
            onClick={onClearAll}
            disabled={isProcessingAny}
            title="Clear queue"
            aria-label="Clear queue"
            className="cursor-pointer rounded-lg p-1 text-ink-faint transition hover:bg-red-50 hover:text-err disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <ul className="flex max-h-44 flex-col gap-1 overflow-y-auto pr-0.5">
        {items.map((item) => {
          const selected = item.id === selectedId;
          return (
            <li
              key={item.id}
              className={`flex items-center gap-1 rounded-xl border p-1.5 pr-2 transition ${
                selected ? 'border-brand/50 bg-brand-soft/60' : 'border-line bg-white hover:border-line-strong'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectItem(item.id)}
                aria-current={selected || undefined}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left"
              >
                <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-canvas">
                  <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                  {item.status === 'processing' && (
                    <span className="absolute inset-0 flex items-center justify-center bg-ink/50">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-white" />
                    </span>
                  )}
                  {item.status === 'success' && (
                    <span className="absolute right-0 bottom-0 flex h-3.5 w-3.5 items-center justify-center rounded-tl bg-ok text-white">
                      <CheckCircle2 className="h-2.5 w-2.5" />
                    </span>
                  )}
                  {item.status === 'error' && (
                    <span className="absolute right-0 bottom-0 flex h-3.5 w-3.5 items-center justify-center rounded-tl bg-err text-white">
                      <AlertTriangle className="h-2.5 w-2.5" />
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-ink">{item.name}</span>
                  <span className="block truncate font-mono text-[10px] text-ink-faint tabular-nums">
                    {item.status === 'error'
                      ? item.errorMessage
                      : item.result
                        ? `${item.result.upscaledWidth}×${item.result.upscaledHeight} · ${formatBytes(item.result.upscaledSize)}`
                        : `${item.originalWidth ?? '?'}×${item.originalHeight ?? '?'} · ${formatBytes(item.originalSize)} · ${item.settingsSnapshot.scale}×`}
                  </span>
                </span>
              </button>
              <span className="flex shrink-0 items-center gap-1">
                {item.status === 'error' && (
                  <button
                    type="button"
                    onClick={() => onProcessItem(item.id)}
                    className="cursor-pointer rounded-md border border-line bg-white p-1 text-ink-soft transition hover:text-brand"
                    title="Retry"
                    aria-label={`Retry ${item.name}`}
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                )}
                {item.status === 'success' && (
                  <button
                    type="button"
                    onClick={() => onDownloadItem(item)}
                    className="cursor-pointer rounded-md border border-line bg-white p-1 text-ink-soft transition hover:text-brand"
                    title="Download"
                    aria-label={`Download ${item.name}`}
                  >
                    <Download className="h-3 w-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onRemoveItem(item.id)}
                  disabled={item.status === 'processing'}
                  className="cursor-pointer rounded-md p-1 text-ink-faint transition hover:text-err disabled:opacity-40"
                  title="Remove"
                  aria-label={`Remove ${item.name}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {items.length >= MAX_BATCH_SIZE && (
        <p className="mt-1.5 text-center text-[10px] text-ink-faint">Queue is full at {MAX_BATCH_SIZE} images</p>
      )}
    </div>
  );
};
