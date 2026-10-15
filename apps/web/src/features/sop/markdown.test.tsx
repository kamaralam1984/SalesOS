import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { parseBlocks, SafeMarkdown } from './markdown';

describe('SafeMarkdown', () => {
  it('parses headings (shifted below h1), lists, code and paragraphs', () => {
    const blocks = parseBlocks('# Title\nintro line\nmore\n\n- a\n- b\n\n1. x\n2. y\n\n```\ncode here\n```\n> quote');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'ul', 'ol', 'code', 'quote']);
    expect(blocks[0]).toMatchObject({ level: 2, text: 'Title' });
    expect(blocks[1]).toMatchObject({ text: 'intro line more' });
  });
  it('renders semantic elements and inline formatting', () => {
    render(<SafeMarkdown source={'## Steps\n- **bold** and `code`\n- plain'} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Steps' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByText('code').tagName).toBe('CODE');
  });
  it('escapes raw HTML and never creates script/img elements', () => {
    const { container } = render(<SafeMarkdown source={'<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n# <b>hi</b>'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
    expect(container.textContent).toContain('<img src=x onerror="alert(2)">');
  });
});
