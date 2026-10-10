import portrait from '../assets/images/benchmark_portrait_lowres.jpg';
import nature from '../assets/images/benchmark_nature_lowres.jpg';
import art from '../assets/images/benchmark_art_lowres.jpg';
import architecture from '../assets/images/benchmark_architecture_lowres.jpg';
import type { UpscalePreset } from '../types.ts';
export interface SampleItem { id: string; name: string; url: string; recommendedPreset: UpscalePreset }
// Local demonstration inputs, not ground-truth references or fabricated "after" images.
export const SAMPLE_IMAGES: SampleItem[] = [
  { id: 'portrait', name: 'Portrait', url: portrait, recommendedPreset: 'photo' },
  { id: 'nature', name: 'Nature', url: nature, recommendedPreset: 'photo' },
  { id: 'art', name: 'Illustration', url: art, recommendedPreset: 'digital_art' },
  { id: 'architecture', name: 'Architecture', url: architecture, recommendedPreset: 'document' },
];
