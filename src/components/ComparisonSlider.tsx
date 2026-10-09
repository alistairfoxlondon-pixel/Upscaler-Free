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
  RotateCcw,
  Sparkles,
  Check,
  Search,
} from 'lucide-react';
import { ImageQueueItem } from '../types.ts';

interface ComparisonSliderProps {
  item: ImageQueueItem;
  onDownload: (item: ImageQueueItem) => void;
  onDelete: (id: string) => void;
  autoDeleteOnDownload: boolean;
  onReUpscale?: () => void;
  isProcessing?: boolean;
}

type ViewMode = 'split' | 'side-by-side' | 'enhanced' | 'original';

export const ComparisonSlider: React.FC<ComparisonSliderProps> = ({
  item,
  onDownload,
  onDelete,
  autoDeleteOnDownload,
  onReUpscale,
  isProcessing = false,
}) => {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  // Default to 1.5x so user immediately sees pixel details rather than a tiny shrunk-down view
  const [zoomLevel, setZoomLevel] = useState<number>(item.result ? 1.5 : 1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [startPan, setStartPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isHoldingOriginal, setIsHoldingOriginal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Magnifier Loupe state
  const [isLoupeActive, setIsLoupeActive] = useState(false);
  const [loupePos, setLoupePos] = useState<{ x: number; y: number; pctX: number; pctY: number }>({
    x: 0,
    y: 0,
    pctX: 50,
    pctY: 50,
  });
  const [isHoveringImage, setIsHoveringImage] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  const originalSrc = item.previewUrl;
  const enhancedSrc = item.result ? item.result.downloadUrl : item.previewUrl;

  const handlePointerDown = (e: React.PointerEvent) => {
    if (viewMode !== 'split') return;
    setIsDragging(true);
    updateSliderPosition(e.clientX);
  };

  const updateSliderPosition = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const pos = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(pos);
  }, []);

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

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (isDragging) {
        updateSliderPosition(e.clientX);
      } else if (isPanning) {
        setPanOffset({
          x: e.clientX - startPan.x,
          y: e.clientY - startPan.y,
        });
      }
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      setIsPanning(false);
    };

    if (isDragging || isPanning) {
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    }
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isDragging, isPanning, startPan, updateSliderPosition]);

  const handleStartPan = (e: React.MouseEvent) => {
    if (zoomLevel > 1 && !isDragging && !isLoupeActive) {
      setIsPanning(true);
      setStartPan({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    }
  };

  const handleMouseMoveContainer = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pctX = Math.max(0, Math.min(100, (x / rect.width) * 100));
    const pctY = Math.max(0, Math.min(100, (y / rect.height) * 100));

    setLoupePos({ x, y, pctX, pctY });
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const handleCopyLink = () => {
    if (item.result?.downloadUrl) {
      const fullUrl = `${window.location.origin}${item.result.downloadUrl}`;
      navigator.clipboard.writeText(fullUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const setZoom = (level: number) => {
    setZoomLevel(level);
    if (level === 1) {
      setPanOffset({ x: 0, y: 0 });
    }
  };

  const effectiveMode = isHoldingOriginal ? 'original' : viewMode;

  return (
    <div
      className={`flex flex-col rounded-2xl bg-slate-900 border border-slate-800 shadow-xl overflow-hidden transition-all ${
        isFullscreen ? 'fixed inset-0 z-50 rounded-none bg-[#070b12]' : ''
      }`}
    >
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/80 px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-white truncate max-w-[180px] sm:max-w-xs">
            {item.name}
          </span>
          <span className="text-xs text-slate-500 font-mono">·</span>
          <span className="text-xs font-mono text-cyan-400 shrink-0 font-semibold">
            {item.result ? `${item.result.scale}x Super-Resolution` : 'Source Preview'}
          </span>
        </div>

        {/* View Mode Controls */}
        <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
          <button
            onClick={() => {
              setViewMode('split');
              setIsLoupeActive(false);
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              viewMode === 'split' && !isLoupeActive
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <SplitSquareVertical className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Split Slider</span>
          </button>
          <button
            onClick={() => {
              setViewMode('side-by-side');
              setIsLoupeActive(false);
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              viewMode === 'side-by-side' && !isLoupeActive
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Columns className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Side by Side</span>
          </button>
          <button
            onClick={() => {
              setViewMode('enhanced');
              setIsLoupeActive(false);
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              viewMode === 'enhanced' && !isLoupeActive
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Enhanced</span>
          </button>
          <button
            onClick={() => {
              setViewMode('original');
              setIsLoupeActive(false);
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              viewMode === 'original' && !isLoupeActive
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Original</span>
          </button>
        </div>

        {/* Zoom, Loupe, and Hold-for-Before Tool */}
        <div className="flex items-center gap-1.5">
          {item.result && (
            <>
              {/* Magnifier Loupe Lens Toggle */}
              <button
                onClick={() => setIsLoupeActive(!isLoupeActive)}
                className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                  isLoupeActive
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-sm shadow-cyan-500/20'
                    : 'bg-slate-900 text-slate-300 border-slate-800 hover:text-white'
                }`}
                title="Toggle 4x Detail Inspection Loupe"
              >
                <Search className="h-3 w-3" />
                <span className="hidden sm:inline">4x Loupe</span>
              </button>

              {/* Spacebar / Click Hold for Before */}
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
                title="Press & hold Spacebar or mouse to view original"
              >
                <Eye className="h-3 w-3" />
                <span>Hold for Before</span>
              </button>
            </>
          )}

          {/* Zoom Presets: Fit, 1.5x, 2.5x, 4x */}
          <div className="flex items-center bg-slate-900 p-0.5 rounded-lg border border-slate-800">
            <button
              onClick={() => setZoom(1)}
              className={`px-2 py-1 text-xs font-mono rounded cursor-pointer ${
                zoomLevel === 1 ? 'text-cyan-400 bg-slate-800 font-bold' : 'text-slate-400 hover:text-white'
              }`}
              title="Fit to Container"
            >
              Fit
            </button>
            <button
              onClick={() => setZoom(1.5)}
              className={`px-2 py-1 text-xs font-mono rounded cursor-pointer ${
                zoomLevel === 1.5 ? 'text-cyan-400 bg-slate-800 font-bold' : 'text-slate-400 hover:text-white'
              }`}
              title="150% Pixel Detail"
            >
              1.5x
            </button>
            <button
              onClick={() => setZoom(2.5)}
              className={`px-2 py-1 text-xs font-mono rounded cursor-pointer ${
                zoomLevel === 2.5 ? 'text-cyan-400 bg-slate-800 font-bold' : 'text-slate-400 hover:text-white'
              }`}
              title="250% Pixel Zoom"
            >
              2.5x
            </button>
            <button
              onClick={() => setZoom(4)}
              className={`px-2 py-1 text-xs font-mono rounded cursor-pointer ${
                zoomLevel === 4 ? 'text-cyan-400 bg-slate-800 font-bold' : 'text-slate-400 hover:text-white'
              }`}
              title="400% Extreme Zoom"
            >
              4x
            </button>
          </div>

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 text-slate-400 hover:text-white bg-slate-900 border border-slate-800 rounded-lg transition-colors cursor-pointer"
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Main Viewport */}
      <div
        ref={containerRef}
        onMouseDown={handleStartPan}
        onMouseMove={handleMouseMoveContainer}
        onMouseEnter={() => setIsHoveringImage(true)}
        onMouseLeave={() => setIsHoveringImage(false)}
        className={`relative w-full bg-[#070b12] select-none overflow-hidden ${
          isFullscreen ? 'flex-1 min-h-0' : 'h-[460px] sm:h-[550px]'
        } ${zoomLevel > 1 && !isLoupeActive ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
      >
        {/* VIEW MODE: SPLIT SLIDER */}
        {effectiveMode === 'split' && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              transform: `scale(${zoomLevel}) translate(${panOffset.x / zoomLevel}px, ${panOffset.y / zoomLevel}px)`,
              transformOrigin: 'center center',
              transition: isPanning ? 'none' : 'transform 0.15s ease-out',
            }}
          >
            {/* Base layer: Original image (left) */}
            <img
              src={originalSrc}
              alt="Original"
              referrerPolicy="no-referrer"
              className="absolute max-h-full max-w-full object-contain pointer-events-none"
            />

            {/* Top clipped layer: Enhanced image (right) */}
            <div
              className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none"
              style={{
                clipPath: `polygon(${sliderPosition}% 0, 100% 0, 100% 100%, ${sliderPosition}% 100%)`,
              }}
            >
              <img
                src={enhancedSrc}
                alt="Enhanced"
                referrerPolicy="no-referrer"
                className="absolute max-h-full max-w-full object-contain"
              />
            </div>

            {/* Split divider line */}
            <div
              className="absolute top-0 bottom-0 z-20 pointer-events-none"
              style={{ left: `${sliderPosition}%` }}
            >
              <div className="absolute top-0 bottom-0 -left-[1px] w-[2px] bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.8)]" />

              {/* Slider Grab Handle */}
              <div
                onPointerDown={handlePointerDown}
                className="pointer-events-auto absolute top-1/2 -left-4 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-400/40 cursor-ew-resize hover:scale-110 active:scale-95 transition-transform"
                title="Drag left or right to compare"
              >
                <SplitSquareVertical className="h-4 w-4" />
              </div>
            </div>

            {/* Clean metadata markers */}
            <div className="absolute bottom-3 left-3 z-10 rounded-md bg-slate-950/80 px-2.5 py-1 text-xs font-mono text-slate-300 border border-slate-800 backdrop-blur-sm pointer-events-none">
              Before ({item.originalWidth ? `${item.originalWidth}×${item.originalHeight}` : 'Original'})
            </div>
            <div className="absolute bottom-3 right-3 z-10 rounded-md bg-cyan-950/90 px-2.5 py-1 text-xs font-mono text-cyan-300 border border-cyan-800/80 backdrop-blur-sm pointer-events-none font-semibold">
              After {item.result ? `(${item.result.upscaledWidth}×${item.result.upscaledHeight})` : ''}
            </div>
          </div>
        )}

        {/* VIEW MODE: SIDE BY SIDE */}
        {effectiveMode === 'side-by-side' && (
          <div className="grid grid-cols-2 h-full w-full divide-x divide-slate-800">
            <div className="relative flex items-center justify-center p-2 overflow-hidden">
              <img
                src={originalSrc}
                alt="Original"
                referrerPolicy="no-referrer"
                className="max-h-full max-w-full object-contain"
                style={{
                  transform: `scale(${zoomLevel}) translate(${panOffset.x / zoomLevel}px, ${panOffset.y / zoomLevel}px)`,
                }}
              />
              <span className="absolute bottom-3 left-3 bg-slate-950/80 px-2.5 py-1 text-xs font-mono text-slate-300 border border-slate-800 rounded">
                Before ({item.originalWidth}×{item.originalHeight})
              </span>
            </div>
            <div className="relative flex items-center justify-center p-2 overflow-hidden bg-slate-950/30">
              <img
                src={enhancedSrc}
                alt="Enhanced"
                referrerPolicy="no-referrer"
                className="max-h-full max-w-full object-contain"
                style={{
                  transform: `scale(${zoomLevel}) translate(${panOffset.x / zoomLevel}px, ${panOffset.y / zoomLevel}px)`,
                }}
              />
              <span className="absolute bottom-3 right-3 bg-cyan-950/90 px-2.5 py-1 text-xs font-mono text-cyan-300 border border-cyan-800 rounded font-semibold">
                After ({item.result?.scale || 2}x · {item.result?.upscaledWidth}×{item.result?.upscaledHeight})
              </span>
            </div>
          </div>
        )}

        {/* VIEW MODE: ENHANCED ONLY */}
        {effectiveMode === 'enhanced' && (
          <div className="h-full w-full flex items-center justify-center p-3">
            <img
              src={enhancedSrc}
              alt="Enhanced"
              referrerPolicy="no-referrer"
              className="max-h-full max-w-full object-contain"
              style={{
                transform: `scale(${zoomLevel}) translate(${panOffset.x / zoomLevel}px, ${panOffset.y / zoomLevel}px)`,
              }}
            />
            <span className="absolute bottom-3 right-3 bg-cyan-950/90 px-2.5 py-1 text-xs font-mono text-cyan-300 border border-cyan-800 rounded font-semibold">
              Enhanced ({item.result?.scale || 2}x)
            </span>
          </div>
        )}

        {/* VIEW MODE: ORIGINAL ONLY */}
        {effectiveMode === 'original' && (
          <div className="h-full w-full flex items-center justify-center p-3">
            <img
              src={originalSrc}
              alt="Original"
              referrerPolicy="no-referrer"
              className="max-h-full max-w-full object-contain"
              style={{
                transform: `scale(${zoomLevel}) translate(${panOffset.x / zoomLevel}px, ${panOffset.y / zoomLevel}px)`,
              }}
            />
            <span className="absolute bottom-3 left-3 bg-amber-950/80 px-2.5 py-1 text-xs font-mono text-amber-300 border border-amber-800 rounded">
              Original Source
            </span>
          </div>
        )}

        {/* INTERACTIVE 4X MAGNIFIER LOUPE LENS */}
        {isLoupeActive && isHoveringImage && item.result && (
          <div
            className="pointer-events-none absolute z-30 rounded-full border-2 border-cyan-400 shadow-2xl shadow-cyan-500/50 overflow-hidden bg-slate-950"
            style={{
              width: '180px',
              height: '180px',
              left: `${loupePos.x - 90}px`,
              top: `${loupePos.y - 90}px`,
            }}
          >
            {/* Split inside the Loupe */}
            <div className="relative w-full h-full">
              {/* Left half: Original low-res */}
              <div
                className="absolute inset-0 overflow-hidden"
                style={{
                  clipPath: 'polygon(0 0, 50% 0, 50% 100%, 0 100%)',
                }}
              >
                <img
                  src={originalSrc}
                  alt="Original Crop"
                  className="absolute max-w-none"
                  style={{
                    width: '600%',
                    height: '600%',
                    left: `${-loupePos.pctX * 6 + 90}px`,
                    top: `${-loupePos.pctY * 6 + 90}px`,
                    objectFit: 'contain',
                  }}
                />
              </div>

              {/* Right half: Upscaled high-res */}
              <div
                className="absolute inset-0 overflow-hidden"
                style={{
                  clipPath: 'polygon(50% 0, 100% 0, 100% 100%, 50% 100%)',
                }}
              >
                <img
                  src={enhancedSrc}
                  alt="Enhanced Crop"
                  className="absolute max-w-none"
                  style={{
                    width: '600%',
                    height: '600%',
                    left: `${-loupePos.pctX * 6 + 90}px`,
                    top: `${-loupePos.pctY * 6 + 90}px`,
                    objectFit: 'contain',
                  }}
                />
              </div>

              {/* Loupe Split Divider */}
              <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[2px] bg-cyan-300" />

              {/* Micro-labels inside the Loupe */}
              <span className="absolute bottom-1.5 left-2 text-[9px] font-mono text-slate-400 bg-black/60 px-1 rounded">
                Orig
              </span>
              <span className="absolute bottom-1.5 right-2 text-[9px] font-mono text-cyan-300 bg-black/60 px-1 rounded">
                {item.result.scale}x
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Telemetry & Primary Actions */}
      <div className="border-t border-slate-800 bg-slate-950/90 px-4 py-3 sm:px-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Metadata figures */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-slate-400">
            {item.result ? (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Dimensions:</span>
                  <span className="font-mono tabular-nums text-slate-400">
                    {item.result.originalWidth}×{item.result.originalHeight}
                  </span>
                  <span className="text-cyan-400">→</span>
                  <span className="font-mono tabular-nums font-bold text-cyan-300">
                    {item.result.upscaledWidth}×{item.result.upscaledHeight} ({item.result.scale}x)
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">File Size:</span>
                  <span className="font-mono tabular-nums text-slate-400">
                    {formatBytes(item.result.originalSize)}
                  </span>
                  <span className="text-cyan-400">→</span>
                  <span className="font-mono tabular-nums text-cyan-300 font-semibold">
                    {formatBytes(item.result.upscaledSize)}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Processing Time:</span>
                  <span className="font-mono tabular-nums text-emerald-400">
                    {item.result.processingTimeMs}ms
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Format:</span>
                  <span className="font-mono uppercase text-slate-300">
                    {item.result.format}
                  </span>
                </div>
              </>
            ) : (
              <div>
                <span className="text-slate-500">Source Size: </span>
                <span className="font-mono text-slate-300">
                  {item.originalWidth && item.originalHeight ? `${item.originalWidth}×${item.originalHeight} px · ` : ''}
                  {formatBytes(item.originalSize)}
                </span>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2.5 self-end md:self-auto shrink-0">
            {item.result && (
              <>
                <button
                  onClick={handleCopyLink}
                  className="px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-750 border border-slate-700 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                  title="Copy share link"
                >
                  {copiedLink ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : null}
                  <span>{copiedLink ? 'Copied' : 'Share'}</span>
                </button>

                <button
                  onClick={() => onDownload(item)}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg shadow-md shadow-cyan-400/20 transition-all hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
                >
                  <Download className="h-4 w-4" />
                  <span>Download Enhanced</span>
                </button>
              </>
            )}

            <button
              onClick={() => onDelete(item.id)}
              className="p-2 text-slate-400 hover:text-rose-400 bg-slate-800/80 hover:bg-rose-950/40 border border-slate-700/80 hover:border-rose-800/60 rounded-lg transition-colors cursor-pointer"
              title="Delete from cloud memory"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
