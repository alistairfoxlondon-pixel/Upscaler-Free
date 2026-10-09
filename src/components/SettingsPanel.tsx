import React from 'react';
import {
  Sliders,
  Camera,
  Palette,
  FileText,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { UpscaleSettings, UpscalePreset, ScaleFactor, ExportFormat } from '../types.ts';

interface SettingsPanelProps {
  settings: UpscaleSettings;
  onChange: (updated: UpscaleSettings) => void;
  disabled?: boolean;
  activeDimensions?: { width: number; height: number };
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  onChange,
  disabled = false,
  activeDimensions,
}) => {
  const presets: Array<{
    id: UpscalePreset;
    label: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'photo',
      label: 'Photo',
      icon: <Camera className="h-3.5 w-3.5" />,
    },
    {
      id: 'anime',
      label: 'Art / Anime',
      icon: <Palette className="h-3.5 w-3.5" />,
    },
    {
      id: 'document',
      label: 'Text / Doc',
      icon: <FileText className="h-3.5 w-3.5" />,
    },
  ];

  const handlePresetSelect = (preset: UpscalePreset) => {
    let sharpness = 45;
    let denoise = 20;

    if (preset === 'photo') {
      sharpness = 45;
      denoise = 20;
    } else if (preset === 'anime') {
      sharpness = 65;
      denoise = 30;
    } else if (preset === 'document') {
      sharpness = 75;
      denoise = 25;
    }

    onChange({
      ...settings,
      preset,
      sharpness,
      denoise,
    });
  };

  const handleReset = () => {
    onChange({
      scale: 2,
      preset: 'photo',
      sharpness: 45,
      denoise: 20,
      format: 'png',
      quality: 95,
    });
  };

  const targetWidth = activeDimensions ? Math.round(activeDimensions.width * settings.scale) : null;
  const targetHeight = activeDimensions ? Math.round(activeDimensions.height * settings.scale) : null;

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 sm:p-5 shadow-xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-lg bg-cyan-500/10 text-cyan-400">
            <Sliders className="h-3.5 w-3.5" />
          </div>
          <span className="text-xs sm:text-sm font-semibold text-white">Enhancement Settings</span>
        </div>

        <button
          onClick={handleReset}
          disabled={disabled}
          className="text-xs text-slate-400 hover:text-cyan-400 flex items-center gap-1 transition-colors disabled:opacity-40 cursor-pointer"
          title="Reset defaults"
          aria-label="Reset settings to defaults"
        >
          <RotateCcw className="h-3 w-3" />
          <span>Reset</span>
        </button>
      </div>

      {/* 1. Scale Factor */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-slate-300">Upscale Scale</span>
          {targetWidth && targetHeight && (
            <span className="font-mono text-cyan-400 tabular-nums text-[11px]">
              → {targetWidth}×{targetHeight} px
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {([2, 4, 8] as ScaleFactor[]).map((factor) => {
            const isSelected = settings.scale === factor;
            return (
              <button
                key={factor}
                type="button"
                aria-pressed={isSelected}
                disabled={disabled}
                onClick={() => onChange({ ...settings, scale: factor })}
                className={`py-2 px-3 rounded-xl text-center border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-cyan-500/20 border-cyan-500/80 text-white shadow-sm'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                <div className="text-sm font-bold font-mono">{factor}x</div>
                <div className="text-[10px] text-slate-400">
                  {factor === 2 ? 'Fast' : factor === 4 ? 'Balanced' : 'Slowest'}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Enhancement Mode */}
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-slate-300">Mode</span>
        <div className="grid grid-cols-3 gap-1.5">
          {presets.map((p) => {
            const isSelected = settings.preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={isSelected}
                disabled={disabled}
                onClick={() => handlePresetSelect(p.id)}
                className={`py-2 px-2 rounded-lg border text-xs font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  isSelected
                    ? 'bg-cyan-500/20 border-cyan-500/70 text-cyan-300'
                    : 'bg-slate-950/40 border-slate-800/80 text-slate-400 hover:text-slate-200'
                }`}
              >
                {p.icon}
                <span>{p.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Sliders: Sharpness and Denoise */}
      <div className="space-y-3 pt-2 border-t border-slate-800/80">
        {/* Sharpness */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Sharpness</span>
            <span className="font-mono tabular-nums text-slate-300">{settings.sharpness}%</span>
          </div>
          <input
            type="range"
            aria-label="Sharpness"
            min="0"
            max="100"
            value={settings.sharpness}
            disabled={disabled}
            onChange={(e) => onChange({ ...settings, sharpness: Number(e.target.value) })}
            className="w-full accent-cyan-400 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
          />
        </div>

        {/* Denoise */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Artifact Denoise</span>
            <span className="font-mono tabular-nums text-slate-300">{settings.denoise}%</span>
          </div>
          <input
            type="range"
            aria-label="Artifact denoise"
            min="0"
            max="100"
            value={settings.denoise}
            disabled={disabled}
            onChange={(e) => onChange({ ...settings, denoise: Number(e.target.value) })}
            className="w-full accent-cyan-400 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
          />
        </div>
      </div>

      {/* 4. Format & Quality */}
      <div className="space-y-2 pt-2 border-t border-slate-800/80">
        <span className="text-xs font-medium text-slate-300">Format</span>
        <div className="grid grid-cols-3 gap-2">
          {(['png', 'jpg', 'webp'] as ExportFormat[]).map((fmt) => {
            const isSelected = settings.format === fmt;
            return (
              <button
                key={fmt}
                type="button"
                aria-pressed={isSelected}
                disabled={disabled}
                onClick={() => onChange({ ...settings, format: fmt })}
                className={`py-1.5 px-3 rounded-lg text-center font-mono uppercase text-xs font-semibold border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-cyan-500/20 border-cyan-500/80 text-white'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {fmt}
              </button>
            );
          })}
        </div>

        {settings.format !== 'png' && (
          <div className="space-y-1 pt-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Quality</span>
              <span className="font-mono tabular-nums text-slate-300">{settings.quality}%</span>
            </div>
            <input
              type="range"
              aria-label="Quality"
              min="70"
              max="100"
              value={settings.quality}
              disabled={disabled}
              onChange={(e) => onChange({ ...settings, quality: Number(e.target.value) })}
              className="w-full accent-cyan-400 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
            />
          </div>
        )}
      </div>
    </div>
  );
};
