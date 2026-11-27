// Time zones for AFCD Apply. Calls are stored in UTC and shown in their own time zone. Staff type a local date and
// time ("2027-01-20T09:00") and pick a zone; these helpers convert without any library, using the runtime's tz data.
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function isTimeZone(tz: string) {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(tz) && tz !== 'UTC') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

function parts(ms: number, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}
/** Offset of `tz` from UTC at instant `ms`, in milliseconds. */
function offset(ms: number, tz: string) {
  const p = parts(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** "2027-01-20T09:00" in `tz` → the UTC instant, or null when the text is not a valid local time there
 *  (including times skipped by a daylight-saving change). */
export function zonedToUtc(local: string, tz: string): Date | null {
  const m = LOCAL.exec(local);
  if (!m || !isTimeZone(tz)) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  if (new Date(wall).getUTCDate() !== d || h > 23 || mi > 59) return null;
  let ms = wall - offset(wall, tz);
  ms = wall - offset(ms, tz);          // second pass lands on the right side of a DST change
  return utcToLocal(new Date(ms), tz) === local ? new Date(ms) : null;
}

/** UTC instant → "YYYY-MM-DDTHH:mm" in `tz`. */
export function utcToLocal(d: Date, tz: string): string {
  const p = parts(d.getTime(), tz);
  const z = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${z(p.year, 4)}-${z(p.month)}-${z(p.day)}T${z(p.hour)}:${z(p.minute)}`;
}

/** Calendar year in `tz` (used for call references). */
export const yearIn = (d: Date, tz: string) => parts(d.getTime(), tz).year;
