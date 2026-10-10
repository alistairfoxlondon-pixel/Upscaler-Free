import { useRef, useState } from 'react';
import { ArrowUpRight, ImagePlus, Upload } from 'lucide-react';
import { SAMPLE_IMAGES, type SampleItem } from '../data/samples.ts';
interface Props {
  onFilesSelected: (files: File[]) => void;
  onSampleSelected: (sample: SampleItem) => void;
  onBrowse: () => void;
  disabled?: boolean;
  adding?: boolean;
  metadataAiAvailable?: boolean;
}
export function UploadZone({ onFilesSelected, onSampleSelected, onBrowse, disabled, adding, metadataAiAvailable = false }: Props) {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  return <div className="upload-content">
    <div className={`dropzone ${dragging ? 'is-dragging' : ''} ${disabled ? 'is-disabled' : ''}`}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = disabled ? 'none' : 'copy'; }}
      onDragEnter={e => { e.preventDefault(); dragDepth.current++; if (!disabled) setDragging(true); }}
      onDragLeave={e => { e.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }}
      onDrop={e => { e.preventDefault(); dragDepth.current = 0; setDragging(false); if (!disabled) onFilesSelected(Array.from(e.dataTransfer.files)); }}>
      <div className="upload-illustration" aria-hidden="true"><div className="image-card-back" /><div className="image-card-front"><ImagePlus size={33} strokeWidth={1.35} /><span><ArrowUpRight size={17} /></span></div></div>
      <h2>{dragging ? 'Drop it. We’ve got it.' : 'A little upload. A big difference.'}</h2>
      <p>Drag your images here, or choose a file.</p>
      <button className="button primary upload-button" onClick={onBrowse} disabled={disabled}><Upload size={17} />{adding ? 'Opening images…' : 'Choose images'}</button>
      <span className="upload-formats">JPG, PNG, WebP & more <span>·</span> 4 MB each</span>
      <span className="paste-hint">You can paste an image, too <kbd>Ctrl + V</kbd></span>
      <span className="upload-meta-note">{metadataAiAvailable ? 'AI metadata is on: uploads are sent to this site’s vision provider.' : 'No metadata is guessed. Add only details you can verify.'}</span>
    </div>
    <div className="examples" id="examples">
      <div className="examples-heading"><span>Just looking?</span> Try an example <ArrowUpRight size={14} /></div>
      <div className="sample-list">{SAMPLE_IMAGES.map(sample => <button key={sample.id} className="sample-button" disabled={disabled} onClick={() => onSampleSelected(sample)} aria-label={`Try ${sample.name.toLowerCase()} example`}><img src={sample.url} alt="" width={52} height={52} /><span>{sample.name}</span></button>)}</div>
    </div>
  </div>;
}
