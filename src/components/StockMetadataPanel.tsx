import { useEffect, useState, type KeyboardEvent } from 'react';
import { Info, LoaderCircle, Plus, Sparkles, X } from 'lucide-react';
import { ADOBE_STOCK_MAX_KEYWORDS, ADOBE_STOCK_TITLE_MAX_LENGTH, ADOBE_STOCK_KEYWORD_MAX_LENGTH, normalizeKeywords } from '../../shared/stock.ts';
import type { ImageQueueItem, StockMetadata } from '../types.ts';

interface Props {
  item: ImageQueueItem;
  aiAvailable: boolean;
  metadataBusy: boolean;
  locked?: boolean;
  onChange: (metadata: StockMetadata) => void;
  onGenerate: () => void;
}

export function StockMetadataPanel({ item, aiAvailable, metadataBusy, locked, onChange, onGenerate }: Props) {
  const [keywordDraft, setKeywordDraft] = useState('');
  const metadata = item.stockMetadata;
  const disabled = Boolean(locked || metadataBusy);
  const hasMetadata = Boolean(metadata.title || metadata.keywords.length);
  const sourceLabel = metadata.source === 'ai' ? 'AI draft' : metadata.source === 'edited' ? 'Edited' : hasMetadata ? 'Manual' : item.stockMetadataStatus === 'error' && aiAvailable ? 'Retry AI' : item.stockMetadataStatus === 'generating' ? 'AI…' : aiAvailable ? 'Preparing' : 'No AI';

  useEffect(() => setKeywordDraft(''), [item.id]);

  const addKeywords = (raw: string) => {
    const additions = normalizeKeywords(raw.split(/[,;\n]/));
    if (!additions.length) return;
    const next = normalizeKeywords([...metadata.keywords, ...additions]);
    if (next.length === metadata.keywords.length && next.length >= ADOBE_STOCK_MAX_KEYWORDS) return;
    onChange({ ...metadata, keywords: next, source: 'edited' });
    setKeywordDraft('');
  };

  const handleKeywordKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addKeywords(keywordDraft);
    }
    if (event.key === 'Backspace' && !keywordDraft && metadata.keywords.length) {
      onChange({ ...metadata, keywords: metadata.keywords.slice(0, -1), source: 'edited' });
    }
  };

  return <section className="stock-card" aria-labelledby="stock-title">
    <div className="stock-card-heading">
      <div><span className="stock-eyebrow">JPEG METADATA</span><h2 id="stock-title">Title & keywords</h2></div>
      <span className={`stock-source ${metadata.source}`}>{sourceLabel}</span>
    </div>
    <p className="stock-intro">Check these details. They’re embedded in the JPEG you download.</p>

    <label className="stock-field">
      <span>Title <output>{metadata.title.length}/{ADOBE_STOCK_TITLE_MAX_LENGTH}</output></span>
      <input aria-label="Adobe Stock title" type="text" maxLength={ADOBE_STOCK_TITLE_MAX_LENGTH} value={metadata.title}
        placeholder="Describe what you can see" onChange={event => onChange({ ...metadata, title: event.target.value, source: 'edited' })} disabled={disabled} />
    </label>

    <div className="stock-field">
      <label htmlFor="stock-keyword-input"><span>Keywords <output>{metadata.keywords.length}/{ADOBE_STOCK_MAX_KEYWORDS}</output></span></label>
      <div className="keyword-input-row">
        <input id="stock-keyword-input" aria-label="Add a keyword" type="text" maxLength={ADOBE_STOCK_KEYWORD_MAX_LENGTH} value={keywordDraft}
          placeholder="Type a keyword and press Enter" onChange={event => setKeywordDraft(event.target.value)} onKeyDown={handleKeywordKey}
          disabled={disabled || metadata.keywords.length >= ADOBE_STOCK_MAX_KEYWORDS} />
        <button className="keyword-add" type="button" onClick={() => addKeywords(keywordDraft)} disabled={disabled || !keywordDraft.trim() || metadata.keywords.length >= ADOBE_STOCK_MAX_KEYWORDS} aria-label="Add keyword"><Plus size={16} /></button>
      </div>
      <div className="keyword-list" aria-label="Stock keywords">
        {metadata.keywords.map((keyword, index) => <span className="keyword-chip" key={`${keyword.toLowerCase()}-${index}`}>
          {keyword}<button type="button" aria-label={`Remove keyword ${keyword}`} title={`Remove ${keyword}`} disabled={disabled} onClick={() => onChange({ ...metadata, keywords: metadata.keywords.filter((_, itemIndex) => itemIndex !== index), source: 'edited' })}><X size={12} /></button>
        </span>)}
      </div>
    </div>

    {aiAvailable && <div className="stock-actions">
      <button className="button secondary stock-button" type="button" onClick={onGenerate} disabled={disabled}>
        {metadataBusy ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}
        {metadataBusy ? 'Generating…' : item.stockMetadataStatus === 'error' ? 'Try AI again' : 'Regenerate with AI'}
      </button>
    </div>}

    <p className="stock-privacy"><Info size={14} />{aiAvailable
      ? 'AI suggestions use this site’s vision provider. Check every detail against the image.'
      : 'Image AI is off or unavailable. Nothing is guessed; add only details you can verify.'}</p>
  </section>;
}
