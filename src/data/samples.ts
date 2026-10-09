import benchmarkPortrait from '../assets/images/benchmark_portrait_lowres.jpg';
import benchmarkNature from '../assets/images/benchmark_nature_lowres.jpg';
import benchmarkDigitalArt from '../assets/images/benchmark_art_lowres.jpg';
import benchmarkArchitecture from '../assets/images/benchmark_architecture_lowres.jpg';

export interface SampleItem {
  id: string;
  name: string;
  category: string;
  url: string;
  description: string;
}

export const SAMPLE_IMAGES: SampleItem[] = [
  {
    id: 'benchmark-portrait',
    name: 'Portrait (Low-Res)',
    category: 'Portrait',
    url: benchmarkPortrait,
    description: 'Soft low-res face — check eyes, lashes, and skin texture after upscaling.',
  },
  {
    id: 'benchmark-nature',
    name: 'Macro Leaf & Frog',
    category: 'Nature',
    url: benchmarkNature,
    description: 'Compressed nature shot — look for crisp water droplets and leaf veins.',
  },
  {
    id: 'benchmark-digital-art',
    name: 'Cyberpunk Illustration',
    category: 'Art',
    url: benchmarkDigitalArt,
    description: 'Illustration with linework — edges should stay clean, no halos.',
  },
  {
    id: 'benchmark-architecture',
    name: 'Glass Architecture',
    category: 'Lines',
    url: benchmarkArchitecture,
    description: 'Repeating geometry — a stress test for ringing and moiré.',
  },
];
