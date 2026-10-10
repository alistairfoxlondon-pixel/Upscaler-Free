import { ArrowRight, ChevronDown, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { DEFAULT_SETTINGS, SUPPORTED_SCALES, outputLimitMessage, withPreset } from '../../shared/upscale.ts';
import type { UpscaleSettings } from '../types.ts';
interface Props { settings: UpscaleSettings; onChange: (next: UpscaleSettings) => void; disabled?: boolean; realEsrganAvailable?: boolean; activeDimensions?: { width: number; height: number } }
export function SettingsPanel({ settings, onChange, disabled, realEsrganAvailable = false, activeDimensions }: Props) {
  const pixelArt = settings.preset === 'pixel_art';
  const preserveExactEdges = pixelArt || settings.preset === 'document';
  return <div className="settings-panel">
    <div className="section-title"><h2>The right fit.</h2><button className="icon-button reset-button" aria-label="Reset settings" title="Reset settings" disabled={disabled} onClick={() => onChange({ ...DEFAULT_SETTINGS })}><RotateCcw size={16} /></button></div>
    <fieldset disabled={disabled} className="control-group">
      <legend>Scale <span className="recommended">2× recommended</span></legend>
      <div className="segmented scale-options">{SUPPORTED_SCALES.map(scale => {
        const invalid = activeDimensions ? outputLimitMessage(activeDimensions.width, activeDimensions.height, scale) : null;
        return <button key={scale} type="button" aria-pressed={settings.scale === scale} disabled={Boolean(invalid)} title={invalid ?? `Enlarge ${scale} times`} onClick={() => onChange({ ...settings, scale })}>{scale}<span>×</span></button>;
      })}</div>
      <p className="control-hint dimensions-hint">{activeDimensions ? <><span>{activeDimensions.width.toLocaleString()} × {activeDimensions.height.toLocaleString()}</span><ArrowRight size={11} aria-hidden="true" /><strong>{(activeDimensions.width * settings.scale).toLocaleString()} × {(activeDimensions.height * settings.scale).toLocaleString()} px</strong></> : 'More pixels. Same proportions.'}</p>
    </fieldset>
    {realEsrganAvailable && <fieldset className="control-group engine-group" disabled={disabled}>
      <legend>Upscaling engine</legend>
      <div className="segmented engine-options">
        <button type="button" aria-pressed={settings.engine === 'classic'} onClick={() => onChange({ ...settings, engine: 'classic' })}>Faithful</button>
        <button type="button" aria-pressed={settings.engine === 'realesrgan'} disabled={preserveExactEdges}
          title={preserveExactEdges ? 'Use the faithful engine to preserve text and crisp edges.' : 'Use the configured and verified Real-ESRGAN GPU worker.'}
          onClick={() => onChange({ ...settings, engine: 'realesrgan' })}>Real-ESRGAN AI</button>
      </div>
      <p className="control-hint">{settings.engine === 'realesrgan'
        ? 'Neural restoration can invent plausible details. Inspect at 100% before commercial use.'
        : preserveExactEdges ? 'Faithful mode protects text and pixel edges from generative changes.'
          : 'Faithful resampling is ready. Choose AI only when you want generative detail.'}</p>
    </fieldset>}
    <fieldset className="control-group type-group" disabled={disabled}>
      <legend>Image type</legend>
      <div className="segmented type-options">
        <button type="button" aria-pressed={settings.preset === 'photo'} onClick={() => onChange(withPreset(settings, 'photo'))}>Photo & art</button>
        <button type="button" aria-pressed={settings.preset === 'document'} onClick={() => onChange(withPreset(settings, 'document'))}>Text & documents</button>
        <button type="button" aria-pressed={pixelArt} onClick={() => onChange(withPreset(settings, 'pixel_art'))}>Pixel art</button>
      </div>
      {pixelArt && <p className="control-hint">Exact nearest-neighbour scaling keeps pixel edges crisp.</p>}
      {settings.preset === 'document' && <p className="control-hint">Faithful enlargement with gentle edge sharpening; AI is disabled to protect text.</p>}
    </fieldset>
    <details className="adjustments">
      <summary><span><SlidersHorizontal size={15} />Fine-tune</span><ChevronDown size={15} /></summary>
      <div className="adjustments-inner">{([
        ['sharpness', 'Sharpness', 0, 100], ['denoise', 'Smooth noise', 0, 100],
        ['brightness', 'Brightness', -50, 50], ['contrast', 'Contrast', -50, 50], ['saturation', 'Saturation', -50, 50],
      ] as const).map(([key, name, min, max]) => <label className="range-control" key={key}><span>{name}<output>{settings[key]}</output></span><input type="range" aria-label={name} min={min} max={max} value={settings[key]} disabled={disabled || (pixelArt && (key === 'sharpness' || key === 'denoise'))} onChange={event => onChange({ ...settings, [key]: Number(event.target.value) })} /></label>)}</div>
    </details>
  </div>;
}
