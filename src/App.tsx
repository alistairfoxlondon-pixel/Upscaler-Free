import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from './components/Header.tsx';
import { UploadZone } from './components/UploadZone.tsx';
import { SettingsPanel } from './components/SettingsPanel.tsx';
import { ComparisonSlider } from './components/ComparisonSlider.tsx';
import { BatchQueue } from './components/BatchQueue.tsx';
import { OpenSourceDocsModal } from './components/OpenSourceDocsModal.tsx';
import { SAMPLE_IMAGES, SampleItem } from './data/samples.ts';
import JSZip from 'jszip';
import { ImageQueueItem, UpscaleSettings, UpscaleResultData } from './types.ts';
import { Sparkles, CheckCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { REPO_URL } from './config.ts';

const DEFAULT_SETTINGS: UpscaleSettings = {
  scale: 2,
  preset: 'photo',
  sharpness: 45,
  denoise: 20,
  format: 'png',
  quality: 95,
};

const MAX_FILE_BYTES = 35 * 1024 * 1024;

const outputName = (name: string, result: UpscaleResultData) =>
  `${name.replace(/\.[^/.]+$/, '')}_upscaled_${result.scale}x.${result.format}`;

// Reads natural dimensions of an image URL. Resolves null when the image can't be decoded.
const getImageDimensions = (url: string): Promise<{ width: number; height: number } | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

export default function App() {
  const [settings, setSettings] = useState<UpscaleSettings>(DEFAULT_SETTINGS);
  const [queue, setQueue] = useState<ImageQueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDocsOpen, setIsDocsOpen] = useState(false);
  const [activeJobs, setActiveJobs] = useState(0);
  const [isGeneratingZip, setIsGeneratingZip] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const isProcessingAny = activeJobs > 0;

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMessage(null), 3000);
  }, []);

  const addItems = useCallback((items: ImageQueueItem[]) => {
    setQueue((prev) => [...prev, ...items]);
    if (items.length > 0) setSelectedId(items[0].id);
  }, []);

  // Load the first benchmark sample on mount so the page is useful immediately.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const item = await buildSampleItem(SAMPLE_IMAGES[0], DEFAULT_SETTINGS);
      if (!cancelled && item) addItems([item]);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle uploaded files
  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      const newItems: ImageQueueItem[] = [];
      for (const file of files) {
        const previewUrl = URL.createObjectURL(file);
        const dims = await getImageDimensions(previewUrl);
        if (!dims) {
          URL.revokeObjectURL(previewUrl);
          showToast(`"${file.name}" could not be read as an image`);
          continue;
        }
        newItems.push({
          id: crypto.randomUUID(),
          name: file.name,
          file,
          previewUrl,
          originalWidth: dims.width,
          originalHeight: dims.height,
          originalSize: file.size,
          status: 'idle',
          progress: 0,
          settingsSnapshot: { ...settings },
        });
      }
      if (newItems.length > 0) {
        addItems(newItems);
        showToast(`Added ${newItems.length} image${newItems.length > 1 ? 's' : ''}`);
      }
    },
    [settings, addItems, showToast]
  );

  // Paste images anywhere on the page
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const files: File[] = [];
      for (const item of Array.from(e.clipboardData.items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) handleFilesSelected(files);
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handleFilesSelected]);

  const handleSampleSelect = async (sample: SampleItem) => {
    const item = await buildSampleItem(sample, settings);
    if (item) addItems([item]);
  };

  // Upscale one queue item through the server.
  const processItem = async (item: ImageQueueItem, opts: UpscaleSettings) => {
    setActiveJobs((n) => n + 1);
    setQueue((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, status: 'processing', progress: 0, errorMessage: undefined } : i))
    );

    try {
      const source: Blob = item.file ?? (await fetch(item.previewUrl).then((r) => r.blob()));
      const base64Image = await blobToDataUrl(source);

      const res = await fetch('/api/upscale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: base64Image,
          name: item.name,
          scale: opts.scale,
          preset: opts.preset,
          sharpness: opts.sharpness,
          denoise: opts.denoise,
          format: opts.format,
          quality: opts.quality,
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await res.text();
        throw new Error(
          res.ok ? 'Unexpected non-JSON response from server' : `Server error (${res.status}): ${text.slice(0, 100)}`
        );
      }
      const resultData = await res.json();
      if (!res.ok) {
        throw new Error(resultData?.error || `Upload failed with status ${res.status}`);
      }

      setQueue((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? { ...i, status: 'success', progress: 100, result: resultData as UpscaleResultData, settingsSnapshot: opts }
            : i
        )
      );
      showToast(
        resultData.engine === 'esrgan'
          ? `AI upscaled to ${resultData.scale}x in ${(resultData.processingTimeMs / 1000).toFixed(1)}s`
          : resultData.engineNote || `Upscaled to ${resultData.scale}x`
      );
    } catch (error: any) {
      console.error('Processing error:', error);
      const msg = error?.message || 'Processing failed';
      setQueue((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, status: 'error', errorMessage: msg } : i))
      );
      showToast(`Error: ${msg}`);
    } finally {
      setActiveJobs((n) => n - 1);
    }
  };

  const handleProcessAll = async () => {
    const idleItems = queue.filter((i) => i.status === 'idle' || i.status === 'error');
    for (const item of idleItems) {
      await processItem(item, settings);
    }
  };

  // Instant client-side download from the result data URL.
  const handleDownloadItem = (item: ImageQueueItem) => {
    if (!item.result?.dataUrl) return;
    const filename = outputName(item.name, item.result);
    const link = document.createElement('a');
    link.href = item.result.dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Downloaded ${filename}`);
  };

  const handleDownloadAllZip = async () => {
    const completedItems = queue.filter((i) => i.status === 'success' && i.result?.dataUrl);
    if (completedItems.length === 0) return;

    setIsGeneratingZip(true);
    try {
      const zip = new JSZip();
      for (const item of completedItems) {
        const base64Data = item.result!.dataUrl!.split(',')[1];
        zip.file(outputName(item.name, item.result!), base64Data, { base64: true });
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `OpenUpscale_Batch_${Date.now()}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast(`Downloaded ${completedItems.length} image${completedItems.length > 1 ? 's' : ''} as ZIP`);
    } catch (error: any) {
      showToast(`ZIP error: ${error?.message || 'unknown error'}`);
    } finally {
      setIsGeneratingZip(false);
    }
  };

  const handleRemoveItem = (id: string) => {
    const removed = queue.find((i) => i.id === id);
    if (removed?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(removed.previewUrl);
    const remaining = queue.filter((i) => i.id !== id);
    setQueue(remaining);
    if (selectedId === id) setSelectedId(remaining[0]?.id ?? null);
  };

  const handleClearAll = () => {
    queue.forEach((i) => i.previewUrl.startsWith('blob:') && URL.revokeObjectURL(i.previewUrl));
    setQueue([]);
    setSelectedId(null);
    showToast('Queue cleared');
  };

  const selectedItem = queue.find((i) => i.id === selectedId) || queue[0];

  return (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100 flex flex-col font-['Plus_Jakarta_Sans',sans-serif]">
      <Header onOpenDocs={() => setIsDocsOpen(true)} />

      <main id="upscaler" className="flex-1 mx-auto w-full max-w-7xl px-3.5 py-5 sm:px-6 space-y-6">
        {selectedItem ? (
          <div className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
              <div className="lg:col-span-2">
                <ComparisonSlider
                  item={selectedItem}
                  onDownload={handleDownloadItem}
                  onDelete={handleRemoveItem}
                />
              </div>

              <div className="lg:col-span-1 space-y-3">
                <SettingsPanel
                  settings={settings}
                  onChange={(newSettings) => {
                    setSettings(newSettings);
                    if (selectedItem.status === 'idle') {
                      setQueue((prev) =>
                        prev.map((i) =>
                          i.id === selectedItem.id ? { ...i, settingsSnapshot: { ...newSettings } } : i
                        )
                      );
                    }
                  }}
                  disabled={isProcessingAny}
                  activeDimensions={
                    selectedItem.originalWidth && selectedItem.originalHeight
                      ? { width: selectedItem.originalWidth, height: selectedItem.originalHeight }
                      : undefined
                  }
                />

                {(selectedItem.status === 'idle' || selectedItem.status === 'error') && (
                  <button
                    type="button"
                    onClick={() => processItem(selectedItem, settings)}
                    disabled={isProcessingAny}
                    className="w-full py-3 px-4 rounded-xl font-bold text-sm text-slate-950 bg-gradient-to-r from-cyan-400 to-indigo-400 hover:from-cyan-300 hover:to-indigo-300 shadow-md shadow-cyan-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                  >
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                    <span>Upscale Image ({settings.scale}x)</span>
                  </button>
                )}
                {selectedItem.status === 'processing' && (
                  <div
                    role="status"
                    className="w-full py-3 px-4 rounded-xl font-medium text-sm text-cyan-300 bg-slate-800 border border-cyan-500/30 flex items-center justify-center gap-2"
                  >
                    <RefreshCw className="h-4 w-4 animate-spin text-cyan-400" aria-hidden="true" />
                    <span>Enhancing with AI…</span>
                  </div>
                )}
                {selectedItem.status === 'success' && (
                  <button
                    type="button"
                    onClick={() => processItem(selectedItem, settings)}
                    disabled={isProcessingAny}
                    className="w-full py-2.5 px-4 rounded-xl font-medium text-xs text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-white border border-slate-700 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
                    <span>Re-upscale with current settings</span>
                  </button>
                )}
              </div>
            </div>

            <BatchQueue
              items={queue}
              selectedId={selectedId}
              onSelectItem={(id) => setSelectedId(id)}
              onProcessAll={handleProcessAll}
              onProcessItem={(id) => {
                const item = queue.find((i) => i.id === id);
                if (item) processItem(item, settings);
              }}
              onRemoveItem={handleRemoveItem}
              onClearAll={handleClearAll}
              onDownloadItem={handleDownloadItem}
              onDownloadAllZip={handleDownloadAllZip}
              isProcessingAny={isProcessingAny}
              isGeneratingZip={isGeneratingZip}
            />

            <UploadZone
              onFilesSelected={handleFilesSelected}
              onSampleSelected={handleSampleSelect}
              disabled={isProcessingAny}
            />
          </div>
        ) : (
          <div className="space-y-6 max-w-3xl mx-auto py-8">
            <div className="text-center space-y-2">
              <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">AI Image Upscaler</h1>
              <p className="text-sm text-slate-400 max-w-lg mx-auto">
                Add detail and sharpen photos, art and documents at 2x, 4x or 8x. Batch processing with instant downloads.
              </p>
            </div>
            <UploadZone
              onFilesSelected={handleFilesSelected}
              onSampleSelected={handleSampleSelect}
              disabled={isProcessingAny}
            />
          </div>
        )}

        <p className="flex items-center justify-center gap-2 text-xs text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
          <span>Images are processed in server memory and never written to disk.</span>
        </p>
      </main>

      <footer className="border-t border-slate-800/80 bg-slate-950/80 py-5 text-xs text-slate-400">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-200">OpenUpscale</span>
            <span aria-hidden="true">·</span>
            <span>Free, open-source, MIT licensed</span>
          </div>
          <div className="flex items-center gap-5">
            <button onClick={() => setIsDocsOpen(true)} className="hover:text-white transition-colors cursor-pointer">
              About & API
            </button>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-white transition-colors">
              GitHub
            </a>
          </div>
        </div>
      </footer>

      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 max-w-[calc(100vw-2.5rem)] flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-xs shadow-2xl animate-fade-in"
        >
          <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden="true" />
          <span>{toastMessage}</span>
        </div>
      )}

      <OpenSourceDocsModal isOpen={isDocsOpen} onClose={() => setIsDocsOpen(false)} />
    </div>
  );
}

// Builds a queue item for a bundled benchmark sample, using its real size and dimensions.
async function buildSampleItem(sample: SampleItem, settings: UpscaleSettings): Promise<ImageQueueItem | null> {
  const dims = await getImageDimensions(sample.url);
  if (!dims) return null;
  let size = 0;
  try {
    size = (await fetch(sample.url).then((r) => r.blob())).size;
  } catch {
    size = 0;
  }
  return {
    id: crypto.randomUUID(),
    name: `${sample.name}.jpg`,
    previewUrl: sample.url,
    originalWidth: dims.width,
    originalHeight: dims.height,
    originalSize: size,
    status: 'idle',
    progress: 0,
    isSample: true,
    samplePath: sample.serverPath,
    settingsSnapshot: { ...settings, preset: sample.recommendedPreset },
  };
}
