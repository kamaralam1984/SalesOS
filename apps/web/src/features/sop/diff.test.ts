import { describe, expect, it } from 'vitest';
import { diffStats, lineDiff } from './diff';

describe('lineDiff', () => {
  it('returns all-same for identical text and numbers lines', () => {
    const d = lineDiff('a\nb\nc', 'a\nb\nc');
    expect(d.map((l) => l.op)).toEqual(['same', 'same', 'same']);
    expect(d[2]).toMatchObject({ oldNo: 3, newNo: 3 });
  });
  it('detects additions, removals and replacements via LCS', () => {
    const d = lineDiff('one\ntwo\nthree\nfour', 'one\n2\nthree\nfour\nfive');
    expect(d.map((l) => `${l.op}:${l.text}`)).toEqual(['same:one', 'del:two', 'add:2', 'same:three', 'same:four', 'add:five']);
    expect(diffStats(d)).toEqual({ added: 2, removed: 1, unchanged: 3 });
  });
  it('handles empty sides', () => {
    expect(lineDiff('', 'x\ny').map((l) => l.op)).toEqual(['add', 'add']);
    expect(lineDiff('x\ny', '').map((l) => l.op)).toEqual(['del', 'del']);
    expect(lineDiff('', '')).toEqual([]);
  });
  it('normalises CRLF and keeps order with moved blocks', () => {
    const d = lineDiff('a\r\nb\r\nc', 'c\na\nb');
    expect(diffStats(d).added + diffStats(d).removed).toBe(2);
    expect(d.filter((l) => l.op === 'same').map((l) => l.text)).toEqual(['a', 'b']);
  });
});
