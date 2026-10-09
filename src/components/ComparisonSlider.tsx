import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Download,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  SplitSquareVertical,
  Columns,
  Eye,
} from 'lucide-react';
import { ImageQueueItem } from '../types.ts';

interface ComparisonSliderProps {
  item: ImageQueueItem;
  onDownload: (item: ImageQueueItem) => void;
  onDelete: (id: string) => void;
}

export const ComparisonSlider: React.FC<ComparisonSliderProps> = ({
  item,
  onDownload,
  onDelete,
}) => {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [viewMode, setViewMode] = useState<'split' | 'side-by-side' | 'enhanced'>('split');
  const [isZoomed, setIsZoomed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isHoldingOriginal, setIsHoldingOriginal] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  const originalSrc = item.previewUrl;
  const enhancedSrc = item.result?.dataUrl || item.previewUrl;

  const updateSliderPosition = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const pos = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(pos);
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    updateSliderPosition(e.clientX);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDragging) {
      updateSliderPosition(e.clientX);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  };

  // Keyboard shortcut: Spacebar hold to temporarily reveal Original
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        setIsHoldingOriginal(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsHoldingOriginal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const effectiveMode = isHoldingOriginal ? 'original' : viewMode;

  return (
    <div
      className={`flex flex-col rounded-2xl bg-slate-900 border border-slate-800 shadow-xl overflow-hidden transition-all ${
        isFullscreen ? 'fixed inset-0 z-50 rounded-none bg-[#070b12]' : ''
      }`}
    >
      {/* Top Bar: Clean, minimal toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-800 bg-slate-950/80 px-3.5 py-2.5 sm:px-5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs sm:text-sm font-semibold text-white truncate max-w-[150px] sm:max-w-xs">
            {item.name}
          </span>
          <span className="text-xs text-slate-500 font-mono">·</span>
          <span className="text-xs font-mono text-cyan-400 font-medium shrink-0">
            {item.result ? `${item.result.scale}x Enhanced` : 'Original'}
          </span>
        </div>

        {/* View Controls */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center bg-slate-900 p-0.5 rounded-lg border border-slate-800">
            <button
              onClick={() => setViewMode('split')}
              className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                viewMode === 'split'
                  ? 'bg-cyan-500/20 text-cyan-300'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <SplitSquareVertical className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Split</span>
            </button>
            <button
              onClick={() => setViewMode('side-by-side')}
              className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                viewMode === 'side-by-side'
                  ? 'bg-cyan-500/20 text-cyan-300'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Columns className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Side by Side</span>
            </button>
          </div>

          {item.result && (
            <button
              onMouseDown={() => setIsHoldingOriginal(true)}
              onMouseUp={() => setIsHoldingOriginal(false)}
              onTouchStart={() => setIsHoldingOriginal(true)}
              onTouchEnd={() => setIsHoldingOriginal(false)}
              className={`hidden sm:flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors select-none cursor-pointer ${
                isHoldingOriginal
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-slate-900 text-slate-300 border-slate-800 hover:text-white'
              }`}
              title="Hold to view original (Spacebar)"
            >
              <Eye className="h-3 w-3" />
              <span>Hold for Original</span>
            </button>
          )}

          {/* 100% Zoom toggle for pixel inspection */}
          <button
            onClick={() => setIsZoomed(!isZoomed)}
            className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
              isZoomed
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
            }`}
            title="Inspect at 100% actual pixels"
          >
            {isZoomed ? <ZoomOut className="h-3.5 w-3.5" /> : <ZoomIn className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{isZoomed ? 'Fit' : '100% Pixels'}</span>
          </button>

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 text-slate-400 hover:text-white bg-slate-900 border border-slate-800 rounded-lg transition-colors cursor-pointer"
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Main Comparison Canvas */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className={`relative w-full bg-[#070b12] select-none overflow-hidden touch-none ${
          isFullscreen ? 'flex-1 min-h-0' : 'h-[320px] sm:h-[420px] md:h-[480px]'
        }`}
      >
        {/* VIEW: SPLIT SLIDER */}
        {effectiveMode === 'split' && (
          <div className="absolute inset-0 flex items-center justify-center p-2">
            <div
              className={`relative max-h-full max-w-full flex items-center justify-center overflow-hidden ${
                isZoomed ? 'scale-150 origin-center transition-transform duration-200' : ''
              }`}
            >
              {/* Layer 1: Original Image */}
              <img
                src={originalSrc}
                alt="Original"
                referrerPolicy="no-referrer"
                className="max-h-full max-w-full object-contain pointer-events-none block"
              />

              {/* Layer 2: Upscaled Enhanced Image (Clipped) */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  clipPath: `polygon(${sliderPosition}% 0, 100% 0, 100% 100%, ${sliderPosition}% 100%)`,
                }}
              >
                <img
                  src={enhancedSrc}
                  alt="Enhanced"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-contain pointer-events-none block"
                />
              </div>

              {/* Slider Divider Line */}
              <div
                className="absolute top-0 bottom-0 pointer-events-none z-20"
                style={{ left: `${sliderPosition}%` }}
              >
                <div className="absolute top-0 bottom-0 -left-[1px] w-[2px] bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.9)]" />

                {/* Draggable Divider Handle */}
                <div
                  className="pointer-events-auto absolute top-1/2 -left-4 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-400/40 cursor-ew-resize hover:scale-110 active:scale-95 transition-transform"
                  title="Drag left or right"
                >
                  <SplitSquareVertical className="h-4 w-4" />
                </div>
              </div>
            </div>

            {/* Badges */}
            <div className="absolute bottom-3 left-3 z-10 rounded-md bg-slate-950/80 px-2 py-0.5 text-[11px] font-mono text-slate-300 border border-slate-800 pointer-events-none">
              Original ({item.originalWidth ? `${item.originalWidth}×${item.originalHeight}` : 'Before'})
            </div>
            <div className="absolute bottom-3 right-3 z-10 rounded-md bg-cyan-950/90 px-2 py-0.5 text-[11px] font-mono text-cyan-300 border border-cyan-800/80 pointer-events-none font-semibold">
              {item.result ? `${item.result.scale}x Enhanced (${item.result.upscaledWidth}×${item.result.upscaledHeight})` : 'After'}
            </div>
          </div>
        )}

        {/* VIEW: SIDE BY SIDE */}
        {effectiveMode === 'side-by-side' && (
          <div className="grid grid-cols-2 h-full w-full divide-x divide-slate-800">
            <div className="relative flex items-center justify-center p-2 overflow-hidden">
              <img
                src={originalSrc}
                alt="Original"
                referrerPolicy="no-referrer"
                className={`max-h-full max-w-full object-contain ${isZoomed ? 'scale-150' : ''}`}
              />
              <span className="absolute bottom-2 left-2 bg-slate-950/80 px-2 py-0.5 text-[10px] sm:text-xs font-mono text-slate-300 border border-slate-800 rounded">
                Original ({item.originalWidth}×{item.originalHeight})
              </span>
            </div>
            <div className="relative flex items-center justify-center p-2 overflow-hidden bg-slate-950/30">
              <img
                src={enhancedSrc}
                alt="Enhanced"
                referrerPolicy="no-referrer"
                className={`max-h-full max-w-full object-contain ${isZoomed ? 'scale-150' : ''}`}
              />
              <span className="absolute bottom-2 right-2 bg-cyan-950/90 px-2 py-0.5 text-[10px] sm:text-xs font-mono text-cyan-300 border border-cyan-800 rounded font-semibold">
                Enhanced ({item.result?.scale || 2}x · {item.result?.upscaledWidth}×{item.result?.upscaledHeight})
              </span>
            </div>
          </div>
        )}

        {/* VIEW: ORIGINAL (HOLD) */}
        {effectiveMode === 'original' && (
          <div className="h-full w-full flex items-center justify-center p-2">
            <img
              src={originalSrc}
              alt="Original"
              referrerPolicy="no-referrer"
              className={`max-h-full max-w-full object-contain ${isZoomed ? 'scale-150' : ''}`}
            />
            <span className="absolute bottom-3 left-3 bg-amber-950/90 px-2.5 py-1 text-xs font-mono text-amber-300 border border-amber-800 rounded font-semibold">
              Original Unprocessed Source
            </span>
          </div>
        )}
      </div>

      {/* Bottom Telemetry & Download Action Bar */}
      <div className="border-t border-slate-800 bg-slate-950/90 px-3.5 py-2.5 sm:px-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Metadata */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
            {item.result ? (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Resolution:</span>
                  <span className="font-mono tabular-nums text-slate-400">
                    {item.result.originalWidth}×{item.result.originalHeight}
                  </span>
                  <span className="text-cyan-400 font-bold">→</span>
                  <span className="font-mono tabular-nums font-bold text-cyan-300">
                    {item.result.upscaledWidth}×{item.result.upscaledHeight} ({item.result.scale}x)
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Size:</span>
                  <span className="font-mono tabular-nums text-slate-400">
                    {formatBytes(item.result.originalSize)}
                  </span>
                  <span className="text-cyan-400">→</span>
                  <span className="font-mono tabular-nums text-cyan-300 font-semibold">
                    {formatBytes(item.result.upscaledSize)}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Time:</span>
                  <span className="font-mono tabular-nums text-emerald-400">
                    {item.result.processingTimeMs}ms
                  </span>
                </div>
              </>
            ) : (
              <div>
                <span className="text-slate-500">Original: </span>
                <span className="font-mono text-slate-300">
                  {item.originalWidth && item.originalHeight ? `${item.originalWidth}×${item.originalHeight} px · ` : ''}
                  {formatBytes(item.originalSize)}
                </span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
            {item.result && (
              <>
                <button
                  onClick={() => onDownload(item)}
                  className="flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg shadow-md shadow-cyan-400/20 transition-all hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
                >
                  <Download className="h-4 w-4" />
                  <span>Download Image</span>
                </button>
              </>
            )}

            <button
              onClick={() => onDelete(item.id)}
              className="p-2 text-slate-400 hover:text-rose-400 bg-slate-800/80 hover:bg-rose-950/40 border border-slate-700/80 hover:border-rose-800/60 rounded-lg transition-colors cursor-pointer"
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
