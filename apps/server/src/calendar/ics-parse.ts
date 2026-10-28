export type IcsEvent = {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  meetLink: string | null;
};

function parseVevents(ics: string): Array<Record<string, string>> {
  const unfolded = ics.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);
  const events: Array<Record<string, string>> = [];
  let cur: Record<string, string> | null = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      cur = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (cur) events.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const key = left.split(';')[0]!.toUpperCase();
    if (cur[key] === undefined) cur[key] = value;
    if (key === 'DTSTART' || key === 'DTEND') {
      cur[`${key}_RAW`] = left;
      cur[key] = value;
    }
  }
  return events;
}

function parseIcsDate(rawKey: string | undefined, value: string): Date | null {
  if (!value) return null;
  if (/^\d{8}$/.test(value) || rawKey?.includes('VALUE=DATE')) {
    const y = Number(value.slice(0, 4));
    const m = Number(value.slice(4, 6)) - 1;
    const d = Number(value.slice(6, 8));
    if (!Number.isFinite(y)) return null;
    return new Date(Date.UTC(y, m, d, 0, 0, 0));
  }
  const utc = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (utc) {
    return new Date(
      Date.UTC(
        Number(utc[1]),
        Number(utc[2]) - 1,
        Number(utc[3]),
        Number(utc[4]),
        Number(utc[5]),
        Number(utc[6]),
      ),
    );
  }
  const local = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (local) {
    return new Date(
      Number(local[1]),
      Number(local[2]) - 1,
      Number(local[3]),
      Number(local[4]),
      Number(local[5]),
      Number(local[6]),
    );
  }
  const asDate = new Date(value);
  return Number.isNaN(asDate.getTime()) ? null : asDate;
}

function unescapeText(s: string) {
  return s
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function extractMeetLink(description?: string, location?: string, url?: string) {
  const blob = [url, location, description].filter(Boolean).join('\n');
  const m = blob.match(/https?:\/\/meet\.google\.com\/[a-z0-9-]+/i);
  if (m) return m[0];
  const zoom = blob.match(/https?:\/\/[\w.-]*zoom\.us\/j\/\S+/i);
  if (zoom) return zoom[0];
  const teams = blob.match(/https?:\/\/teams\.microsoft\.com\/\S+/i);
  if (teams) return teams[0];
  return url?.startsWith('http') ? url : null;
}

export function parseIcsEvents(ics: string): IcsEvent[] {
  const out: IcsEvent[] = [];
  for (const ev of parseVevents(ics)) {
    const start = parseIcsDate(ev.DTSTART_RAW, ev.DTSTART ?? '');
    let end = parseIcsDate(ev.DTEND_RAW, ev.DTEND ?? '');
    if (!start) continue;
    if (!end) end = new Date(start.getTime() + 30 * 60_000);
    if (ev.STATUS?.toUpperCase() === 'CANCELLED') continue;
    const uid = (ev.UID || `${start.toISOString()}-${ev.SUMMARY || 'event'}`).trim();
    out.push({
      uid,
      title: unescapeText(ev.SUMMARY || 'Busy'),
      start,
      end,
      meetLink: extractMeetLink(ev.DESCRIPTION, ev.LOCATION, ev.URL),
    });
  }
  return out;
}

export function isLikelyIcsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return (
      u.hostname.includes('google.com') ||
      u.hostname.includes('outlook.') ||
      u.hostname.includes('office365.com') ||
      u.hostname.includes('live.com') ||
      u.pathname.toLowerCase().includes('.ics') ||
      u.pathname.toLowerCase().includes('ical')
    );
  } catch {
    return false;
  }
}
