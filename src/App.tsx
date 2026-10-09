import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header.tsx';
import { UploadZone } from './components/UploadZone.tsx';
import { SettingsPanel } from './components/SettingsPanel.tsx';
import { ComparisonSlider } from './components/ComparisonSlider.tsx';
import { BatchQueue } from './components/BatchQueue.tsx';
import { OpenSourceDocsModal } from './components/OpenSourceDocsModal.tsx';
import { PrivacyBanner } from './components/PrivacyBanner.tsx';
import { SAMPLE_IMAGES, SampleItem } from './data/samples.ts';
import {
  ImageQueueItem,
  UpscaleSettings,
  SystemInfo,
  UpscaleResultData,
} from './types.ts';
import {
  Sparkles,
  CheckCircle,
  RefreshCw,
} from 'lucide-react';

export default function App() {
  const [settings, setSettings] = useState<UpscaleSettings>({
    scale: 2,
    preset: 'photo',
    sharpness: 45,
    denoise: 35,
    detailBoost: 50,
    contrast: 0,
    brightness: 0,
    saturation: 0,
    format: 'png',
    quality: 92,
    autoDeleteOnDownload: true,
  });

  const [queue, setQueue] = useState<ImageQueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDocsOpen, setIsDocsOpen] = useState(false);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [isProcessingAny, setIsProcessingAny] = useState(false);
  const [isGeneratingZip, setIsGeneratingZip] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Helper to read natural image dimensions
  const getImageDimensions = (url: string): Promise<{ width: number; height: number }> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: 0, height: 0 });
      img.src = url;
    });
  };

  // Helper to convert an image URL into a real File object for uploading
  const urlToFile = async (url: string, filename: string): Promise<File> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load asset from ${url}`);
    const blob = await res.blob();
    return new File([blob], filename, { type: blob.type || 'image/jpeg' });
  };

  // Fetch engine health on initial mount
  useEffect(() => {
    fetch('/api/system-status')
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error('Non-ok response');
      })
      .then((data) => setSystemInfo(data))
      .catch((err) => console.warn('System status check:', err));
  }, []);

  // Pre-load benchmark sample into queue as IDLE on first mount (no auto-network call)
  useEffect(() => {
    if (queue.length === 0) {
      const sample = SAMPLE_IMAGES[0];
      const itemId = crypto.randomUUID();
      const newItem: ImageQueueItem = {
        id: itemId,
        name: `${sample.name}.jpg`,
        previewUrl: sample.url,
        originalSize: 520 * 1024,
        originalWidth: 1200,
        originalHeight: 896,
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
      originalSize: 520 * 1024,
      originalWidth: 1200,
      originalHeight: 896,
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
    processItem(newItem);
  };

  // Core upscaling logic: all items use POST /api/upscale with FormData
  const processItem = async (item: ImageQueueItem, customSettings?: UpscaleSettings) => {
    const activeOpts = customSettings || item.settingsSnapshot;

    // Set processing state
    setQueue((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, status: 'processing', progress: 25 } : i))
    );
    setIsProcessingAny(true);

    try {
      // 1. Ensure we have a valid File object
      let uploadFile = item.file;
      if (!uploadFile && item.previewUrl) {
        uploadFile = await urlToFile(item.previewUrl, item.name);
        item.file = uploadFile;
      }

      if (!uploadFile) {
        throw new Error('Image source could not be resolved');
      }

      // 2. Build FormData
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('scale', String(activeOpts.scale));
      formData.append('preset', activeOpts.preset);
      formData.append('sharpness', String(activeOpts.sharpness));
      formData.append('denoise', String(activeOpts.denoise));
      formData.append('detailBoost', String(activeOpts.detailBoost));
      formData.append('contrast', String(activeOpts.contrast));
      formData.append('format', activeOpts.format);
      formData.append('quality', String(activeOpts.quality));

      setQueue((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, progress: 50 } : i))
      );

      // 3. Send to cloud upscaler
      const res = await fetch('/api/upscale', {
        method: 'POST',
        body: formData,
      });

      // 4. Safe Content-Type & JSON parsing
      const contentType = res.headers.get('content-type') || '';
      let resultData: any;

      if (contentType.includes('application/json')) {
        resultData = await res.json();
      } else {
        const text = await res.text();
        throw new Error(
          res.ok
            ? 'Unexpected non-JSON response from server'
            : `Server returned error (${res.status}): ${text.slice(0, 120)}`
        );
      }

      if (!res.ok) {
        throw new Error(resultData?.error || `Upload failed with status ${res.status}`);
      }

      // 5. Update item state
      setQueue((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? {
                ...i,
                status: 'success',
                progress: 100,
                result: resultData,
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
      await processItem(item);
    }
  };

  // Download individual image
  const handleDownloadItem = (item: ImageQueueItem) => {
    if (!item.result?.downloadUrl) return;

    const deleteParam = settings.autoDeleteOnDownload ? '&deleteAfter=true' : '';
    const downloadUrl = `${item.result.downloadUrl}?download=true${deleteParam}`;

    const link = document.createElement('a');
    link.href = downloadUrl;
    link.setAttribute(
      'download',
      `${item.name.replace(/\.[^/.]+$/, '')}_upscaled_${item.result.scale}x.${item.result.format}`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (settings.autoDeleteOnDownload) {
      showToast('Downloaded & purged from server memory.');
    }
  };

  // Download ZIP archive
  const handleDownloadAllZip = async () => {
    const completedItems = queue.filter((i) => i.status === 'success' && i.result);
    if (completedItems.length === 0) return;

    setIsGeneratingZip(true);
    try {
      const ids = completedItems.map((i) => i.result!.id);
      const res = await fetch('/api/batch-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids,
          deleteAfter: settings.autoDeleteOnDownload,
        }),
      });

      if (!res.ok) throw new Error('Failed to create ZIP');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `OpenUpscale_Batch_${Date.now()}.zip`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      showToast(`Downloaded ${completedItems.length} images as ZIP.`);
    } catch (error: any) {
      showToast(`ZIP error: ${error.message}`);
    } finally {
      setIsGeneratingZip(false);
    }
  };

  // Remove single item
  const handleRemoveItem = async (id: string) => {
    const item = queue.find((i) => i.id === id);
    if (item?.result?.id) {
      fetch(`/api/files/${item.result.id}`, { method: 'DELETE' }).catch(() => {});
    }

    setQueue((prev) => prev.filter((i) => i.id !== id));
    if (selectedId === id) {
      const remaining = queue.filter((i) => i.id !== id);
      setSelectedId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  // Clear all items and purge server cache
  const handleClearAll = async () => {
    try {
      await fetch('/api/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
    } catch (e) {
      console.warn('Cleanup error:', e);
    }
    setQueue([]);
    setSelectedId(null);
    showToast('Queue cleared & server memory purged.');
  };

  const selectedItem = queue.find((i) => i.id === selectedId) || queue[0];

  return (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100 flex flex-col font-['Plus_Jakarta_Sans',sans-serif]">
      {/* Top Bar Navigation */}
      <Header onOpenDocs={() => setIsDocsOpen(true)} activeCount={queue.length} />

      {/* Main Container */}
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 space-y-6">
        {selectedItem ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
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
                ) : selectedItem.status === 'success' ? (
                  <button
                    onClick={() => processItem(selectedItem, settings)}
                    disabled={isProcessingAny}
                    className="w-full py-2.5 px-4 rounded-xl font-medium text-xs text-slate-300 bg-slate-800 hover:bg-slate-750 hover:text-white border border-slate-700 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-cyan-400" />
                    <span>Re-upscale with Current Settings</span>
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

        {/* Privacy & Engine Metrics */}
        <PrivacyBanner systemInfo={systemInfo} />
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950/80 py-6 text-xs text-slate-400">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-200">OpenUpscale</span>
            <span>·</span>
            <span>Open Source Cloud Super-Resolution</span>
            <span>·</span>
            <span className="font-mono text-cyan-400">MIT</span>
          </div>

          <div className="flex items-center gap-6">
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
            <span>Zero Tracking · Ephemeral Memory</span>
          </div>
        </div>
      </footer>

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-xs shadow-2xl animate-fade-in">
          <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Open Source & Docs Modal */}
      <OpenSourceDocsModal isOpen={isDocsOpen} onClose={() => setIsDocsOpen(false)} />
    </div>
  );
}
