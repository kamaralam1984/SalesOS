import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/utils';
import { FilesWidget } from './files-widget';
import { setCsrfToken } from '@/lib/api/client';

const file = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), displayName: 'photo.png', extension: 'png', contentType: 'image/png', sizeBytes: 20480, category: 'image', status: 'READY', progress: 100,
  scanStatus: 'NOT_SCANNED', scanLabel: 'NOT scanned', processingNote: 'Image re-encoded to WebP', lastError: null, downloadable: true, hasDerivative: true,
  createdAt: new Date().toISOString(), uploaderId: 'u1', ...over,
});

class FakeXHR {
  static instances: FakeXHR[] = [];
  upload = { onprogress: null as null | ((e: ProgressEvent) => void) };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = '';
  withCredentials = false;
  headers: Record<string, string> = {};
  method = '';
  constructor() { FakeXHR.instances.push(this); }
  open(m: string) { this.method = m; }
  setRequestHeader(k: string, v: string) { this.headers[k] = v; }
  send() {}
  abort() { this.onabort?.(); }
  progress(loaded: number, total: number) { this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent); }
  respond(status: number, body: unknown) { this.status = status; this.responseText = JSON.stringify(body); this.onload?.(); }
}

describe('FilesWidget', () => {
  let rows: ReturnType<typeof file>[];
  beforeEach(() => {
    rows = [];
    FakeXHR.instances = [];
    setCsrfToken('tok');
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      const ok = (data: unknown) => new Response(JSON.stringify({ data, meta: {}, error: null }), { status: 200 });
      if (u.pathname.endsWith('/files') && (init?.method ?? 'GET') === 'GET') return ok(rows);
      if (u.pathname.endsWith('/retry')) { rows = rows.map((r) => ({ ...r, status: 'PENDING' })); return ok({}); }
      return ok({});
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows upload progress, then the error with a retry that re-sends the same file', async () => {
    renderWithProviders(<FilesWidget />);
    const input = await screen.findByTestId('file-input');
    await userEvent.upload(input, new File(['x'], 'report.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(FakeXHR.instances.length).toBe(1));
    const xhr = FakeXHR.instances[0]!;
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.headers['x-csrf-token']).toBe('tok');
    xhr.progress(50, 100);
    expect(await screen.findByRole('progressbar', { name: 'report.pdf' })).toHaveAttribute('aria-valuenow', '50');
    xhr.respond(422, { data: null, error: { code: 'MIME_MISMATCH', message: 'File content (image/png) does not match extension .pdf' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('does not match extension');
    await userEvent.click(screen.getByRole('button', { name: 'Retry upload' }));
    await waitFor(() => expect(FakeXHR.instances.length).toBe(2));
    FakeXHR.instances[1]!.respond(201, { data: file({ status: 'PENDING' }), meta: {}, error: null });
    await waitFor(() => expect(screen.queryByTestId('upload-row')).not.toBeInTheDocument());
  });

  it('cancelling an in-flight upload removes it without an error', async () => {
    renderWithProviders(<FilesWidget />);
    await userEvent.upload(await screen.findByTestId('file-input'), new File(['x'], 'a.csv', { type: 'text/csv' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('upload-row')).not.toBeInTheDocument());
  });

  it('is honest: not-scanned label, processing progress, failed files offer retry, rejected files cannot be downloaded', async () => {
    rows = [
      file({ displayName: 'ready.png' }),
      file({ displayName: 'working.csv', status: 'PROCESSING', progress: 40, downloadable: false, processingNote: null }),
      file({ displayName: 'broken.pdf', status: 'FAILED', downloadable: false, lastError: 'storage timeout', processingNote: null }),
      file({ displayName: 'virus.csv', status: 'REJECTED', scanStatus: 'INFECTED', downloadable: false, processingNote: 'Rejected: malware signature detected' }),
    ];
    renderWithProviders(<FilesWidget />);
    const list = await screen.findAllByTestId('file-row');
    expect(list).toHaveLength(4);
    const byName = (n: string) => list.find((r) => within(r).queryByText(n, { exact: false }))!;
    expect(within(byName('ready.png')).getByText('Not scanned by an antivirus engine')).toBeInTheDocument();
    expect(within(byName('ready.png')).getByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(within(byName('working.csv')).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    expect(within(byName('working.csv')).queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
    expect(within(byName('broken.pdf')).getByText(/could not be processed/)).toBeInTheDocument();
    expect(within(byName('broken.pdf')).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(within(byName('virus.csv')).getByText('Malware detected')).toBeInTheDocument();
    expect(within(byName('virus.csv')).queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
    await userEvent.click(within(byName('broken.pdf')).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some((c) => String(c[0]).endsWith('/retry'))).toBe(true));
  });

  it('empty state and axe', async () => {
    const { baseElement } = renderWithProviders(<FilesWidget />);
    expect(await screen.findByText('No files yet')).toBeInTheDocument();
    expect(await axe(baseElement, { rules: { region: { enabled: false } } })).toHaveNoViolations();
  });
});
