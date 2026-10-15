import * as React from 'react';

/**
 * Tiny safe markdown-ish renderer. It builds React elements only (text is escaped by React); raw HTML in the source is
 * shown as literal text. Supported: # headings (rendered h2-h4 because the page owns the h1), - / * / 1. lists,
 * ``` fenced code, > quotes, paragraphs, **bold**, *italic*, `code`.
 */
export type Block =
  | { type: 'heading'; level: 2 | 3 | 4; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'ul' | 'ol'; items: string[] }
  | { type: 'code'; text: string }
  | { type: 'quote'; text: string };

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: 'paragraph', text: para.join(' ') });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^```/.test(line)) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!)) code.push(lines[i++]!);
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ type: 'heading', level: Math.min(4, Math.max(2, h[1]!.length + 1)) as 2 | 3 | 4, text: h[2]! });
      continue;
    }
    const li = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const ordered = /\d/.test(li[1]!);
      const type = ordered ? 'ol' : 'ul';
      const last = blocks[blocks.length - 1];
      if (last && last.type === type) last.items.push(li[2]!);
      else blocks.push({ type, items: [li[2]!] });
      continue;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'quote') last.text += ' ' + q[1]!;
      else blocks.push({ type: 'quote', text: q[1]! });
      continue;
    }
    if (line.trim() === '') flush();
    else para.push(line.trim());
  }
  flush();
  return blocks;
}

export function renderInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) out.push(<code key={k++} className="rounded bg-ivory-200 px-1 py-0.5 font-mono text-[0.85em]">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('**')) out.push(<strong key={k++}>{tok.slice(2, -2)}</strong>);
    else out.push(<em key={k++}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const headingCls = { 2: 'mt-6 font-display text-xl font-semibold text-ink', 3: 'mt-5 text-lg font-semibold text-ink', 4: 'mt-4 text-base font-semibold text-ink' } as const;

export function SafeMarkdown({ source, className }: { source: string; className?: string }) {
  const blocks = React.useMemo(() => parseBlocks(source), [source]);
  return (
    <div className={['space-y-3 text-[0.9375rem] leading-relaxed text-ink-800', className].filter(Boolean).join(' ')}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'heading': {
            const H = `h${b.level}` as 'h2';
            return <H key={i} className={headingCls[b.level]}>{renderInline(b.text)}</H>;
          }
          case 'ul':
            return <ul key={i} className="list-disc space-y-1 pl-6">{b.items.map((t, j) => <li key={j}>{renderInline(t)}</li>)}</ul>;
          case 'ol':
            return <ol key={i} className="list-decimal space-y-1 pl-6">{b.items.map((t, j) => <li key={j}>{renderInline(t)}</li>)}</ol>;
          case 'code':
            return <pre key={i} className="overflow-x-auto rounded-md bg-ivory-200 p-3 font-mono text-[0.8125rem]"><code>{b.text}</code></pre>;
          case 'quote':
            return <blockquote key={i} className="border-l-2 border-gold-500 pl-4 text-ink-600">{renderInline(b.text)}</blockquote>;
          default:
            return <p key={i}>{renderInline(b.text)}</p>;
        }
      })}
    </div>
  );
}
