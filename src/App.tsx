import { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import { CheckCircle2, Play, RefreshCw, X, Layers, Sparkles, Plus } from 'lucide-react';
import { Header } from './components/Header.tsx';
import { UploadZone } from './components/UploadZone.tsx';
import { SettingsPanel } from './components/SettingsPanel.tsx';
import { ComparisonSlider } from './components/ComparisonSlider.tsx';
import { BatchQueue } from './components/BatchQueue.tsx';
import { OpenSourceDocsModal } from './components/OpenSourceDocsModal.tsx';
import { type SampleItem } from './data/samples.ts';
import { checkOutputLimits, MAX_BATCH_SIZE, MAX_INPUT_BYTES } from '@/server/presets.ts';
import { formatMs } from './lib/format.ts';
import { DEFAULT_SETTINGS, type ImageQueueItem, type UpscaleResultData, type UpscaleSettings } from './types.ts';

const SETTINGS_KEY = 'openupscale.settings.v2';

function loadSettings(): UpscaleSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<UpscaleSettings>;
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    if (![2, 4, 8].includes(merged.scale)) merged.scale = DEFAULT_SETTINGS.scale;
    if (!['auto', 'photo', 'digital_art', 'anime', 'document', 'custom'].includes(merged.preset)) merged.preset = 'auto';
    if (!['jpg', 'png', 'webp'].includes(merged.format)) merged.format = 'png';
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface Toast {
  message: string;
  kind: 'ok' | 'error' | 'info';
}

export default function App() {
  const [settings, setSettings] = useState<UpscaleSettings>(loadSettings);
  const [queue, setQueue] = useState<ImageQueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDocsOpen, setIsDocsOpen] = useState(false);
  const [isGeneratingZip, setIsGeneratingZip] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const queueRef = useRef(queue);
  const settingsRef = useRef(settings);
  const toastTimer = useRef<number | undefined>(undefined);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
  }, [settings]);

  const showToast = useCallback((message: string, kind: Toast['kind'] = 'ok') => {
    window.clearTimeout(toastTimer.current);
    setToast({ message, kind });
    toastTimer.current = window.setTimeout(() => setToast(null), 3800);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const getImageDimensions = (url: string): Promise<{ width: number; height: number }> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: 0, height: 0 });
      img.src = url;
    });

  const updateItem = useCallback((id: string, patch: Partial<ImageQueueItem>) => {
    setQueue((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }, []);

  /* ---------------- Adding files ---------------- */

  const handleFilesSelected = useCallback(async (files: File[]) => {
    const slots = Math.max(0, MAX_BATCH_SIZE - queueRef.current.length);
    if (slots === 0) {
      showToast(`Queue is full (${MAX_BATCH_SIZE} images)`, 'error');
      return;
    }
    const images = files.filter((file) =>
      file.type.startsWith('image/') && file.type !== 'image/svg+xml' && file.size <= MAX_INPUT_BYTES
    );
    const accepted = images.slice(0, slots);
    const skipped = files.length - accepted.length;
    if (skipped > 0) {
      showToast(`Skipped ${skipped} file(s) — images only, 4 MB max, ${MAX_BATCH_SIZE} per batch`, 'info');
    }

    const newItems: ImageQueueItem[] = [];
    for (const file of accepted) {
      const previewUrl = URL.createObjectURL(file);
      const dims = await getImageDimensions(previewUrl);
      newItems.push({
        id: crypto.randomUUID(),
        name: file.name || 'pasted-image',
        file,
        previewUrl,
        originalWidth: dims.width || undefined,
        originalHeight: dims.height || undefined,
        originalSize: file.size,
        status: 'idle',
        progress: 0,
        settingsSnapshot: { ...settingsRef.current },
      });
    }
    if (newItems.length === 0) return;
    setQueue((prev) => [...prev, ...newItems]);
    setSelectedId(newItems[0].id);
    showToast(`Added ${newItems.length} image${newItems.length > 1 ? 's' : ''}`);
  }, [showToast]);

  const handleSampleSelect = useCallback(async (sample: SampleItem) => {
    try {
      const response = await fetch(sample.url);
      if (!response.ok) throw new Error('sample unavailable');
      const blob = await response.blob();
      await handleFilesSelected([new File([blob], `${sample.id}.jpg`, { type: blob.type || 'image/jpeg' })]);
    } catch {
      showToast('Could not load that sample', 'error');
    }
  }, [handleFilesSelected, showToast]);

  // Paste anywhere (Ctrl/Cmd+V)
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (!event.clipboardData) return;
      const files: File[] = [];
      for (const item of event.clipboardData.items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) void handleFilesSelected(files);
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handleFilesSelected]);

  /* ---------------- Processing ---------------- */

  const processItem = useCallback(async (id: string, opts: UpscaleSettings): Promise<boolean> => {
    const item = queueRef.current.find((i) => i.id === id);
    if (!item || item.status === 'processing') return false;

    const limit = checkOutputLimits(item.originalWidth, item.originalHeight, opts.scale);
    if (!limit.ok) {
      updateItem(id, { status: 'error', progress: 0, errorMessage: limit.message });
      showToast('That output exceeds the safety limits', 'error');
      return false;
    }

    updateItem(id, { status: 'processing', progress: 10, errorMessage: undefined, settingsSnapshot: opts });

    try {
      let uploadFile = item.file;
      if (!uploadFile) {
        const sampleResponse = await fetch(item.previewUrl);
        if (!sampleResponse.ok) throw new Error('Could not load the sample image');
        const blob = await sampleResponse.blob();
        uploadFile = new File([blob], item.name, { type: blob.type || 'image/jpeg' });
      }

      const form = new FormData();
      form.append('file', uploadFile, item.name);
      form.append('scale', String(opts.scale));
      form.append('preset', opts.preset);
      form.append('format', opts.format);
      if (opts.format !== 'png') form.append('quality', String(opts.quality));
      // Enhancement sliders only ship when the user tuned them ("Custom");
      // otherwise the server applies the benchmark-tuned defaults per mode.
      if (opts.preset === 'custom') {
        form.append('sharpness', String(opts.sharpness));
        form.append('denoise', String(opts.denoise));
        form.append('detailBoost', String(opts.detailBoost));
      }
      if (opts.contrast !== 0) form.append('contrast', String(opts.contrast));
      if (opts.brightness !== 0) form.append('brightness', String(opts.brightness));
      if (opts.saturation !== 0) form.append('saturation', String(opts.saturation));

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 55_000);
      let response: Response;
      try {
        response = await fetch('/api/upscale', { method: 'POST', body: form, signal: controller.signal });
        updateItem(id, { progress: 45 });
      } finally {
        window.clearTimeout(timeout);
      }

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || `Processing failed (${response.status})`);
      }
      const encoded = response.headers.get('x-upscale-metadata');
      if (!encoded) throw new Error('The server response is missing image metadata');
      const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const metadata = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
      const blob = await response.blob();
      if (!blob.size) throw new Error('The server returned an empty image');

      // Drop the result if the item was removed while processing.
      if (!queueRef.current.some((i) => i.id === id)) return;

      const resultUrl = URL.createObjectURL(blob);
      setQueue((prev) => prev.map((i) => {
        if (i.id !== id) return i;
        if (i.result?.dataUrl.startsWith('blob:')) URL.revokeObjectURL(i.result.dataUrl);
        return {
          ...i,
          status: 'success' as const,
          progress: 100,
          errorMessage: undefined,
          originalWidth: metadata.originalWidth ?? i.originalWidth,
          originalHeight: metadata.originalHeight ?? i.originalHeight,
          settingsSnapshot: opts,
          result: {
            id: crypto.randomUUID(),
            dataUrl: resultUrl,
            originalName: item.name,
            scale: opts.scale,
            ...metadata,
          } as unknown as UpscaleResultData,
        };
      }));
      const modeNote = metadata.preset ? ` · ${metadata.preset}` : '';
      showToast(`Upscaled ${opts.scale}× in ${formatMs(metadata.processingTimeMs ?? 0)}${modeNote}`);
      return true;
    } catch (error) {
      const aborted = (error as Error)?.name === 'AbortError';
      const message = aborted
        ? 'Timed out after 55s — try a smaller image or scale'
        : (error as Error)?.message || 'Processing failed';
      if (queueRef.current.some((i) => i.id === id)) {
        updateItem(id, { status: 'error', progress: 0, errorMessage: message });
      }
      showToast(message, 'error');
      return false;
    }
  }, [showToast, updateItem]);

  const isProcessingAny = queue.some((i) => i.status === 'processing');

  const handleProcessAll = useCallback(async () => {
    const opts = settingsRef.current;
    const ids = queueRef.current.filter((i) => i.status === 'idle' || i.status === 'error').map((i) => i.id);
    if (ids.length === 0) return;
    let successes = 0;
    for (const id of ids) {
      if (await processItem(id, opts)) successes += 1;
    }
    const failures = ids.length - successes;
    if (failures > 0) showToast(`${successes}/${ids.length} done · ${failures} failed`, 'error');
    else showToast(`Upscaled ${ids.length} image${ids.length > 1 ? 's' : ''}`);
  }, [processItem, showToast]);

  /* ---------------- Output ---------------- */

  const triggerDownload = (url: string, filename: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleDownloadItem = useCallback((item: ImageQueueItem) => {
    if (!item.result) return;
    const base = item.name.replace(/\.[^/.]+$/, '') || 'image';
    triggerDownload(item.result.dataUrl, `${base}_${item.result.scale}x.${item.result.format}`);
  }, []);

  const handleDownloadAllZip = useCallback(async () => {
    const completed = queueRef.current.filter((i) => i.status === 'success' && i.result);
    if (completed.length === 0) return;
    setIsGeneratingZip(true);
    try {
      const zip = new JSZip();
      const used = new Set<string>();
      for (const [index, item] of completed.entries()) {
        const blob = await fetch(item.result!.dataUrl).then((r) => r.blob());
        const base = item.name.replace(/\.[^/.]+$/, '') || 'image';
        let filename = `${base}_${item.result!.scale}x.${item.result!.format}`;
        if (used.has(filename)) filename = `${index + 1}_${filename}`;
        used.add(filename);
        zip.file(filename, blob);
      }
      const archive = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(archive);
      triggerDownload(url, `openupscale-${completed.length}-images.zip`);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      showToast(`ZIP with ${completed.length} images downloaded`);
    } catch (error) {
      showToast(`Could not build the ZIP: ${(error as Error).message}`, 'error');
    } finally {
      setIsGeneratingZip(false);
    }
  }, [showToast]);

  const handleRemoveItem = useCallback((id: string) => {
    const removed = queueRef.current.find((item) => item.id === id);
    if (removed) {
      if (removed.previewUrl.startsWith('blob:')) URL.revokeObjectURL(removed.previewUrl);
      if (removed.result?.dataUrl.startsWith('blob:')) URL.revokeObjectURL(removed.result.dataUrl);
    }
    const remaining = queueRef.current.filter((item) => item.id !== id);
    setQueue(remaining);
    setSelectedId((prev) => (prev === id ? (remaining[0]?.id ?? null) : prev));
  }, []);

  const handleClearAll = useCallback(() => {
    for (const item of queueRef.current) {
      if (item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
      if (item.result?.dataUrl.startsWith('blob:')) URL.revokeObjectURL(item.result.dataUrl);
    }
    setQueue([]);
    setSelectedId(null);
    showToast('Queue cleared', 'info');
  }, [showToast]);

  const handleSettingsChange = useCallback((next: UpscaleSettings) => {
    setSettings(next);
    // Un-started items follow the panel; processed items keep their snapshot.
    setQueue((prev) => prev.map((i) => (i.status === 'idle' ? { ...i, settingsSnapshot: { ...next } } : i)));
  }, []);

  const selectedItem = queue.find((i) => i.id === selectedId) ?? queue[0];
  const hasImages = queue.length > 0;

  const selectedLimit = selectedItem
    ? checkOutputLimits(selectedItem.originalWidth, selectedItem.originalHeight, settings.scale)
    : { ok: true as const, message: undefined as string | undefined };

  const primaryLabel = !selectedItem ? 'Upscale'
    : selectedItem.status === 'processing' ? 'Processing…'
    : selectedItem.status === 'success' ? 'Upscale again'
    : selectedItem.status === 'error' ? 'Retry upscale'
    : `Upscale ${settings.scale}×`;

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <Header onOpenDocs={() => setIsDocsOpen(true)} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
        {!hasImages ? (
          <div className="mx-auto flex max-w-3xl flex-col gap-6 py-4">
            <div className="text-center">
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Upscale images in the cloud</h1>
              <p className="mt-2 text-sm text-ink-soft">
                Sharper, larger photos, art, and scans. No account, no tracking — files are never stored.
              </p>
            </div>
            <UploadZone variant="full" onFilesSelected={handleFilesSelected} onSampleSelected={handleSampleSelect} />
            <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-ink-soft">
              <li className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-brand" /> Auto-tuned per image</li>
              <li className="flex items-center gap-1.5"><Layers className="h-3.5 w-3.5 text-brand" /> Batch up to {MAX_BATCH_SIZE} + ZIP</li>
              <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-ok" /> Nothing kept on the server</li>
            </ul>
          </div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex min-w-0 flex-col gap-3">
              <ComparisonSlider
                item={selectedItem}
                onDownload={handleDownloadItem}
                onDelete={handleRemoveItem}
              />
              <BatchQueue
                items={queue}
                selectedId={selectedItem?.id ?? null}
                onSelectItem={setSelectedId}
                onProcessItem={(id) => void processItem(id, settingsRef.current)}
                onProcessAll={() => void handleProcessAll()}
                onRemoveItem={handleRemoveItem}
                onClearAll={handleClearAll}
                onDownloadItem={handleDownloadItem}
                onDownloadAllZip={() => void handleDownloadAllZip()}
                isProcessingAny={isProcessingAny}
                isGeneratingZip={isGeneratingZip}
              />
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => selectedItem && void processItem(selectedItem.id, settings)}
                disabled={isProcessingAny || !selectedLimit.ok}
                title={selectedLimit.ok ? 'Process with the current settings' : selectedLimit.message}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isProcessingAny
                  ? <RefreshCw className="h-4 w-4 animate-spin" />
                  : selectedItem?.status === 'error'
                    ? <RefreshCw className="h-4 w-4" />
                    : <Play className="h-4 w-4 fill-current" />}
                <span>{primaryLabel}</span>
              </button>
              {!selectedLimit.ok && <p className="-mt-1 text-xs text-err">{selectedLimit.message}</p>}

              <SettingsPanel
                settings={settings}
                onChange={handleSettingsChange}
                disabled={isProcessingAny}
                activeDimensions={
                  selectedItem?.originalWidth && selectedItem?.originalHeight
                    ? { width: selectedItem.originalWidth, height: selectedItem.originalHeight }
                    : undefined
                }
              />

              <details className="rounded-xl border border-line bg-surface p-1">
                <summary className="flex cursor-pointer list-none items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-ink-soft transition hover:text-ink">
                  <Plus className="h-3.5 w-3.5" /> Add more images
                </summary>
                <div className="px-1 pb-1">
                  <UploadZone variant="compact" onFilesSelected={handleFilesSelected} onSampleSelected={handleSampleSelect} disabled={isProcessingAny} />
                </div>
              </details>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-ink-soft sm:px-6">
          <span className="flex items-center gap-2">
            <span className="font-semibold text-ink">OpenUpscale</span>
            <span>· free · open-source · MIT</span>
          </span>
          <span className="flex items-center gap-4">
            <button onClick={() => setIsDocsOpen(true)} className="cursor-pointer underline-offset-2 hover:text-ink hover:underline">
              How it works
            </button>
            <a href="https://github.com/alistairfoxlondon-pixel/Upscaler-Free" target="_blank" rel="noreferrer" className="underline-offset-2 hover:text-ink hover:underline">
              Source
            </a>
          </span>
        </div>
      </footer>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-medium shadow-lg animate-slide-up ${
            toast.kind === 'error'
              ? 'border-red-200 bg-red-50 text-err'
              : toast.kind === 'info'
                ? 'border-line bg-surface text-ink-soft'
                : 'border-emerald-200 bg-emerald-50 text-ok'
          }`}
        >
          {toast.kind === 'error' ? <X className="h-3.5 w-3.5 shrink-0" /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
          <span>{toast.message}</span>
        </div>
      )}

      <OpenSourceDocsModal isOpen={isDocsOpen} onClose={() => setIsDocsOpen(false)} />
    </div>
  );
}
