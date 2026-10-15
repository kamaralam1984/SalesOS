export type DiffOp = 'same' | 'add' | 'del';
export interface DiffLine {
  op: DiffOp;
  text: string;
  /** 1-based line numbers in the old / new text (undefined when the line does not exist there). */
  oldNo?: number;
  newNo?: number;
}

const split = (s: string) => (s === '' ? [] : s.replace(/\r\n/g, '\n').split('\n'));

/** Pure LCS line diff. O(n*m) memory is fine for SOP-sized documents (guarded for huge inputs). */
export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = split(oldText);
  const b = split(newText);
  // trim common prefix/suffix to keep the table small
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ op: 'same', text: a[i]!, oldNo: i + 1, newNo: i + 1 });

  if (n * m > 4_000_000) {
    // pathological size: fall back to delete-all/add-all for the changed region
    midA.forEach((t, i) => out.push({ op: 'del', text: t, oldNo: start + i + 1 }));
    midB.forEach((t, i) => out.push({ op: 'add', text: t, newNo: start + i + 1 }));
  } else {
    const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        lcs[i]![j] = midA[i] === midB[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        out.push({ op: 'same', text: midA[i]!, oldNo: start + i + 1, newNo: start + j + 1 });
        i++;
        j++;
      } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
        out.push({ op: 'del', text: midA[i]!, oldNo: start + i + 1 });
        i++;
      } else {
        out.push({ op: 'add', text: midB[j]!, newNo: start + j + 1 });
        j++;
      }
    }
    while (i < n) out.push({ op: 'del', text: midA[i]!, oldNo: start + ++i });
    while (j < m) out.push({ op: 'add', text: midB[j]!, newNo: start + ++j });
  }
  const tail = a.length - endA;
  for (let k = 0; k < tail; k++) out.push({ op: 'same', text: a[endA + k]!, oldNo: endA + k + 1, newNo: endB + k + 1 });
  return out;
}

export function diffStats(lines: DiffLine[]) {
  return {
    added: lines.filter((l) => l.op === 'add').length,
    removed: lines.filter((l) => l.op === 'del').length,
    unchanged: lines.filter((l) => l.op === 'same').length,
  };
}
