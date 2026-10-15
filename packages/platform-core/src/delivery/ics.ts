/** Minimal RFC 5545 VEVENT builder (CRLF, escaping, 75-octet folding). No external dependency. */
export interface IcsEvent {
  uid: string;
  title: string;
  description?: string;
  startsAt: Date;
  endsAt?: Date;
  organizerEmail?: string;
  now?: Date;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function fold(line: string): string {
  const out: string[] = [];
  let buf = Buffer.from(line, 'utf8');
  while (buf.length > 75) {
    let cut = 75;
    while (cut > 0 && (buf[cut]! & 0xc0) === 0x80) cut--; // do not split a UTF-8 sequence
    out.push(buf.subarray(0, cut).toString('utf8'));
    buf = Buffer.concat([Buffer.from(' '), buf.subarray(cut)]);
  }
  out.push(buf.toString('utf8'));
  return out.join('\r\n');
}

export function buildIcs(ev: IcsEvent): string {
  const end = ev.endsAt ?? new Date(ev.startsAt.getTime() + 30 * 60_000);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CoachEasily//SalesOS//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${esc(ev.uid)}@salesos`,
    `DTSTAMP:${stamp(ev.now ?? new Date())}`,
    `DTSTART:${stamp(ev.startsAt)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(ev.title)}`,
    ...(ev.description ? [`DESCRIPTION:${esc(ev.description)}`] : []),
    ...(ev.organizerEmail ? [`ORGANIZER:mailto:${ev.organizerEmail.replace(/[\r\n]/g, '')}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
