export default function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    status: 'online',
    engine: 'OpenUpscale Cloud Super-Resolution',
    deployment: 'Vercel Serverless / Edge Compatible',
    libraries: [
      { name: 'Sharp (libvips)', role: 'Lanczos-3 & SIMD Super-Resolution' },
      { name: 'JSZip', role: 'In-Memory Batch Archiving' },
    ],
    supportedFormats: ['JPG', 'PNG', 'WEBP', 'AVIF', 'BMP', 'TIFF'],
    exportFormats: ['JPG', 'PNG', 'WEBP'],
    privacy: {
      ephemeralMode: true,
      persistentStorage: false,
    },
  });
}
