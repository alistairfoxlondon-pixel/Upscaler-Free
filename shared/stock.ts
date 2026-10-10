export const ADOBE_STOCK_MAX_KEYWORDS = 49;
export const ADOBE_STOCK_TITLE_MAX_LENGTH = 70;
export const ADOBE_STOCK_KEYWORD_MAX_LENGTH = 80;

export type StockMetadataSource = 'local' | 'ai' | 'edited';
export interface StockMetadata {
  title: string;
  keywords: string[];
  source: StockMetadataSource;
}

export const EMPTY_STOCK_METADATA: StockMetadata = { title: '', keywords: [], source: 'local' };
const controlCharacters = /[\u0000-\u001f\u007f]/g;

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(controlCharacters, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength).trim();
}

export function normalizeKeywords(values: unknown): string[] {
  const candidates = Array.isArray(values)
    ? values
    : typeof values === 'string'
      ? values.split(/[,;\n]/)
      : [];
  const keywords: string[] = [];
  const seen = new Set<string>();
  for (const value of candidates) {
    const keyword = cleanText(value, ADOBE_STOCK_KEYWORD_MAX_LENGTH).replace(/^[,;\s]+|[,;\s]+$/g, '');
    const key = keyword.toLocaleLowerCase('en');
    if (!keyword || seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
    if (keywords.length >= ADOBE_STOCK_MAX_KEYWORDS) break;
  }
  return keywords;
}

/** Validate and bound metadata before it reaches XMP or an image export. */
export function normalizeStockMetadata(value: unknown, fallbackSource: StockMetadataSource = 'local'): StockMetadata {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const title = cleanText(candidate.title, ADOBE_STOCK_TITLE_MAX_LENGTH);
  const source = candidate.source === 'ai' || candidate.source === 'edited' || candidate.source === 'local'
    ? candidate.source
    : fallbackSource;
  return { title, keywords: normalizeKeywords(candidate.keywords), source };
}
