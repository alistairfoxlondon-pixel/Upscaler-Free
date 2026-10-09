export default function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    status: 'online',
    engine: 'Sharp/libvips cloud resampling',
    deployment: 'Vercel Node.js function',
    libraries: [{ name: 'Sharp', version: '0.34', role: 'Lanczos-3 resize and enhancement' }],
    supportedFormats: ['JPEG', 'PNG', 'WebP', 'AVIF', 'TIFF', 'GIF', 'HEIC'],
    exportFormats: ['JPG', 'PNG', 'WebP'],
    privacy: { ephemeralMode: true, persistentStorage: false, autoDeleteTtlMinutes: 0 },
  });
}
