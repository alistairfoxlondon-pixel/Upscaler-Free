import { ArrowRight, ChevronDown, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { DEFAULT_SETTINGS, SUPPORTED_FORMATS, SUPPORTED_SCALES, outputLimitMessage, withPreset } from '../../shared/upscale.ts';
import type { UpscaleSettings } from '../types.ts';
interface Props { settings: UpscaleSettings; onChange: (next: UpscaleSettings) => void; disabled?: boolean; activeDimensions?: { width: number; height: number } }
export function SettingsPanel({ settings, onChange, disabled, activeDimensions }: Props) {
  const pixelArt = settings.preset === 'pixel_art';
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
    <fieldset className="control-group" disabled={disabled}>
      <legend>Image type</legend>
      <div className="segmented type-options"><button type="button" aria-pressed={!pixelArt} onClick={() => onChange(withPreset(settings, 'photo'))}>Photo & art</button><button type="button" aria-pressed={pixelArt} onClick={() => onChange(withPreset(settings, 'pixel_art'))}>Pixel art</button></div>
      {pixelArt && <p className="control-hint">Keeps pixel edges crisp. No smoothing.</p>}
    </fieldset>
    <fieldset className="control-group" disabled={disabled}>
      <legend>Save as</legend>
      <div className="segmented format-options">{SUPPORTED_FORMATS.map(format => <button key={format} type="button" aria-pressed={settings.format === format} onClick={() => onChange({ ...settings, format })}>{format.toUpperCase()}</button>)}</div>
      <p className="control-hint">{settings.format === 'png' ? 'Lossless. Keeps transparency.' : settings.format === 'jpg' ? 'Smaller file. White background.' : settings.quality === 100 ? 'Lossless. Keeps transparency.' : 'Smaller file. Keeps transparency.'}</p>
      {settings.format !== 'png' && <label className="range-control"><span>Quality<output>{settings.quality === 100 && settings.format === 'webp' ? 'Lossless' : `${settings.quality}%`}</output></span><input aria-label="Export quality" type="range" min={70} max={100} value={settings.quality} onChange={e => onChange({ ...settings, quality: Number(e.target.value) })} /></label>}
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
