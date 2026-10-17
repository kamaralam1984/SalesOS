/** Pure matching for the global feature search. */
export interface SearchEntry {
  id: string;
  href: string;
  title: string;
  /** shown under the title */
  description?: string;
  /** section label, shown as a small tag */
  section: string;
  /** extra words people may type (any language) */
  keywords?: string;
}

/** Lower-case, strip punctuation (keeps letters and digits of every script, including Devanagari). */
export function normalise(text: string): string {
  return text.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

const words = (s: string) => normalise(s).split(' ').filter(Boolean);

/**
 * Every word the person typed must match something in the entry (a word that starts with it). Ranking:
 * the whole phrase inside the title or keywords first, then words in the title, then keywords, then the description.
 * Returns the best `limit` entries; an empty query returns nothing.
 */
export function searchEntries<T extends SearchEntry>(entries: readonly T[], query: string, limit = 8): T[] {
  const q = normalise(query);
  if (!q) return [];
  const tokens = q.split(' ');
  const scored: Array<{ e: T; score: number; i: number }> = [];
  entries.forEach((e, i) => {
    const title = normalise(e.title);
    const kw = normalise(e.keywords ?? '');
    const desc = normalise(e.description ?? '');
    const sec = normalise(e.section);
    const titleW = new Set(title.split(' '));
    const kwW = kw.split(' ').filter(Boolean);
    const descW = desc.split(' ').filter(Boolean);
    const starts = (list: Iterable<string>, t: string) => { for (const w of list) if (w.startsWith(t)) return true; return false; };
    let score = 0;
    for (const t of tokens) {
      let s = 0;
      if (titleW.has(t)) s = 10;
      else if (starts(titleW, t)) s = 8;
      else if (starts(kwW, t)) s = 5;
      else if (starts(descW, t)) s = 2;
      else if (sec.startsWith(t)) s = 1;
      else if (t.length >= 3 && (title.includes(t) || kw.includes(t))) s = 1;
      if (s === 0) return; // every typed word must match
      score += s;
    }
    if (title.includes(q)) score += 12;
    else if (kw.includes(q)) score += 8;
    scored.push({ e, score, i });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).slice(0, limit).map((x) => x.e);
}
