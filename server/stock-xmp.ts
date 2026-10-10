import { normalizeStockMetadata, type StockMetadata } from '../shared/stock.ts';

function encodeXmpPacket(metadata: StockMetadata): Buffer {
  const value = normalizeStockMetadata(metadata);
  const escapeXml = (text: string) => text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  const keywordNodes = value.keywords.map(keyword => `<rdf:li>${escapeXml(keyword)}</rdf:li>`).join('');
  const packet = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(value.title)}</rdf:li></rdf:Alt></dc:title><photoshop:Headline>${escapeXml(value.title)}</photoshop:Headline><dc:subject><rdf:Bag>${keywordNodes}</rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  return Buffer.from(packet, 'utf8');
}

/** Add a standard Adobe XMP APP1 block to the JPEG without re-encoding its pixels. */
export function embedJpegXmp(jpeg: Buffer, metadata: StockMetadata): Buffer {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('Expected a JPEG image.');
  const xmpHeader = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'ascii');
  const payload = Buffer.concat([xmpHeader, encodeXmpPacket(metadata)]);
  const segmentLength = payload.length + 2;
  if (segmentLength > 0xffff) throw new Error('Stock metadata is too large to embed in JPEG.');
  const segment = Buffer.allocUnsafe(payload.length + 4);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment.writeUInt16BE(segmentLength, 2);
  payload.copy(segment, 4);
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}
