import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, ArrowRight, Download, ImageOff, LoaderCircle, MoveHorizontal } from 'lucide-react';
import type { ImageQueueItem } from '../types.ts';
import { sameSettings } from '../../shared/upscale.ts';
interface Props { item: ImageQueueItem; onDownload: (item: ImageQueueItem) => void | Promise<void>; downloadBusy?: boolean }
type Mode = 'compare' | 'result' | 'original';

export function ComparisonSlider({ item, onDownload, downloadBusy = false }: Props) {
  const [mode, setMode] = useState<Mode>('compare');
  const [position, setPosition] = useState(50);
  const [actualSize, setActualSize] = useState(false);
  const [box, setBox] = useState({ width: 640, height: 390 });
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const hasResult = Boolean(item.result);
  const resultNeedsRefresh = Boolean(item.result && !sameSettings(item.result.settings, item.settingsSnapshot));
  const effectiveMode = !hasResult ? 'original' : !item.previewAvailable ? 'result' : mode;
  useEffect(() => { setPosition(50); setActualSize(false); setMode('compare'); }, [item.id]);
  useEffect(() => {
    const element = viewport.current; if (!element) return;
    const observer = new ResizeObserver(() => setBox({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const naturalWidth = item.result?.upscaledWidth ?? item.originalWidth ?? 640;
  const naturalHeight = item.result?.upscaledHeight ?? item.originalHeight ?? 480;
  const fit = Math.min((box.width - 32) / naturalWidth, (box.height - 32) / naturalHeight, 1);
  const width = Math.max(1, actualSize ? naturalWidth : Math.floor(naturalWidth * fit));
  const height = Math.max(1, actualSize ? naturalHeight : Math.floor(naturalHeight * fit));
  const move = (clientX: number) => {
    const rect = canvas.current?.getBoundingClientRect();
    if (rect) setPosition(Math.round(Math.min(100, Math.max(0, (clientX - rect.left) / rect.width * 100))));
  };
  return <div className="comparison">
    <div className="viewer-toolbar">
      <div className="view-tabs" aria-label="Preview mode">{(['compare', 'result', 'original'] as const).map(value => <button key={value} type="button" aria-pressed={effectiveMode === value} disabled={(value !== 'original' && !hasResult) || (value !== 'result' && !item.previewAvailable)} onClick={() => setMode(value)}>{value === 'compare' && <ArrowLeftRight size={14} />}{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
      <div className="zoom-control" aria-label="Preview zoom"><button aria-pressed={!actualSize} onClick={() => setActualSize(false)}>Fit</button><button aria-pressed={actualSize} onClick={() => setActualSize(true)}>100%</button></div>
    </div>
    <div ref={viewport} className={`image-viewport ${actualSize ? 'actual-size' : ''}`} tabIndex={actualSize ? 0 : undefined} aria-label={actualSize ? 'Full resolution preview; scroll to inspect' : undefined}>
      <div className="image-stage" style={{ minWidth: width + 32, minHeight: height + 32 }}>
        {!item.previewAvailable && !hasResult ? <div className="unavailable-preview"><ImageOff size={32} /><strong>No browser preview</strong><span>You can still try upscaling this file.</span></div> :
          <div className="image-canvas" ref={canvas} style={{ width, height }}>
            <img className="preview-image" src={effectiveMode === 'original' ? item.previewUrl : item.result?.url} alt={effectiveMode === 'original' ? 'Original image' : 'Upscaled image'} draggable={false} style={{ imageRendering: item.result?.settings.preset === 'pixel_art' ? 'pixelated' : 'auto' }} />
            {effectiveMode === 'compare' && <>
              <div className="original-layer" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}><img className="preview-image" src={item.previewUrl} alt="Original image for comparison" draggable={false} /></div>
              <div className="comparison-divider" style={{ left: `${position}%` }}>
                <div className="divider-handle" role="slider" tabIndex={0} aria-label="Comparison divider" aria-valuemin={0} aria-valuemax={100} aria-valuenow={position} aria-valuetext={`${position}% original, ${100 - position}% upscaled`}
                  onPointerDown={e => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault(); e.currentTarget.focus(); }}
                  onPointerMove={e => { if (dragging.current) move(e.clientX); }} onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }}
                  onKeyDown={e => {
                    if (['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                      e.preventDefault(); setPosition(p => e.key === 'Home' ? 0 : e.key === 'End' ? 100 : Math.max(0, Math.min(100, p + (['ArrowRight', 'ArrowUp'].includes(e.key) ? 1 : -1) * (e.shiftKey ? 10 : 2))));
                    }
                  }}><MoveHorizontal size={20} /></div>
              </div>
              <span className="image-label original-label">Original</span><span className="image-label result-label">{item.result?.scale}× upscaled</span>
            </>}
          </div>}
      </div>
      {item.status === 'processing' && <div className="processing-overlay" role="status"><span><LoaderCircle className="spin" size={22} />Making room for more.</span><small>Processing your image…</small></div>}
    </div>
    <div className="viewer-footer">
      <div className="image-metadata"><strong>{item.originalWidth ? `${item.originalWidth.toLocaleString()} × ${item.originalHeight?.toLocaleString()}` : 'Original image'}{item.result && <><ArrowRight size={12} className="resolution-arrow" aria-hidden="true" />{item.result.upscaledWidth.toLocaleString()} × {item.result.upscaledHeight.toLocaleString()}</>}</strong><span>{item.result ? `Upscaled in ${(item.result.processingTimeMs / 1000).toFixed(1)}s · ${item.result.settings.format === 'jpg' ? 'JPEG' : item.result.settings.format.toUpperCase()} preview` : 'Original image'}</span></div>
      {item.result ? <button className="button primary download-button" aria-label="Download JPEG with embedded title and keywords" title={resultNeedsRefresh ? 'Upscale again to apply changed settings before downloading.' : item.stockMetadata.title && item.stockMetadata.keywords.length ? 'Title and keywords will be embedded in the JPEG.' : 'Add a title and at least one keyword before downloading.'} disabled={downloadBusy || resultNeedsRefresh || !item.stockMetadata.title.trim() || !item.stockMetadata.keywords.length} onClick={() => void onDownload(item)}>
        {downloadBusy ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}<span>{downloadBusy ? 'Preparing…' : 'Download JPEG'}</span>
      </button> : <span className="preview-caption">Your original, unedited.</span>}
    </div>
  </div>;
}
