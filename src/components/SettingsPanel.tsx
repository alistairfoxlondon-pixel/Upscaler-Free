import { ChevronDown, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { PRESET_PARAMS, checkOutputLimits, type UpscalePreset } from '@/server/presets.ts';
import { DEFAULT_SETTINGS, type ExportFormat, type ScaleFactor, type UpscaleSettings } from '../types.ts';

interface SettingsPanelProps {
  settings: UpscaleSettings;
  onChange: (updated: UpscaleSettings) => void;
  disabled?: boolean;
  activeDimensions?: { width: number; height: number };
}

const MODES: Array<{ id: UpscalePreset; label: string; hint: string }> = [
  { id: 'auto', label: 'Auto', hint: 'Detects per image' },
  { id: 'photo', label: 'Photo', hint: 'Faces & scenes' },
  { id: 'anime', label: 'Art', hint: 'Illustration & anime' },
  { id: 'document', label: 'Text', hint: 'Docs & screenshots' },
];

const FORMATS: Array<{ id: ExportFormat; label: string; hint: string }> = [
  { id: 'png', label: 'PNG', hint: 'Lossless, largest' },
  { id: 'webp', label: 'WebP', hint: 'Sharp & small' },
  { id: 'jpg', label: 'JPG', hint: 'Universal' },
];

/** The values the server will actually apply for the current mode. */
function effectiveParams(settings: UpscaleSettings) {
  if (settings.preset === 'custom') {
    return { sharpness: settings.sharpness, denoise: settings.denoise, detailBoost: settings.detailBoost };
  }
  if (settings.preset === 'auto') return PRESET_PARAMS.photo; // displayed as an estimate
  return PRESET_PARAMS[settings.preset];
}

const Slider = ({
  label, value, min, max, onChange, disabled, suffix = '',
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  suffix?: string;
}) => {
  const pct = Math.round(((value - min) / (max - min)) * 100);
  return (
    <label className="block">
      <span className="mb-0.5 flex items-baseline justify-between text-xs">
        <span className="text-ink-soft">{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-ink">{value > 0 && min < 0 ? `+${value}` : value}{suffix}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ['--range-progress' as string]: `${pct}%` }}
      />
    </label>
  );
};

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  onChange,
  disabled = false,
  activeDimensions,
}) => {
  const eff = effectiveParams(settings);
  const isCustom = settings.preset === 'custom';
  const targetWidth = activeDimensions ? Math.round(activeDimensions.width * settings.scale) : null;
  const targetHeight = activeDimensions ? Math.round(activeDimensions.height * settings.scale) : null;
  const overLimit = activeDimensions
    ? !checkOutputLimits(activeDimensions.width, activeDimensions.height, settings.scale).ok
    : false;

  const setScale = (scale: ScaleFactor) => onChange({ ...settings, scale });

  const selectMode = (preset: UpscalePreset) => {
    onChange({ ...settings, preset, ...PRESET_PARAMS[preset === 'auto' ? 'photo' : preset === 'custom' ? 'custom' : preset] });
  };

  /** Moving a refine slider switches to Custom, seeded with the current effective values. */
  const tune = (key: 'sharpness' | 'denoise' | 'detailBoost', value: number) => {
    onChange({ ...settings, ...eff, [key]: value, preset: 'custom' });
  };

  const activeModeId: UpscalePreset | 'digital_art-ui' =
    settings.preset === 'digital_art' ? 'anime' : settings.preset;

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          <SlidersHorizontal className="h-3.5 w-3.5" /> Settings
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ ...DEFAULT_SETTINGS })}
          className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-ink-faint transition hover:text-brand disabled:opacity-40"
          title="Reset all settings"
        >
          <RotateCcw className="h-3 w-3" /> Reset
        </button>
      </div>

      {/* Scale */}
      <div className="mb-3 grid grid-cols-3 gap-1.5">
        {([2, 4, 8] as ScaleFactor[]).map((factor) => {
          const tooBig = activeDimensions
            ? !checkOutputLimits(activeDimensions.width, activeDimensions.height, factor).ok
            : false;
          const selected = settings.scale === factor;
          return (
            <button
              key={factor}
              type="button"
              disabled={disabled || tooBig}
              onClick={() => setScale(factor)}
              title={tooBig ? `${factor}× would exceed the 12,000 px / 64 MP limit` : `Enlarge ${factor}×`}
              className={`cursor-pointer rounded-lg border px-2 py-1.5 text-center transition disabled:cursor-not-allowed disabled:opacity-35 ${
                selected
                  ? 'border-brand bg-brand-soft text-brand'
                  : 'border-line text-ink-soft hover:border-line-strong hover:text-ink'
              }`}
            >
              <span className="block font-mono text-sm font-bold">{factor}×</span>
              <span className="block text-[10px] opacity-70">{factor === 2 ? 'fast' : factor === 4 ? 'big' : 'max'}</span>
            </button>
          );
        })}
      </div>

      {targetWidth && targetHeight && (
        <p className={`mb-3 text-center font-mono text-[11px] tabular-nums ${overLimit ? 'text-err' : 'text-ink-faint'}`}>
          {activeDimensions!.width}×{activeDimensions!.height} → {targetWidth}×{targetHeight} px
        </p>
      )}

      {/* Mode */}
      <div className="mb-3">
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Mode</p>
        <div className="grid grid-cols-4 gap-1.5">
          {MODES.map((mode) => {
            const selected = activeModeId === mode.id && !isCustom;
            return (
              <button
                key={mode.id}
                type="button"
                disabled={disabled}
                onClick={() => selectMode(mode.id)}
                title={mode.hint}
                className={`cursor-pointer rounded-lg border px-1 py-1.5 text-[11px] font-semibold transition ${
                  selected
                    ? 'border-brand bg-brand-soft text-brand'
                    : 'border-line text-ink-soft hover:border-line-strong hover:text-ink'
                }`}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Refine */}
      <div className="space-y-2 rounded-xl bg-canvas p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Refine</span>
          {isCustom ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange({ ...settings, preset: 'auto' })}
              className="cursor-pointer text-[11px] font-medium text-brand hover:underline"
            >
              Back to Auto
            </button>
          ) : (
            <span className="text-[11px] text-ink-faint">
              {settings.preset === 'auto' ? 'auto-tuned' : 'mode default'} — drag to fine-tune
            </span>
          )}
        </div>
        <Slider label="Sharpness" value={eff.sharpness} min={0} max={100} disabled={disabled} onChange={(v) => tune('sharpness', v)} suffix="%" />
        <Slider label="Denoise" value={eff.denoise} min={0} max={100} disabled={disabled} onChange={(v) => tune('denoise', v)} suffix="%" />
        <Slider label="Detail boost" value={eff.detailBoost} min={0} max={100} disabled={disabled} onChange={(v) => tune('detailBoost', v)} suffix="%" />
      </div>

      {/* Color */}
      <details className="group mt-3">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint transition hover:text-ink">
          <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" /> Color
          {(settings.contrast !== 0 || settings.brightness !== 0 || settings.saturation !== 0) && (
            <span className="ml-1 h-1.5 w-1.5 rounded-full bg-brand" aria-label="Color adjusted" />
          )}
        </summary>
        <div className="mt-2 space-y-2 rounded-xl bg-canvas p-3">
          <Slider label="Contrast" value={settings.contrast} min={-50} max={50} disabled={disabled} onChange={(v) => onChange({ ...settings, contrast: v })} />
          <Slider label="Brightness" value={settings.brightness} min={-50} max={50} disabled={disabled} onChange={(v) => onChange({ ...settings, brightness: v })} />
          <Slider label="Saturation" value={settings.saturation} min={-50} max={50} disabled={disabled} onChange={(v) => onChange({ ...settings, saturation: v })} />
        </div>
      </details>

      {/* Output */}
      <div className="mt-3">
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Output</p>
        <div className="grid grid-cols-3 gap-1.5">
          {FORMATS.map((fmt) => {
            const selected = settings.format === fmt.id;
            return (
              <button
                key={fmt.id}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ ...settings, format: fmt.id })}
                title={fmt.hint}
                className={`cursor-pointer rounded-lg border px-1 py-1.5 font-mono text-[11px] font-semibold uppercase transition ${
                  selected
                    ? 'border-brand bg-brand-soft text-brand'
                    : 'border-line text-ink-soft hover:border-line-strong hover:text-ink'
                }`}
              >
                {fmt.label}
              </button>
            );
          })}
        </div>
        {settings.format === 'png' ? (
          <p className="mt-1.5 text-[11px] text-ink-faint">PNG is lossless — files are large at 4× and 8×.</p>
        ) : (
          <div className="mt-2">
            <Slider
              label="Quality"
              value={settings.quality}
              min={70}
              max={100}
              disabled={disabled}
              onChange={(v) => onChange({ ...settings, quality: v })}
              suffix="%"
            />
          </div>
        )}
      </div>
    </div>
  );
};
