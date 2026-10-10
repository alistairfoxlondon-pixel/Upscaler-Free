import { Check, Download, Image, LoaderCircle, Plus, Trash2, X, AlertCircle, ArrowUpRight } from 'lucide-react';
import type { ImageQueueItem } from '../types.ts';
interface Props { items: ImageQueueItem[]; selectedId?: string; onSelect: (id: string) => void; onRemove: (id: string) => void; onClear: () => void; onProcess: () => void; onZip: () => void; onApply: () => void; onBrowse: () => void; busy: boolean; zipping: boolean; disabled: boolean }
export function BatchQueue({ items, selectedId, onSelect, onRemove, onClear, onProcess, onZip, onApply, onBrowse, busy, zipping, disabled }: Props) {
  if (items.length < 2) return null;
  const waiting = items.filter(item => item.status === 'idle' || item.status === 'error').length;
  const ready = items.filter(item => item.result).length;
  return <section className="batch-section" aria-label="Image queue">
    <div className="batch-heading"><h2>Your images <span>{items.length}/20</span></h2><div className="batch-actions">
      <button className="text-button" onClick={onApply} disabled={disabled}>Apply settings to all</button>
      <button className="icon-button" onClick={onClear} disabled={disabled} aria-label="Clear all images" title="Clear all images"><Trash2 size={16} /></button>
    </div></div>
    <div className="queue-list">{items.map(item => <div key={item.id} className={`queue-card ${item.id === selectedId ? 'selected' : ''}`}>
      <button className="queue-select" onClick={() => onSelect(item.id)} aria-pressed={item.id === selectedId} aria-label={`Select ${item.name}`}>
        {item.previewAvailable ? <img src={item.previewUrl} alt="" /> : <span className="queue-placeholder"><Image size={20} /></span>}
        <span><strong>{item.name}</strong><small>{item.status === 'processing' ? 'Upscaling…' : item.status === 'success' ? `${item.result?.scale}× ready` : item.status === 'error' ? 'Needs attention' : `${item.settingsSnapshot.scale}× · Ready to upscale`}</small></span>
      </button>
      <div className="queue-status">{item.status === 'success' ? <Check size={13} /> : item.status === 'error' ? <AlertCircle size={13} /> : item.status === 'processing' ? <LoaderCircle className="spin" size={13} /> : null}</div>
      <button className="queue-remove" onClick={() => onRemove(item.id)} disabled={disabled} aria-label={`Remove ${item.name}`}><X size={13} /></button>
    </div>)}<button className="queue-add" onClick={onBrowse} disabled={disabled || items.length >= 20} aria-label="Add more images"><Plus size={20} /></button></div>
    <div className="batch-bottom"><span>{ready} ready <span>·</span> {waiting} waiting</span><div>{waiting > 0 && <button className="button secondary small" disabled={disabled} onClick={onProcess}>{busy ? 'Upscaling…' : `Upscale all (${waiting})`}<ArrowUpRight size={15} /></button>}<button className="button secondary small" disabled={!ready || disabled} onClick={onZip}>{zipping ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}{zipping ? 'Creating ZIP…' : 'Download ZIP'}</button></div></div>
  </section>;
}
