import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Columns2,
  Download,
  Eye,
  Maximize2,
  Minimize2,
  RefreshCw,
  Scissors,
  SplitSquareVertical,
  Trash2,
  X,
  ZoomIn,
} from 'lucide-react';
import type { ImageQueueItem } from '../types.ts';
import { formatBytes, formatMs } from '../lib/format.ts';

interface ComparisonSliderProps {
  item: ImageQueueItem;
  onDownload: (item: ImageQueueItem) => void;
  onDelete: (id: string) => void;
}

export const ComparisonSlider: React.FC<ComparisonSliderProps> = ({ item, onDownload, onDelete }) => {
  const [split, setSplit] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<'split' | 'side'>('split');
  const [zoomed, setZoomed] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const boxRef = useRef<HTMLDivElement>(null);

  const hasResult = Boolean(item.result);
  const originalSrc = item.previewUrl;
  const enhancedSrc = item.result?.dataUrl ?? item.previewUrl;

  // Pixel size of the comparison box: enhanced native size (or original while idle).
  const boxW = item.result?.upscaledWidth ?? item.originalWidth ?? 0;
  const boxH = item.result?.upscaledHeight ?? item.originalHeight ?? 0;

  const updateSplit = useCallback((clientX: number) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setSplit(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFullscreen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // Hold Space to compare with the original (ignored while typing or on controls).
  useEffect(() => {
    const editable = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return el.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'SELECT';
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && hasResult && !editable(e.target)) {
        e.preventDefault();
        setPeeking(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setPeeking(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [hasResult]);

  const showOriginal = peeking || !hasResult;
  const zoomActive = zoomed && hasResult && boxW > 0;

  const imgFit = 'pointer-events-none absolute inset-0 h-full w-full object-contain';
  const imgZoom = 'pointer-events-none absolute inset-0 h-full w-full object-fill';

  const layers = (
    <div
      ref={boxRef}
      className={`relative ${zoomActive ? 'm-auto shrink-0' : 'h-full w-full'}`}
      style={zoomActive ? { width: boxW, height: boxH } : undefined}
      onPointerDown={(e) => {
        if (view !== 'split' || showOriginal) return;
        setDragging(true);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        updateSplit(e.clientX);
      }}
      onPointerMove={(e) => dragging && view === 'split' && updateSplit(e.clientX)}
      onPointerUp={(e) => {
        setDragging(false);
        try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      }}
    >
      <img
        src={originalSrc}
        alt="Original"
        referrerPolicy="no-referrer"
        draggable={false}
        className={`${zoomActive ? imgZoom : imgFit} ${zoomActive ? '[image-rendering:pixelated]' : ''}`}
      />
      {!showOriginal && view === 'split' && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{ clipPath: `polygon(${split}% 0, 100% 0, 100% 100%, ${split}% 100%)` }}
        >
          <img
            src={enhancedSrc}
            alt="Enhanced"
            referrerPolicy="no-referrer"
            draggable={false}
            className={zoomActive ? imgZoom : imgFit}
          />
        </div>
      )}
      {!showOriginal && view === 'split' && (
        <div
          className={`pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 cursor-ew-resize bg-brand ${dragging ? '' : 'transition-[left] duration-75'}`}
          style={{ left: `calc(${split}% - 1px)` }}
        >
          <span className="absolute top-1/2 left-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-brand text-white shadow-md">
            <SplitSquareVertical className="h-3.5 w-3.5" />
          </span>
        </div>
      )}
    </div>
  );

  return (
    <div className={`flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm ${fullscreen ? 'fixed inset-0 z-50 rounded-none' : ''}`}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="max-w-[180px] truncate text-xs font-semibold text-ink sm:max-w-[320px]">{item.name}</span>
          {hasResult && (
            <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 font-mono text-[10px] font-semibold text-brand">
              {item.result!.scale}×{item.result!.contentKind ? ` · ${item.result!.contentKind}` : ''}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {hasResult && (
            <>
              <div className="mr-0.5 flex rounded-lg border border-line p-0.5">
                <button
                  onClick={() => setView('split')}
                  title="Split comparison — drag the divider"
                  aria-label="Split comparison"
                  className={`cursor-pointer rounded-md p-1.5 transition ${view === 'split' ? 'bg-brand-soft text-brand' : 'text-ink-faint hover:text-ink'}`}
                >
                  <SplitSquareVertical className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setView('side')}
                  title="Side by side"
                  aria-label="Side by side"
                  className={`cursor-pointer rounded-md p-1.5 transition ${view === 'side' ? 'bg-brand-soft text-brand' : 'text-ink-faint hover:text-ink'}`}
                >
                  <Columns2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <button
                onClick={() => setZoomed(!zoomed)}
                title={zoomed ? 'Fit to window' : 'Zoom to 1:1 pixels, then scroll'}
                aria-label="Toggle 1:1 pixel zoom"
                className={`cursor-pointer rounded-lg border p-1.5 transition ${
                  zoomed ? 'border-brand/40 bg-brand-soft text-brand' : 'border-line text-ink-faint hover:text-ink'
                }`}
              >
                {zoomed ? <Minimize2 className="h-3.5 w-3.5" /> : <ZoomIn className="h-3.5 w-3.5" />}
              </button>
              <button
                onMouseDown={() => setPeeking(true)}
                onMouseUp={() => setPeeking(false)}
                onMouseLeave={() => setPeeking(false)}
                onTouchStart={() => setPeeking(true)}
                onTouchEnd={() => setPeeking(false)}
                title="Hold to see the original (or hold Space)"
                aria-label="Hold to see the original"
                className={`hidden cursor-pointer touch-none rounded-lg border p-1.5 transition select-none sm:block ${
                  peeking ? 'border-brand/40 bg-brand-soft text-brand' : 'border-line text-ink-faint hover:text-ink'
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          <button
            onClick={() => setFullscreen(!fullscreen)}
            title={fullscreen ? 'Exit full screen (Esc)' : 'Full screen'}
            aria-label="Toggle full screen"
            className="cursor-pointer rounded-lg border border-line p-1.5 text-ink-faint transition hover:text-ink"
          >
            {fullscreen ? <X className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        className={`transparency-grid relative flex w-full items-center justify-center p-2 ${
          fullscreen ? 'min-h-0 flex-1' : 'h-[300px] sm:h-[420px]'
        } ${zoomActive ? 'cursor-grab overflow-auto' : 'overflow-hidden'}`}
      >
        {view === 'side' && hasResult ? (
          <div className="grid h-full w-full grid-cols-2 gap-2">
            {[
              { label: 'Original', src: originalSrc, dims: `${item.originalWidth ?? '?'}×${item.originalHeight ?? '?'}`, pixelate: zoomActive },
              { label: `${item.result!.scale}× upscaled`, src: enhancedSrc, dims: `${item.result!.upscaledWidth}×${item.result!.upscaledHeight}`, pixelate: false },
            ].map((pane) => (
              <figure
                key={pane.label}
                className={`relative flex min-w-0 items-center justify-center rounded-lg ${zoomActive ? 'overflow-auto' : 'overflow-hidden'}`}
              >
                {zoomActive ? (
                  <img
                    src={pane.src}
                    alt={pane.label}
                    referrerPolicy="no-referrer"
                    draggable={false}
                    style={{ width: boxW, height: boxH }}
                    className={`pointer-events-none m-auto shrink-0 object-fill ${pane.pixelate ? '[image-rendering:pixelated]' : ''}`}
                  />
                ) : (
                  <img src={pane.src} alt={pane.label} referrerPolicy="no-referrer" draggable={false} className="pointer-events-none max-h-full max-w-full object-contain" />
                )}
                <figcaption className="absolute bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-ink/70 px-2 py-0.5 font-mono text-[10px] whitespace-nowrap text-white tabular-nums">
                  {pane.label} · {pane.dims}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className={`flex ${zoomActive ? 'min-h-full w-full' : 'h-full w-full'} items-center justify-center ${zoomActive ? 'min-w-full' : ''}`}>
            {layers}
          </div>
        )}

        {/* Overlays */}
        {item.status === 'processing' && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-ink/45 backdrop-blur-[2px]">
            <RefreshCw className="h-6 w-6 animate-spin text-white" />
            <p className="text-xs font-medium text-white">Upscaling in the cloud…</p>
            <div className="h-1 w-40 overflow-hidden rounded-full bg-white/25">
              <div className="h-full bg-white transition-all duration-300" style={{ width: `${Math.max(8, item.progress)}%` }} />
            </div>
          </div>
        )}
        {item.status === 'error' && (
          <div className="absolute inset-x-3 bottom-3 z-20 mx-auto flex max-w-md items-start gap-2 rounded-xl border border-red-200 bg-white p-3 shadow-lg">
            <X className="mt-0.5 h-4 w-4 shrink-0 text-err" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-ink">Couldn't upscale this image</p>
              <p className="mt-0.5 text-[11px] break-words text-ink-soft">{item.errorMessage}</p>
            </div>
          </div>
        )}
        {!hasResult && item.status === 'idle' && (
          <span className="absolute bottom-2.5 left-1/2 z-10 -translate-x-1/2 rounded-full bg-ink/70 px-2.5 py-0.5 text-[11px] font-medium text-white">
            Press Upscale to start
          </span>
        )}
      </div>

      {/* Status & actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-ink-soft tabular-nums">
          {hasResult ? (
            <>
              <span>{item.result!.originalWidth}×{item.result!.originalHeight} · {formatBytes(item.result!.originalSize)}</span>
              <span className="text-brand">→</span>
              <span className="font-semibold text-ink">{item.result!.upscaledWidth}×{item.result!.upscaledHeight} · {formatBytes(item.result!.upscaledSize)}</span>
              <span className="text-ink-faint">{formatMs(item.result!.processingTimeMs)}</span>
            </>
          ) : (
            <span>
              {item.originalWidth ? `${item.originalWidth}×${item.originalHeight} · ` : ''}
              {formatBytes(item.originalSize)}
            </span>
          )}
        </p>
        <div className="flex items-center gap-1.5">
          {hasResult && (
            <button
              onClick={() => onDownload(item)}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong"
            >
              <Download className="h-3.5 w-3.5" /> Download
            </button>
          )}
          <button
            onClick={() => onDelete(item.id)}
            title="Remove image"
            aria-label="Remove image"
            className="cursor-pointer rounded-lg border border-line p-1.5 text-ink-faint transition hover:border-red-200 hover:bg-red-50 hover:text-err"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          {hasResult && !zoomed && view === 'split' && (
            <span className="hidden items-center gap-1 text-[10px] text-ink-faint lg:flex">
              <Scissors className="h-3 w-3" /> drag the line
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
