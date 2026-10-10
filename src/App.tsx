import { useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, CheckCircle2, CircleHelp, Image, Info, LoaderCircle, Plus, ShieldCheck, X } from 'lucide-react';
import { Header } from './components/Header.tsx';
import { UploadZone } from './components/UploadZone.tsx';
import { SettingsPanel } from './components/SettingsPanel.tsx';
import { ComparisonSlider } from './components/ComparisonSlider.tsx';
import { BatchQueue } from './components/BatchQueue.tsx';
import { OpenSourceDocsModal } from './components/OpenSourceDocsModal.tsx';
import { useUpscaler } from './hooks/useUpscaler.ts';
import { FILE_ACCEPT } from './lib/files.ts';
import { outputLimitMessage, sameSettings } from '../shared/upscale.ts';

export default function App() {
  const studio = useUpscaler();
  const [docsOpen, setDocsOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const item = studio.selectedItem;
  const locked = studio.busy || studio.adding || studio.zipping;
  const limit = item?.originalWidth && item.originalHeight ? outputLimitMessage(item.originalWidth, item.originalHeight, studio.settings.scale) : null;
  const changed = Boolean(item?.result && !sameSettings(item.result.settings, studio.settings));
  const needsPrimaryUpscale = !item?.result || changed || item.status === 'error';
  const browse = () => fileInput.current?.click();
  return <div className="app-shell">
    <a className="skip-link" href="#workspace">Skip to upscaler</a>
    <Header onOpenDocs={() => setDocsOpen(true)} />
    <main className="main-content">
      <section className={`intro ${item ? 'compact-intro' : ''}`} aria-labelledby="page-title">
        <div className="eyebrow"><span className="little-dot" />LESS PIXELATED. MORE POSSIBILITIES.</div>
        <h1 id="page-title">Small image. <span>Big potential.</span></h1>
        <p>Make it bigger. Keep it natural.</p>
      </section>
      <input ref={fileInput} className="visually-hidden" tabIndex={-1} type="file" multiple accept={FILE_ACCEPT} aria-label="Upload images" disabled={locked} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void studio.addFiles(files); }} />
      <div className="studio-layout" id="workspace">
        <div className="workspace-column">
          <section className={`workspace-card ${item ? 'has-image' : ''}`} aria-label="Image workspace">
            <div className="workspace-heading"><div><span className="workspace-icon"><Image size={17} /></span><h2>{item ? item.name : 'Your image, reimagined in size.'}</h2>{item?.status === 'success' && <span className="ready-badge"><Check size={12} />Ready</span>}</div>
              {item ? <div className="workspace-actions"><button className="text-button" onClick={browse} disabled={locked || studio.queue.length >= 20}><Plus size={15} />Add images</button><button className="icon-button" aria-label="Remove current image" title="Remove current image" disabled={locked} onClick={() => studio.remove(item.id)}><X size={17} /></button></div> : <span className="workspace-step">01 — UPLOAD</span>}
            </div>
            {item ? <ComparisonSlider item={item} onDownload={studio.download} /> : <UploadZone onFilesSelected={studio.addFiles} onSampleSelected={studio.addSample} onBrowse={browse} disabled={locked} adding={studio.adding} />}
          </section>
          {item?.errorMessage && <div className="inline-alert" role="alert"><Info size={17} /><span>{item.errorMessage}{item.result && ' Your previous result is still available.'}</span></div>}
          <BatchQueue items={studio.queue} selectedId={item?.id} onSelect={studio.select} onRemove={studio.remove} onClear={studio.clear}
            onProcess={() => void studio.run(studio.queue.filter(i => i.status === 'idle' || i.status === 'error').map(i => i.id))}
            onZip={() => void studio.downloadZip()} onApply={studio.applyToAll} onBrowse={browse} busy={studio.busy} zipping={studio.zipping} disabled={locked} />
        </div>
        <aside className="settings-card" aria-label="Upscale settings">
          <SettingsPanel settings={studio.settings} onChange={studio.changeSettings} disabled={locked} activeDimensions={item?.originalWidth && item.originalHeight ? { width: item.originalWidth, height: item.originalHeight } : undefined} />
          <div className="upscale-action">
            {limit && <p className="limit-warning" role="alert">{limit}</p>}
            {studio.settings.scale === 8 && !limit && <p className="scale-note"><Info size={14} />A bigger file, not 8× more detail.</p>}
            {changed && <p className="settings-changed"><span />Settings changed. Upscale to apply.</p>}
            <button className={`button ${needsPrimaryUpscale ? 'primary' : 'secondary'} upscale-button`} disabled={!item || locked || Boolean(limit)} onClick={() => item && void studio.run([item.id])}>
              {studio.busy ? <><LoaderCircle size={18} className="spin" />Upscaling…</> : <>{item?.status === 'error' ? 'Try again' : changed ? 'Apply & upscale' : item?.result ? 'Upscale again' : 'Upscale image'}<ArrowUpRight size={19} /></>}
            </button>
            {studio.busy ? <button className="cancel-button" onClick={studio.cancel}>Stop processing</button> : <p className="engine-note">Real pixels. No invented details.</p>}
          </div>
        </aside>
      </div>
      <div className="trust-row"><span><ShieldCheck size={16} />No stored uploads</span><span><CheckCircle2 size={16} />No account needed</span><button onClick={() => setDocsOpen(true)}><CircleHelp size={16} />Made to be transparent<ArrowRight size={13} /></button></div>
      {!item && <div className="simple-steps" aria-label="Three simple steps"><span><b>01</b>Upload</span><i /><span><b>02</b>Upscale</span><i /><span><b>03</b>Make it yours</span></div>}
    </main>
    <footer className="site-footer"><span>A little more room for your images.</span><div><span>OpenUpscale © {new Date().getFullYear()}</span><span className="footer-dot">·</span><button onClick={() => setDocsOpen(true)}>Privacy & details</button></div></footer>
    {studio.notice && <div className={`toast ${studio.notice.kind}`} role={studio.notice.kind === 'error' ? 'alert' : 'status'}>{studio.notice.kind === 'error' ? <Info size={17} /> : <CheckCircle2 size={17} />}<span>{studio.notice.text}</span></div>}
    <OpenSourceDocsModal isOpen={docsOpen} onClose={() => setDocsOpen(false)} />
  </div>;
}
