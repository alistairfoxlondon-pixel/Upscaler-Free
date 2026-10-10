import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, MAX_BATCH_SIZE, MAX_BROWSER_BYTES, outputLimitMessage, withPreset } from '../../shared/upscale.ts';
import { EMPTY_STOCK_METADATA, normalizeStockMetadata, type StockMetadata } from '../../shared/stock.ts';
import type { ImageQueueItem, UpscaleSettings } from '../types.ts';
import type { SampleItem } from '../data/samples.ts';
import { requestStockJpeg, requestStockMetadata, requestUpscale } from '../lib/api.ts';
import { downloadName, fileError, getImageDimensions, triggerDownload, uniqueNames } from '../lib/files.ts';

type Notice = { text: string; kind: 'info' | 'error' };
const release = (item: ImageQueueItem) => { URL.revokeObjectURL(item.previewUrl); if (item.result) URL.revokeObjectURL(item.result.url); };
const memorySize = (items: ImageQueueItem[]) => items.reduce((sum, item) => sum + item.file.size + (item.result?.blob.size ?? 0), 0);

export function useUpscaler() {
  const [queue, setQueue] = useState<ImageQueueItem[]>([]);
  const queueRef = useRef<ImageQueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [defaults, setDefaults] = useState<UpscaleSettings>({ ...DEFAULT_SETTINGS });
  const defaultsRef = useRef(defaults);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  const [zipping, setZipping] = useState(false);
  const zippingRef = useRef(false);
  const [realEsrganAvailable, setRealEsrganAvailable] = useState(false);
  const [stockMetadataAiAvailable, setStockMetadataAiAvailable] = useState(false);
  const [metadataBusy, setMetadataBusy] = useState(false);
  const metadataBusyRef = useRef(false);
  const autoMetadataIds = useRef(new Set<string>());
  const [stockExportBusy, setStockExportBusy] = useState(false);
  const stockExportBusyRef = useRef(false);
  const settingsTouched = useRef(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  const stopRequested = useRef(false);
  const mounted = useRef(true);
  const transientUrls = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const update = useCallback((fn: (items: ImageQueueItem[]) => ImageQueueItem[]) => {
    queueRef.current = fn(queueRef.current); if (mounted.current) setQueue(queueRef.current);
  }, []);
  const notify = useCallback((text: string, kind: Notice['kind'] = 'info') => {
    if (!mounted.current) return;
    clearTimeout(noticeTimer.current); setNotice({ text, kind });
    noticeTimer.current = setTimeout(() => setNotice(null), kind === 'error' ? 7_000 : 4_000);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let retries = 0;
    const loadStatus = async () => {
      if (cancelled) return;
      controller = new AbortController();
      try {
        const response = await fetch('/api/system-status', { signal: controller.signal });
        const status = response.ok ? await response.json() : null;
        if (!status || cancelled || !mounted.current) return;
        const workerConfigured = Boolean(status.engines?.realesrgan?.configured);
        const aiAvailable = Boolean(status.engines?.realesrgan?.ready);
        setRealEsrganAvailable(aiAvailable);
        setStockMetadataAiAvailable(Boolean(status.stockMetadata?.aiConfigured));
        if (aiAvailable && !settingsTouched.current) {
          const next = { ...defaultsRef.current, engine: 'realesrgan' as const };
          defaultsRef.current = next;
          setDefaults(next);
          update(items => items.map(item => ({ ...item, settingsSnapshot: { ...item.settingsSnapshot, engine: item.settingsSnapshot.preset === 'pixel_art' || item.settingsSnapshot.preset === 'document' ? 'classic' : 'realesrgan' } })));
        }
        if (workerConfigured && !aiAvailable && retries++ < 12) retryTimer = setTimeout(() => void loadStatus(), 5_000);
      } catch { /* Status is optional; keep faithful processing available. */ }
    };
    void loadStatus();
    return () => { cancelled = true; clearTimeout(retryTimer); controller?.abort(); };
  }, [update]);

  const addFiles = useCallback(async (files: File[], customSettings?: UpscaleSettings) => {
    if (busyRef.current || addingRef.current || zippingRef.current || metadataBusyRef.current || stockExportBusyRef.current) return;
    addingRef.current = true; setAdding(true);
    const items: ImageQueueItem[] = [];
    const errors: string[] = [];
    try {
      const slots = MAX_BATCH_SIZE - queueRef.current.length;
      if (slots <= 0) { notify('Your queue is full. Remove an image to add another.', 'error'); return; }
      if (files.length > slots) errors.push(`Only ${slots} more image${slots === 1 ? '' : 's'} fit in this queue.`);
      for (const file of files.slice(0, slots)) {
        const error = fileError(file);
        if (error) { errors.push(error); continue; }
        if (memorySize([...queueRef.current, ...items]) + file.size > MAX_BROWSER_BYTES) { errors.push('Download and remove some images to free browser memory.'); break; }
        const previewUrl = URL.createObjectURL(file);
        const dims = await getImageDimensions(previewUrl);
        if (!mounted.current) { URL.revokeObjectURL(previewUrl); break; }
        const initialSettings = { ...(customSettings ?? defaultsRef.current) };
        items.push({
          id: crypto.randomUUID(), name: file.name, file, previewUrl,
          previewAvailable: dims.previewAvailable, originalWidth: dims.width, originalHeight: dims.height,
          originalSize: file.size, status: 'idle', stockMetadata: { ...EMPTY_STOCK_METADATA, keywords: [] }, stockMetadataStatus: 'unavailable',
          settingsSnapshot: initialSettings,
        });
      }
      if (!mounted.current) { items.forEach(release); return; }
      update(previous => [...previous, ...items]);
      if (items.length) setSelectedId(items[0].id);
      if (errors.length) notify(errors[0] + (errors.length > 1 ? ` ${errors.length - 1} other file(s) skipped.` : ''), 'error');
    } finally { addingRef.current = false; if (mounted.current) setAdding(false); }
  }, [notify, update]);

  const addSample = useCallback(async (sample: SampleItem) => {
    if (busyRef.current || addingRef.current || zippingRef.current || metadataBusyRef.current || stockExportBusyRef.current) return;
    // Acquire the same upload lock during the sample fetch, not after it.
    addingRef.current = true; setAdding(true);
    try {
      const response = await fetch(sample.url);
      if (!response.ok) throw new Error('The example could not be loaded. Please try another.');
      const blob = await response.blob();
      if (!mounted.current) return;
      addingRef.current = false;
      await addFiles([new File([blob], `${sample.name.toLowerCase()}.jpg`, { type: 'image/jpeg' })], withPreset(defaultsRef.current, sample.recommendedPreset));
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not load example.', 'error'); }
    finally { addingRef.current = false; if (mounted.current) setAdding(false); }
  }, [addFiles, notify]);

  const selectedItem = queue.find(item => item.id === selectedId) ?? queue[0];
  const settings = selectedItem?.settingsSnapshot ?? defaults;
  const changeSettings = (next: UpscaleSettings) => {
    if (busyRef.current || metadataBusyRef.current || stockExportBusyRef.current) return;
    settingsTouched.current = true;
    defaultsRef.current = { ...next }; setDefaults({ ...next });
    if (selectedItem) update(items => items.map(item => item.id === selectedItem.id ? { ...item, settingsSnapshot: { ...next } } : item));
  };
  const applyToAll = () => {
    if (!busyRef.current && !metadataBusyRef.current && !stockExportBusyRef.current) { update(items => items.map(item => ({ ...item, settingsSnapshot: { ...settings } }))); notify('Settings applied to all images.'); }
  };

  const run = useCallback(async (ids: string[]) => {
    if (busyRef.current || addingRef.current || zippingRef.current || metadataBusyRef.current || stockExportBusyRef.current) return;
    const plan = ids.map(id => queueRef.current.find(item => item.id === id)).filter((item): item is ImageQueueItem => Boolean(item));
    if (!plan.length) return;
    // One lock for the WHOLE batch, including the gaps between awaits.
    busyRef.current = true; stopRequested.current = false; setBusy(true);
    let succeeded = 0;
    try {
      for (const item of plan) {
        if (stopRequested.current || !mounted.current) break;
        const activeSettings = { ...item.settingsSnapshot };
        update(items => items.map(i => i.id === item.id ? { ...i, status: 'processing', errorMessage: undefined } : i));
        controller.current = new AbortController();
        try {
          const limit = item.originalWidth && item.originalHeight ? outputLimitMessage(item.originalWidth, item.originalHeight, activeSettings.scale) : null;
          if (limit) throw new Error(limit);
          const { blob, metadata } = await requestUpscale(item.file, activeSettings, controller.current.signal);
          if (!mounted.current || stopRequested.current) throw new DOMException('Cancelled', 'AbortError');
          const current = queueRef.current.find(i => i.id === item.id);
          if (!current) continue;
          if (memorySize(queueRef.current) - (current.result?.blob.size ?? 0) + blob.size > MAX_BROWSER_BYTES) throw new Error('Browser memory is full. Download and remove some results, then retry.');
          const url = URL.createObjectURL(blob);
          if (current.result) URL.revokeObjectURL(current.result.url);
          update(items => items.map(i => i.id === item.id ? {
            ...i, status: 'success', errorMessage: undefined, originalWidth: metadata.originalWidth, originalHeight: metadata.originalHeight,
            result: { ...metadata, blob, url, scale: activeSettings.scale },
          } : i));
          succeeded++;
        } catch (error) {
          const cancelled = stopRequested.current || (error instanceof Error && error.name === 'AbortError');
          const message = error instanceof Error ? error.message : 'Unable to upscale. Please retry.';
          update(items => items.map(i => i.id === item.id ? { ...i, status: cancelled ? (i.result ? 'success' : 'idle') : 'error', errorMessage: cancelled ? undefined : message } : i));
          if (!cancelled) notify(message, 'error');
        } finally { controller.current = null; }
      }
      if (stopRequested.current) notify('Stopped. Finished images are ready to download.');
      else if (succeeded === plan.length) notify(plan.length === 1 ? 'Your image is ready.' : `${succeeded} images are ready.`);
    } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }, [update, notify]);

  const cancel = () => { stopRequested.current = true; controller.current?.abort(); };
  const remove = (id: string) => {
    if (busyRef.current || addingRef.current || zippingRef.current || metadataBusyRef.current || stockExportBusyRef.current) return;
    const item = queueRef.current.find(i => i.id === id); if (item) release(item);
    update(items => items.filter(i => i.id !== id));
    if (selectedId === id) setSelectedId(queueRef.current[0]?.id ?? null);
  };
  const clear = () => {
    if (busyRef.current || addingRef.current || zippingRef.current || metadataBusyRef.current || stockExportBusyRef.current) return;
    queueRef.current.forEach(release); update(() => []); setSelectedId(null); notify('Workspace cleared.');
  };
  const updateStockMetadata = (id: string, metadata: StockMetadata) => {
    if (busyRef.current || metadataBusyRef.current || stockExportBusyRef.current) return;
    const safe = normalizeStockMetadata({ ...metadata, source: 'edited' }, 'edited');
    update(items => items.map(item => item.id === id ? { ...item, stockMetadata: safe, stockMetadataStatus: 'ready' } : item));
  };
  const generateStockMetadata = async (id: string) => {
    if (!stockMetadataAiAvailable) {
      notify('Image-specific metadata is not configured on this server. Enter a title and keywords manually.', 'error');
      return;
    }
    if (busyRef.current || addingRef.current || zippingRef.current || metadataBusyRef.current || stockExportBusyRef.current) return;
    const item = queueRef.current.find(candidate => candidate.id === id);
    if (!item) return;
    metadataBusyRef.current = true; setMetadataBusy(true);
    update(items => items.map(candidate => candidate.id === id ? { ...candidate, stockMetadataStatus: 'generating' } : candidate));
    try {
      const metadata = await requestStockMetadata(item.file);
      if (!mounted.current) return;
      update(items => items.map(candidate => candidate.id === id ? { ...candidate, stockMetadata: metadata, stockMetadataStatus: 'ready' } : candidate));
      notify('AI metadata is ready to review.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not generate image metadata.';
      update(items => items.map(candidate => candidate.id === id ? { ...candidate, stockMetadataStatus: 'error' } : candidate));
      notify(message, 'error');
    } finally { metadataBusyRef.current = false; if (mounted.current) setMetadataBusy(false); }
  };

  useEffect(() => {
    if (!stockMetadataAiAvailable || busyRef.current || addingRef.current || zippingRef.current || metadataBusyRef.current || stockExportBusyRef.current) return;
    const pending = queue.filter(item => item.stockMetadataStatus === 'unavailable' && !autoMetadataIds.current.has(item.id));
    if (!pending.length) return;
    pending.forEach(item => autoMetadataIds.current.add(item.id));
    metadataBusyRef.current = true;
    setMetadataBusy(true);
    void (async () => {
      for (let index = 0; index < pending.length; index++) {
        const item = pending[index];
        if (!mounted.current) return;
        update(items => items.map(candidate => candidate.id === item.id ? { ...candidate, stockMetadataStatus: 'generating' } : candidate));
        try {
          const metadata = await requestStockMetadata(item.file);
          if (!mounted.current) return;
          update(items => items.map(candidate => candidate.id === item.id ? { ...candidate, stockMetadata: metadata, stockMetadataStatus: 'ready' } : candidate));
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Could not generate image metadata.';
          update(items => items.map(candidate => pending.slice(index).some(next => next.id === candidate.id)
            ? { ...candidate, stockMetadataStatus: 'error' }
            : candidate));
          notify(message, 'error');
          return;
        }
      }
      if (pending.length) notify('Image-specific metadata is ready to review.');
    })().finally(() => {
      metadataBusyRef.current = false;
      if (mounted.current) setMetadataBusy(false);
    });
  }, [queue, stockMetadataAiAvailable, update, notify]);

  const scheduleBlobDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    triggerDownload(url, filename);
    const timer = setTimeout(() => { URL.revokeObjectURL(url); transientUrls.current.delete(url); }, 30_000);
    transientUrls.current.set(url, timer);
  };
  const downloadStockJpeg = async (item: ImageQueueItem) => {
    if (!item.result || !item.stockMetadata.title || !item.stockMetadata.keywords.length) {
      notify('Upscale the image and add a title plus at least one keyword first.', 'error');
      return;
    }
    if (busyRef.current || addingRef.current || zippingRef.current || metadataBusyRef.current || stockExportBusyRef.current) return;
    stockExportBusyRef.current = true; setStockExportBusy(true);
    try {
      const exported = await requestStockJpeg(item.result.blob, item.name, item.stockMetadata);
      if (!mounted.current) return;
      scheduleBlobDownload(exported.blob, downloadName(item.name, item.result.scale, 'jpg'));
      notify(exported.alphaFlattened
        ? `Stock JPEG ready at ${exported.quality}% quality. Transparency was flattened to white; title and keywords are embedded.`
        : `Stock JPEG ready at ${exported.quality}% quality with title and keywords embedded.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Stock JPEG could not be created.', 'error');
    } finally { stockExportBusyRef.current = false; if (mounted.current) setStockExportBusy(false); }
  };
  const downloadZip = async () => {
    if (zippingRef.current || busyRef.current || metadataBusyRef.current || stockExportBusyRef.current) return;
    const completed = queueRef.current.filter(item => item.result);
    if (!completed.length) return;
    if (completed.some(item => !item.stockMetadata.title.trim() || !item.stockMetadata.keywords.length)) {
      notify('Add a title and at least one keyword to every upscaled image first.', 'error');
      return;
    }
    zippingRef.current = true; setZipping(true);
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      const names = uniqueNames(completed.map(item => downloadName(item.name, item.result!.scale, 'jpg')));
      let exportBytes = 0;
      for (const [index, item] of completed.entries()) {
        const exported = await requestStockJpeg(item.result!.blob, item.name, item.stockMetadata);
        exportBytes += exported.blob.size;
        if (memorySize(queueRef.current) + exportBytes > MAX_BROWSER_BYTES) throw new Error('The Stock JPEG batch would exceed this browser’s memory limit. Download images individually.');
        zip.file(names[index], exported.blob);
      }
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      if (!mounted.current) return;
      const url = URL.createObjectURL(blob);
      triggerDownload(url, 'OpenUpscale-stock-jpegs.zip');
      const timer = setTimeout(() => { URL.revokeObjectURL(url); transientUrls.current.delete(url); }, 30_000);
      transientUrls.current.set(url, timer);
      notify(`${completed.length} JPEG${completed.length === 1 ? '' : 's'} ready with embedded titles and keywords.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'JPEGs could not be prepared. Try downloading images individually.', 'error');
    } finally { zippingRef.current = false; if (mounted.current) setZipping(false); }
  };

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length) { event.preventDefault(); void addFiles(files); }
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [addFiles]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; stopRequested.current = true; controller.current?.abort();
      clearTimeout(noticeTimer.current); queueRef.current.forEach(release);
      transientUrls.current.forEach((timer, url) => { clearTimeout(timer); URL.revokeObjectURL(url); });
    };
  }, []);

  return { queue, selectedItem, selectedId, select: setSelectedId, settings, changeSettings, applyToAll,
    busy, adding, zipping, metadataBusy, stockExportBusy, realEsrganAvailable, stockMetadataAiAvailable,
    notice, addFiles, addSample, run, cancel, remove, clear, downloadZip,
    updateStockMetadata, generateStockMetadata, downloadStockJpeg };
}
