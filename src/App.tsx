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
    autoDeleteOnDownload: true,
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

  // Load initial benchmark sample into queue as IDLE on mount
  useEffect(() => {
    if (queue.length === 0) {
      const sample = SAMPLE_IMAGES[0];
      const itemId = crypto.randomUUID();
      const newItem: ImageQueueItem = {
        id: itemId,
        name: `${sample.name}.jpg`,
        previewUrl: sample.url,
        originalSize: 11425,
        originalWidth: 400,
        originalHeight: 300,
        status: 'idle',
        progress: 0,
        isSample: true,
        samplePath: sample.serverPath,
        settingsSnapshot: {
          ...settings,
          preset: sample.recommendedPreset,
        },
      };
      setQueue([newItem]);
      setSelectedId(itemId);
    }
  }, []);

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
  }, [settings]);

  // Handle uploaded files
  const handleFilesSelected = async (files: File[]) => {
    const newItems: ImageQueueItem[] = [];

    for (const file of files) {
      const previewUrl = URL.createObjectURL(file);
      const dims = await getImageDimensions(previewUrl);

      newItems.push({
        id: crypto.randomUUID(),
        name: file.name,
        file,
        previewUrl,
        originalWidth: dims.width || 800,
        originalHeight: dims.height || 600,
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
      samplePath: sample.serverPath,
      settingsSnapshot: {
        ...settings,
        preset: sample.recommendedPreset,
      },
    };

    setQueue((prev) => [newItem, ...prev.filter((i) => i.id !== itemId)]);
    setSelectedId(itemId);
  };

  // Process a queue item
  const processItem = async (item: ImageQueueItem, customSettings?: UpscaleSettings) => {
    const activeOpts = customSettings || item.settingsSnapshot;

    setQueue((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, status: 'processing', progress: 30 } : i))
    );
    setIsProcessingAny(true);

    try {
      // 1. Get base64 or file
      let base64Image = '';
      if (item.file) {
        base64Image = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(item.file!);
        });
      } else if (item.previewUrl) {
        const resp = await fetch(item.previewUrl);
        const blob = await resp.blob();
        base64Image = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }

      setQueue((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, progress: 60 } : i))
      );

      // 2. Call /api/upscale with JSON (Universal Vercel + Node support)
      const res = await fetch('/api/upscale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: base64Image,
          name: item.name,
          scale: activeOpts.scale,
          preset: activeOpts.preset,
          sharpness: activeOpts.sharpness,
          denoise: activeOpts.denoise,
          format: activeOpts.format,
          quality: activeOpts.quality,
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      let resultData: any;

      if (contentType.includes('application/json')) {
        resultData = await res.json();
      } else {
        const text = await res.text();
        throw new Error(
          res.ok
            ? 'Unexpected non-JSON response from server'
            : `Server returned error (${res.status}): ${text.slice(0, 100)}`
        );
      }

      if (!res.ok) {
        throw new Error(resultData?.error || `Upload failed with status ${res.status}`);
      }

      // Update queue item
      setQueue((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? {
                ...i,
                status: 'success',
                progress: 100,
                result: resultData as UpscaleResultData,
                settingsSnapshot: activeOpts,
              }
            : i
        )
      );
      showToast(`Upscaled to ${resultData.scale}x in ${resultData.processingTimeMs}ms`);
    } catch (error: any) {
      console.error('Processing error:', error);
      const msg = error.message || 'Processing failed';
      setQueue((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? {
                ...i,
                status: 'error',
                errorMessage: msg,
              }
            : i
        )
      );
      showToast(`Error: ${msg}`);
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

    const downloadSrc = item.result.dataUrl || item.result.downloadUrl;
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
          const base64Data = item.result.dataUrl.split(',')[1];
          const filename = `${item.name.replace(/\.[^/.]+$/, '')}_upscaled_${item.result.scale}x.${item.result.format}`;
          zip.file(filename, base64Data, { base64: true });
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

  // Remove single item
  const handleRemoveItem = (id: string) => {
    setQueue((prev) => prev.filter((i) => i.id !== id));
    if (selectedId === id) {
      const remaining = queue.filter((i) => i.id !== id);
      setSelectedId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  // Clear all
  const handleClearAll = () => {
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
                  autoDeleteOnDownload={settings.autoDeleteOnDownload}
                  onReUpscale={() => processItem(selectedItem, settings)}
                  isProcessing={selectedItem.status === 'processing'}
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
                ) : selectedItem.status === 'success' ? (
                  <button
                    onClick={() => processItem(selectedItem, settings)}
                    disabled={isProcessingAny}
                    className="w-full py-2.5 px-4 rounded-xl font-medium text-xs text-slate-300 bg-slate-800 hover:bg-slate-750 hover:text-white border border-slate-700 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-cyan-400" />
                    <span>Re-Upscale with Current Settings</span>
                  </button>
                ) : null}
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
              href="https://github.com"
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
