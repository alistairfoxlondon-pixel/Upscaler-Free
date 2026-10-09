import benchmarkPortrait from '../assets/images/benchmark_portrait_lowres.jpg';
import benchmarkNature from '../assets/images/benchmark_nature_lowres.jpg';
import benchmarkDigitalArt from '../assets/images/benchmark_art_lowres.jpg';
import benchmarkArchitecture from '../assets/images/benchmark_architecture_lowres.jpg';

export interface SampleItem {
  id: string;
  name: string;
  category: string;
  url: string;
  serverPath: string;
  recommendedPreset: 'photo' | 'digital_art' | 'anime' | 'document';
  description: string;
}

export const SAMPLE_IMAGES: SampleItem[] = [
  {
    id: 'benchmark-portrait',
    name: 'Portrait (Low-Res 400px)',
    category: 'Face & Hair Detail',
    url: benchmarkPortrait,
    serverPath: 'src/assets/images/benchmark_portrait_lowres.jpg',
    recommendedPreset: 'photo',
    description: 'Soft blurred 400px portrait. Upscale to restore sharp eyes, lashes, and skin texture.',
  },
  {
    id: 'benchmark-nature',
    name: 'Macro Leaf & Frog (400px)',
    category: 'Nature & Water Drops',
    url: benchmarkNature,
    serverPath: 'src/assets/images/benchmark_nature_lowres.jpg',
    recommendedPreset: 'photo',
    description: 'Compressed nature shot. Upscale to reveal crisp water droplets and fine leaf veins.',
  },
  {
    id: 'benchmark-digital-art',
    name: 'Cyberpunk Illustration (360px)',
    category: 'Anime & Linework',
    url: benchmarkDigitalArt,
    serverPath: 'src/assets/images/benchmark_art_lowres.jpg',
    recommendedPreset: 'anime',
    description: 'Pixelated anime/digital artwork. Upscale for clean vector-like outlines and vivid neon.',
  },
  {
    id: 'benchmark-architecture',
    name: 'Glass Architecture (400px)',
    category: 'Sharp Lines & Geometry',
    url: benchmarkArchitecture,
    serverPath: 'src/assets/images/benchmark_architecture_lowres.jpg',
    recommendedPreset: 'document',
    description: 'Low-res structural lines. Upscale for razor-sharp geometric edges and reflections.',
  },
];
