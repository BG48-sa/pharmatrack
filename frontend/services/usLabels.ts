import { loadLabelFile } from './labelFiles';

/**
 * The US prescribing information our pipeline extracted and checked
 * (data/uspi/<slug>.json, scripts/uspi/extract-all.mjs) — used on the US cards in
 * place of whatever label the live openFDA query happens to return.
 *
 * Why: openFDA links a label to a brand / application only once it has
 * "harmonised" it, and several manufacturers' current labels are not (Novo's
 * Wegovy, ViiV's Tivicay). The live query then finds only a repackager's reprint
 * of an old version — on 21.10.2026 the Wegovy card showed A-S Medication
 * Solutions' 2024 text without the MASH indication. The pipeline picks the
 * manufacturer's own label (DailyMed-confirmed when openFDA cannot tell).
 *
 * Only a SAME-PRODUCT pairing is used (index `match: 'brand'`: the US brand equals
 * the card's brand); a same-substance pairing is another product's label.
 */
interface IndexEntry { brand?: string; match?: 'brand' | 'substance'; sha?: string }
interface UspiDoc { brand?: string; effective?: string; usLabeler?: string | null; sections?: Record<string, unknown> }
export interface CuratedUsLabel { slug: string; indications: string; effective?: string; labeler?: string | null; verified?: boolean }

const norm = (s?: string): string => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sectionText = (v: unknown): string =>
  typeof v === 'string' ? v : v && typeof v === 'object' && !(v as { missing?: boolean }).missing ? String((v as { text?: string }).text || '') : '';

let index: Record<string, IndexEntry> = {};
let releaseId: string | undefined;
let byBrand = new Map<string, string>();
const cache = new Map<string, Promise<CuratedUsLabel | null>>();

/** Called by App once the US label index is loaded (and again after the live release). */
export const setUsLabelIndex = (drugs: Record<string, unknown>, release?: string): void => {
  index = drugs as Record<string, IndexEntry>;
  releaseId = release;
  byBrand = new Map();
  for (const [slug, e] of Object.entries(index)) {
    const k = norm(e?.brand);
    if (e?.match === 'brand' && k && !byBrand.has(k)) byBrand.set(k, slug);
  }
  cache.clear();
};

/** The checked US label of the product with this brand name, or null. */
export const curatedUsLabel = (brandName?: string): Promise<CuratedUsLabel | null> => {
  const slug = byBrand.get(norm(brandName));
  if (!slug) return Promise.resolve(null);
  let p = cache.get(slug);
  if (!p) {
    p = loadLabelFile<UspiDoc>('uspi', slug, index[slug]?.sha, releaseId)
      .then((doc) => {
        const text = sectionText(doc?.sections?.indications).trim();
        return doc && text ? { slug, indications: text, effective: doc.effective, labeler: doc.usLabeler, verified: doc.verified } : null;
      })
      .catch(() => null);
    cache.set(slug, p);
  }
  return p;
};
