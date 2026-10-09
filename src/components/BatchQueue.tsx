import React from 'react';
import {
  Layers,
  Play,
  Download,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  FileArchive,
  Eye,
} from 'lucide-react';
import { ImageQueueItem } from '../types.ts';

interface BatchQueueProps {
  items: ImageQueueItem[];
  selectedId: string | null;
  onSelectItem: (id: string) => void;
  onProcessAll: () => void;
  onProcessItem: (id: string) => void;
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
  onProcessAll,
  onProcessItem,
  onRemoveItem,
  onClearAll,
  onDownloadItem,
  onDownloadAllZip,
  isProcessingAny,
  isGeneratingZip,
}) => {
  if (items.length === 0) return null;

  const completedCount = items.filter((i) => i.status === 'success').length;
  const idleCount = items.filter((i) => i.status === 'idle').length;

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 sm:p-5 shadow-xl space-y-3.5">
      {/* Queue Header & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white">Batch Queue</span>
          <span className="text-xs font-mono text-slate-400">
            {completedCount}/{items.length} ready
          </span>
        </div>

        <div className="flex items-center gap-2">
          {idleCount > 0 && (
            <button
              onClick={onProcessAll}
              disabled={isProcessingAny}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 disabled:opacity-50 rounded-lg transition-all cursor-pointer"
            >
              <Play className="h-3 w-3 fill-current" />
              <span>Upscale all ({idleCount})</span>
            </button>
          )}

          {completedCount > 0 && (
            <button
              onClick={onDownloadAllZip}
              disabled={isGeneratingZip}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
            >
              <FileArchive className="h-3.5 w-3.5 text-cyan-400" />
              <span>{isGeneratingZip ? 'Zipping…' : `Download ZIP (${completedCount})`}</span>
            </button>
          )}

          <button
            onClick={onClearAll}
            disabled={isProcessingAny}
            className="p-1.5 text-slate-400 hover:text-rose-400 bg-slate-950/60 hover:bg-rose-950/30 border border-slate-800 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            title="Clear queue"
            aria-label="Clear queue"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Items list */}
      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
        {items.map((item) => {
          const isSelected = selectedId === item.id;
          return (
            <div
              key={item.id}
              className={`flex items-center justify-between gap-3 p-2.5 rounded-xl border transition-all ${
                isSelected
                  ? 'bg-slate-800/80 border-cyan-500/50 shadow-md ring-1 ring-cyan-500/20'
                  : 'bg-slate-950/40 border-slate-800/80 hover:bg-slate-900/60'
              }`}
            >
              {/* Thumbnail & Meta */}
              <div
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                onClick={() => onSelectItem(item.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectItem(item.id);
                  }
                }}
                className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:outline-cyan-400"
              >
                <div className="relative h-10 w-10 shrink-0 rounded-lg overflow-hidden bg-slate-900 border border-slate-800">
                  <img
                    src={item.previewUrl}
                    alt={item.name}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                  {item.status === 'success' && (
                    <div className="absolute inset-0 bg-cyan-950/40 flex items-center justify-center">
                      <CheckCircle2 className="h-3.5 w-3.5 text-cyan-400" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-slate-200 truncate">
                      {item.name}
                    </span>
                    {item.isSample && (
                      <span className="text-[9px] font-mono text-cyan-400 bg-cyan-950/60 px-1 rounded border border-cyan-800/50">
                        Sample
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-mono">
                    <span>{formatBytes(item.originalSize)}</span>
                    <span>·</span>
                    <span>{item.settingsSnapshot.scale}x</span>
                    {item.result && (
                      <>
                        <span className="text-cyan-400">→</span>
                        <span className="text-cyan-300 font-semibold">
                          {formatBytes(item.result.upscaledSize)}
                        </span>
                      </>
                    )}
                  </div>

                  {item.status === 'processing' && (
                    <div className="mt-1 h-1 w-28 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-cyan-400 animate-pulse w-2/3" />
                    </div>
                  )}

                  {item.status === 'error' && (
                    <div className="text-[10px] text-rose-400 flex items-center gap-1 mt-0.5">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      <span className="truncate">{item.errorMessage}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1.5 shrink-0">
                {item.status === 'idle' && (
                  <button
                    onClick={() => onProcessItem(item.id)}
                    disabled={isProcessingAny}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg cursor-pointer"
                  >
                    <Play className="h-3 w-3 fill-current" />
                    <span>Upscale</span>
                  </button>
                )}

                {item.status === 'processing' && (
                  <div className="flex items-center gap-1 text-xs font-mono text-cyan-400 px-2 py-1">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    <span>Processing</span>
                  </div>
                )}

                {item.status === 'success' && (
                  <>
                    <button
                      onClick={() => onSelectItem(item.id)}
                      className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
                      }`}
                      title="Inspect in comparison slider"
                      aria-label={`Inspect ${item.name}`}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => onDownloadItem(item)}
                      className="p-1.5 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors cursor-pointer"
                      title="Download image"
                      aria-label={`Download ${item.name}`}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}

                <button
                  onClick={() => onRemoveItem(item.id)}
                  disabled={item.status === 'processing'}
                  className="p-1 text-slate-500 hover:text-rose-400 rounded transition-colors cursor-pointer disabled:opacity-40"
                  title="Remove from queue"
                  aria-label={`Remove ${item.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
