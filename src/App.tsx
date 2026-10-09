import React, { useState, useEffect } from 'react';
import { Header } from './components/Header.tsx';
import { UploadZone } from './components/UploadZone.tsx';
import { SettingsPanel } from './components/SettingsPanel.tsx';
import { ComparisonSlider } from './components/ComparisonSlider.tsx';
import { BatchQueue } from './components/BatchQueue.tsx';
import { OpenSourceDocsModal } from './components/OpenSourceDocsModal.tsx';
import { SAMPLE_IMAGES, SampleItem } from './data/samples.ts';
import JSZip from 'jszip';
import {
  ImageQueueItem,
  UpscaleSettings,
  UpscaleResultData,
} from './types.ts';
import {
  Sparkles,
  CheckCircle,
  RefreshCw,
  Zap,
  ShieldCheck,
} from 'lucide-react';

export default function App() {
  const [settings, setSettings] = useState<UpscaleSettings>({
    scale: 2,
    preset: 'photo',
    sharpness: 45,
    denoise: 20,
    detailBoost: 50,
    contrast: 0,
    brightness: 0,
    saturation: 0,
    format: 'png',
    quality: 95,
  });

  const [queue, setQueue] = useState<ImageQueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDocsOpen, setIsDocsOpen] = useState(false);
  const [isProcessingAny, setIsProcessingAny] = useState(false);
  const [isGeneratingZip, setIsGeneratingZip] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Helper to read image dimensions
  const getImageDimensions = (url: string): Promise<{ width: number; height: number }> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: 0, height: 0 });
      img.src = url;
    });
  };

  // Global paste handler (Ctrl+V anywhere on page)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const items = e.clipboardData.items;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        handleFilesSelected(files);
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [settings, queue.length]);

  // Validate in one place so picker, drag/drop, and clipboard follow identical limits.
  const handleFilesSelected = async (files: File[]) => {
    const slots = Math.max(0, 20 - queue.length);
    const candidates = files.slice(0, slots);
    const valid = candidates.filter((file) =>
      file.type.startsWith('image/') && file.type !== 'image/svg+xml' && file.size <= 4 * 1024 * 1024
    );
    if (slots === 0) return showToast('The batch queue is limited to 20 images');
    if (valid.length !== files.length) showToast('Some files were skipped (image only, 4 MB maximum)');

    const newItems: ImageQueueItem[] = [];
    for (const file of valid) {
      const previewUrl = URL.createObjectURL(file);
      const dims = await getImageDimensions(previewUrl);
      newItems.push({
        id: crypto.randomUUID(),
        name: file.name,
        file,
        previewUrl,
        originalWidth: dims.width || undefined,
        originalHeight: dims.height || undefined,
        originalSize: file.size,
        status: 'idle',
        progress: 0,
        settingsSnapshot: { ...settings },
      });
    }

    setQueue((prev) => [...prev, ...newItems]);
    if (newItems.length > 0) {
      setSelectedId(newItems[0].id);
      showToast(`Added ${newItems.length} image${newItems.length > 1 ? 's' : ''}`);
    }
  };

  // Select sample benchmark
  const handleSampleSelect = async (sample: SampleItem) => {
    const itemId = crypto.randomUUID();
    const newItem: ImageQueueItem = {
      id: itemId,
      name: `${sample.name}.jpg`,
      previewUrl: sample.url,
      originalSize: 15000,
      originalWidth: 400,
      originalHeight: 300,
      status: 'idle',
      progress: 0,
      isSample: true,
      settingsSnapshot: {
        ...settings,
        preset: sample.recommendedPreset,
      },
    };

    setQueue((prev) => [newItem, ...prev.filter((i) => i.id !== itemId)]);
    setSelectedId(itemId);
  };

  // Process a queue item entirely on the server. The browser only uploads and renders the result.
  const processItem = async (item: ImageQueueItem, customSettings?: UpscaleSettings) => {
    const activeOpts = customSettings || item.settingsSnapshot;
    setQueue((prev) => prev.map((i) =>
      i.id === item.id ? { ...i, status: 'processing', progress: 15, errorMessage: undefined } : i
    ));
    setIsProcessingAny(true);

    try {
      let uploadFile = item.file;
      if (!uploadFile) {
        const response = await fetch(item.previewUrl);
        if (!response.ok) throw new Error('Could not load the sample image');
        const blob = await response.blob();
        uploadFile = new File([blob], item.name, { type: blob.type || 'image/jpeg' });
      }

      const form = new FormData();
      form.append('file', uploadFile, item.name);
      Object.entries(activeOpts).forEach(([key, value]) => form.append(key, String(value)));
      setQueue((prev) => prev.map((i) => i.id === item.id ? { ...i, progress: 45 } : i));

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 55_000);
      let response: Response;
      try {
        response = await fetch('/api/upscale', { method: 'POST', body: form, signal: controller.signal });
      } finally {
        window.clearTimeout(timeout);
      }

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || `Cloud processing failed (${response.status})`);
      }
      if (!response.headers.get('content-type')?.startsWith('image/')) {
        throw new Error('The cloud returned an invalid image response');
      }

      const encodedMetadata = response.headers.get('x-upscale-metadata');
      if (!encodedMetadata) throw new Error('The cloud response is missing image metadata');
      const base64 = encodedMetadata.replace(/-/g, '+').replace(/_/g, '/');
      const metadata = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
      const blob = await response.blob();
      if (!blob.size) throw new Error('The cloud returned an empty image');
      const resultUrl = URL.createObjectURL(blob);

      setQueue((prev) => prev.map((i) => {
        if (i.id !== item.id) return i;
        if (i.result?.dataUrl.startsWith('blob:')) URL.revokeObjectURL(i.result.dataUrl);
        return {
          ...i,
          status: 'success',
          progress: 100,
          originalWidth: metadata.originalWidth,
          originalHeight: metadata.originalHeight,
          settingsSnapshot: activeOpts,
          result: {
            id: crypto.randomUUID(),
            dataUrl: resultUrl,
            originalName: item.name,
            scale: activeOpts.scale,
            preset: activeOpts.preset,
            ...metadata,
          } as UpscaleResultData,
        };
      }));
      showToast(`Enhanced to ${activeOpts.scale}x in ${metadata.processingTimeMs} ms`);
    } catch (error: any) {
      const message = error?.name === 'AbortError'
        ? 'Cloud processing timed out. Try a smaller scale or image.'
        : error?.message || 'Processing failed';
      setQueue((prev) => prev.map((i) =>
        i.id === item.id ? { ...i, status: 'error', progress: 0, errorMessage: message } : i
      ));
      showToast(message);
    } finally {
      setIsProcessingAny(false);
    }
  };

  // Upscale all idle items
  const handleProcessAll = async () => {
    const idleItems = queue.filter((i) => i.status === 'idle');
    if (idleItems.length === 0) return;

    for (const item of idleItems) {
      await processItem(item, settings);
    }
  };

  // Instant client-side download: zero server round trips, 100% reliable on Vercel
  const handleDownloadItem = (item: ImageQueueItem) => {
    if (!item.result) return;

    const downloadSrc = item.result.dataUrl;
    const filename = `${item.name.replace(/\.[^/.]+$/, '')}_upscaled_${item.result.scale}x.${item.result.format}`;

    const link = document.createElement('a');
    link.href = downloadSrc;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast(`Downloaded ${filename}`);
  };

  // Client-side ZIP generation with JSZip: zero server memory load, zero Vercel payload limits
  const handleDownloadAllZip = async () => {
    const completedItems = queue.filter((i) => i.status === 'success' && i.result);
    if (completedItems.length === 0) return;

    setIsGeneratingZip(true);
    try {
      const zip = new JSZip();

      for (const item of completedItems) {
        if (item.result?.dataUrl) {
          const output = await fetch(item.result.dataUrl).then((response) => response.blob());
          const filename = `${item.name.replace(/\.[^/.]+$/, '')}_upscaled_${item.result.scale}x.${item.result.format}`;
          zip.file(filename, output);
        }
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `OpenUpscale_Batch_${Date.now()}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      showToast(`Downloaded ${completedItems.length} images as ZIP archive`);
    } catch (error: any) {
      showToast(`ZIP error: ${error.message}`);
    } finally {
      setIsGeneratingZip(false);
    }
  };

  const releaseItemUrls = (item: ImageQueueItem) => {
    if (item.file && item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
    if (item.result?.dataUrl.startsWith('blob:')) URL.revokeObjectURL(item.result.dataUrl);
  };

  // Remove single item and release browser memory. The cloud copy was already discarded.
  const handleRemoveItem = (id: string) => {
    const removed = queue.find((item) => item.id === id);
    if (removed) releaseItemUrls(removed);
    const remaining = queue.filter((item) => item.id !== id);
    setQueue(remaining);
    if (selectedId === id) setSelectedId(remaining[0]?.id ?? null);
  };

  // Clear all
  const handleClearAll = () => {
    queue.forEach(releaseItemUrls);
    setQueue([]);
    setSelectedId(null);
    showToast('Queue cleared');
  };

  const selectedItem = queue.find((i) => i.id === selectedId) || queue[0];

  return (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100 flex flex-col font-['Plus_Jakarta_Sans',sans-serif]">
      {/* Top Bar Navigation */}
      <Header onOpenDocs={() => setIsDocsOpen(true)} activeCount={queue.length} />

      {/* Main Container */}
      <main className="flex-1 mx-auto w-full max-w-7xl px-3.5 py-5 sm:px-6 space-y-6">
        {selectedItem ? (
          <div className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
              {/* Left 2 Cols: Comparison Slider */}
              <div className="lg:col-span-2 space-y-3">
                <ComparisonSlider
                  item={selectedItem}
                  onDownload={handleDownloadItem}
                  onDelete={handleRemoveItem}
                />
              </div>

              {/* Right 1 Col: Settings & Action */}
              <div className="lg:col-span-1 space-y-3">
                <SettingsPanel
                  settings={settings}
                  onChange={(newSettings) => {
                    setSettings(newSettings);
                    if (selectedItem && selectedItem.status === 'idle') {
                      setQueue((prev) =>
                        prev.map((i) =>
                          i.id === selectedItem.id
                            ? { ...i, settingsSnapshot: { ...newSettings } }
                            : i
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

                {/* Primary Action Button */}
                {selectedItem.status === 'idle' ? (
                  <button
                    onClick={() => processItem(selectedItem, settings)}
                    disabled={isProcessingAny}
                    className="w-full py-3 px-4 rounded-xl font-bold text-sm text-slate-950 bg-gradient-to-r from-cyan-400 to-indigo-400 hover:from-cyan-300 hover:to-indigo-300 shadow-md shadow-cyan-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
                  >
                    <Sparkles className="h-4 w-4" />
                    <span>Upscale Image ({settings.scale}x)</span>
                  </button>
                ) : selectedItem.status === 'processing' ? (
                  <div className="w-full py-3 px-4 rounded-xl font-medium text-sm text-cyan-300 bg-slate-800 border border-cyan-500/30 flex items-center justify-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin text-cyan-400" />
                    <span>Processing in Cloud...</span>
                  </div>
                ) : (
                  <button
                    onClick={() => processItem(selectedItem, settings)}
                    disabled={isProcessingAny}
                    className="w-full py-2.5 px-4 rounded-xl font-medium text-xs text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-white border border-slate-700 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-cyan-400" />
                    <span>{selectedItem.status === 'error' ? 'Retry Processing' : 'Re-Upscale with Current Settings'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Batch Queue Bar */}
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

            {/* Upload Zone */}
            <UploadZone
              onFilesSelected={handleFilesSelected}
              onSampleSelected={handleSampleSelect}
              disabled={isProcessingAny}
            />
          </div>
        ) : (
          /* Empty State */
          <div className="space-y-6 max-w-3xl mx-auto py-8">
            <div className="text-center space-y-2">
              <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                Cloud Image Upscaler
              </h1>
              <p className="text-sm text-slate-400 max-w-lg mx-auto">
                Free open-source super-resolution. Zero local CPU load, instant batch downloads,
                and automatic file deletion.
              </p>
            </div>

            <UploadZone
              onFilesSelected={handleFilesSelected}
              onSampleSelected={handleSampleSelect}
              disabled={isProcessingAny}
            />
          </div>
        )}

        {/* Clean Privacy Callout */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>100% Privacy: Files are processed ephemerally and never retained. Zero tracking.</span>
          </div>
          <div className="flex items-center gap-2.5">
            <Zap className="h-4 w-4 text-cyan-400 shrink-0" />
            <span>Vercel Serverless Ready · Lanczos-3 Sinc Resampling</span>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950/80 py-5 text-xs text-slate-400">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-200">OpenUpscale</span>
            <span>·</span>
            <span>Free Open Source Cloud Upscaler</span>
            <span>·</span>
            <span className="font-mono text-cyan-400">MIT</span>
          </div>

          <div className="flex items-center gap-5">
            <button
              onClick={() => setIsDocsOpen(true)}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Docs & Models
            </button>
            <a
              href="https://github.com/alistairfoxlondon-pixel/Upscaler-Free"
              target="_blank"
              rel="noreferrer"
              className="hover:text-white transition-colors"
            >
              GitHub
            </a>
            <span>Zero Tracking</span>
          </div>
        </div>
      </footer>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-xs shadow-2xl animate-fade-in">
          <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Docs Modal */}
      <OpenSourceDocsModal isOpen={isDocsOpen} onClose={() => setIsDocsOpen(false)} />
    </div>
  );
}
