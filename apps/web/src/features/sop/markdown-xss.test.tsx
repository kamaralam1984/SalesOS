import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SafeMarkdown } from './markdown';

describe('SOP markdown renderer: stored XSS payloads are rendered as text', () => {
  const payloads = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '[click](javascript:alert(1))', '**<svg onload=alert(1)>**', '```\n<iframe src="javascript:alert(1)"></iframe>\n```', '> <a href="javascript:alert(1)">x</a>', '- <b onmouseover=alert(1)>hi</b>'];
  it.each(payloads)('escapes %j', (p) => {
    const html = renderToStaticMarkup(<SafeMarkdown source={p} />);
    expect(html).not.toMatch(/<(script|img|svg|iframe|a|b)[\s>\/]/i);
  });
});
