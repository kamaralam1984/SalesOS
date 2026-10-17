import { describe, expect, it } from 'vitest';
import { normalise, searchEntries, type SearchEntry } from './search-logic';
import { FEATURES } from './feature-catalogue';
import { NAV_DOMAINS } from '@/nav/registry';

const E = (id: string, title: string, keywords = '', description = ''): SearchEntry => ({ id, href: `/${id}`, title, keywords, description, section: 'Work' });
const entries = [
  E('join', 'Joining date and HR details', 'join date doj probation end', 'Set an employee joining date'),
  E('att', 'Attendance', 'check in check out present late hazri', 'Check in and out'),
  E('leave', 'Apply for leave', 'chhutti sick leave'),
  E('zoom', 'Zoom meeting link', 'zoom link join meeting', 'The link employees see after check in'),
  E('emp', 'Employees', 'employee list'),
];

describe('searchEntries', () => {
  it('finds the joining date entry for "joining date", "join date" and "doj"', () => {
    for (const q of ['joining date', 'Join Date', 'doj', 'joining']) expect(searchEntries(entries, q)[0]?.id, q).toBe('join');
  });
  it('finds attendance by title, by hinglish keyword and by a part of a word', () => {
    expect(searchEntries(entries, 'attendance')[0]?.id).toBe('att');
    expect(searchEntries(entries, 'hazri')[0]?.id).toBe('att');
    expect(searchEntries(entries, 'attend')[0]?.id).toBe('att');
  });
  it('needs every typed word to match, and ranks title matches above description matches', () => {
    expect(searchEntries(entries, 'zoom banana')).toEqual([]);
    expect(searchEntries(entries, 'check in').map((e) => e.id)).toEqual(['att', 'zoom']);
  });
  it('returns nothing for an empty query and ignores punctuation and case', () => {
    expect(searchEntries(entries, '   ')).toEqual([]);
    expect(searchEntries(entries, 'ZOOM-link!!')[0]?.id).toBe('zoom');
  });
  it('matches Devanagari words', () => {
    expect(searchEntries([E('hz', 'हाज़िरी', 'उपस्थिति हजेरी')], 'उपस्थिति')[0]?.id).toBe('hz');
  });
  it('honours the limit', () => {
    expect(searchEntries(Array.from({ length: 20 }, (_, i) => E(`a${i}`, `Leads ${i}`)), 'leads', 5)).toHaveLength(5);
  });
});

describe('normalise', () => {
  it('lower-cases and strips punctuation', () => expect(normalise('  Join-Date, (DOJ)! ')).toBe('join date doj'));
});

describe('curated features', () => {
  const hrefs = new Set(NAV_DOMAINS.flatMap((d) => d.items.flatMap((i) => [i.href, ...(i.children ?? []).map((c) => c.href)])));
  it('every curated feature points at a real menu page (so its permission is inherited)', () => {
    for (const f of FEATURES) expect(hrefs.has(f.href), `${f.id} -> ${f.href}`).toBe(true);
  });
  it('ids are unique', () => expect(new Set(FEATURES.map((f) => f.id)).size).toBe(FEATURES.length));
});
