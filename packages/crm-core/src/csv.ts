/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF, BOM, embedded newlines). */
export interface ParsedCsv {
  header: string[];
  rows: string[][];
}

export function parseCsv(text: string): ParsedCsv {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    if (!(row.length === 1 && row[0] === '')) records.push(row);
    row = [];
  };
  while (i < src.length) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') inQuotes = true;
    else if (c === ',') pushField();
    else if (c === '\r') {
      if (src[i + 1] === '\n') i++;
      pushRow();
    } else if (c === '\n') pushRow();
    else field += c;
    i++;
  }
  if (field !== '' || row.length > 0) pushRow();
  const [header = [], ...rows] = records;
  return { header: header.map((h) => h.trim()), rows };
}

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    // neutralise spreadsheet formula injection
    // Leading = @ TAB CR always; leading + or - unless the whole cell is a plain number / phone ("+91 98765 43210", "-12.5"):
    // "+1+1" or "-2+3|cmd" start with a digit but are still formulas in Excel/Sheets.
    const safe = /^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !/^[+-]\s?[\d][\d\s().-]*$/.test(s)) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}
