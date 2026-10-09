export default function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    status: 'online',
    engine: 'OpenUpscale ESRGAN Super-Resolution',
    deployment: 'Vercel Serverless / Edge Compatible',
    libraries: [
      { name: 'ESRGAN (UpscalerJS slim models)', role: 'Neural super-resolution (2x, 4x, 8x)' },
      { name: 'Sharp (libvips)', role: 'Decoding, Lanczos-3 fallback resize, encoding' },
    ],
    supportedFormats: ['JPG', 'PNG', 'WEBP', 'AVIF', 'BMP', 'TIFF'],
    exportFormats: ['JPG', 'PNG', 'WEBP'],
    privacy: {
      ephemeralMode: true,
      persistentStorage: false,
    },
  });
}
