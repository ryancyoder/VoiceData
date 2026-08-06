// Parses the plain text you get when copying an event out of Outlook (or
// Outlook.com/Exchange) calendar and pasting it somewhere else. The format
// isn't a standard like iCal — it's just whatever text Outlook happens to
// put on the clipboard — so this is necessarily best-effort: it pulls out
// what it confidently can via a few targeted patterns, and leaves the full
// original text in `notes` so nothing is ever lost even when a field can't
// be parsed.
//
// Example input this is built against:
//
//   Bill Spence - 312-543-7207
//   Scheduled: Jul 28, 2026 at 11:30 AM to 12:30 PM, CDT
//   Location: 15 Oak Dr. Dunn Acres,
//   312-543-7207  -- one house away from Kollar.  At the very end of Oak drive.
//
//   Bspence17@icloud.com<mailto:Bspence17@icloud.com>
//
//   One door down from them. Does not have an extensive project...

export interface ParsedInvite {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  /** ISO 8601, or null if the "Scheduled:" line couldn't be parsed. */
  startTime: string | null;
  endTime: string | null;
  notes: string;
}

const PHONE_RE = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const LOCATION_LINE_RE = /^Location:\s*(.*)$/i;
const SCHEDULED_RE =
  /Scheduled:\s*([A-Za-z]{3,9})\s+(\d{1,2}),?\s*(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*([AP]M)\s+to\s+(\d{1,2}):(\d{2})\s*([AP]M)(?:,?\s*([A-Za-z]{2,5}))?/i;

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

// Standard US timezone abbreviations, as hours offset from UTC (negative =
// behind UTC). Outlook writes whichever one was in effect for that date
// (e.g. CDT in summer, CST in winter), not just the zone's "standard" name.
const TZ_OFFSETS: Record<string, number> = {
  EST: -5, EDT: -4,
  CST: -6, CDT: -5,
  MST: -7, MDT: -6,
  PST: -8, PDT: -7,
  AKST: -9, AKDT: -8,
  HST: -10, HAST: -10,
  AST: -4, ADT: -3,
  UTC: 0, GMT: 0,
};

function splitName(full: string): { first: string | null; last: string | null } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

function to24Hour(hour: string, ampm: string): number {
  let h = Number(hour) % 12;
  if (ampm.toUpperCase() === "PM") h += 12;
  return h;
}

// Outlook sometimes wraps a location across multiple lines — a street
// address on the "Location:" line, then "City, State, Country" (or
// "City, ST ZIP") on the line(s) right after it, with no prefix of its
// own. A continuation line reads as a short comma-separated list of
// place names: every segment starts with a capital letter and the line
// never ends in sentence punctuation — real notes (the freeform text
// that follows) are ordinary sentences and reliably fail one of those
// checks (lowercase words, a trailing period, etc).
function looksLikePlaceLine(line: string): boolean {
  if (/[.!?]$/.test(line)) return false;
  const segments = line.split(",").map((s) => s.trim());
  if (segments.some((s) => s.length === 0)) return false;
  return segments.every((s) => /^[A-Z][A-Za-z.'-]*(\s+[A-Z][A-Za-z.'-]*){0,3}$/.test(s));
}

export function parseOutlookInvite(raw: string): ParsedInvite {
  const text = raw.replace(/\r\n/g, "\n").trim();
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  // First non-empty line is conventionally the organizer/contact line,
  // "Name - phone" or just "Name phone" — strip a trailing phone number
  // (with or without a " - " separator before it) to get just the name.
  let firstName: string | null = null;
  let lastName: string | null = null;
  if (lines.length > 0) {
    let nameLine = lines[0];
    const trailingPhone = nameLine.match(new RegExp(`[\\s-]+${PHONE_RE.source}\\s*$`));
    if (trailingPhone && trailingPhone.index !== undefined) {
      nameLine = nameLine.slice(0, trailingPhone.index).trim();
    }
    const { first, last } = splitName(nameLine);
    firstName = first;
    lastName = last;
  }

  const phoneMatch = text.match(PHONE_RE);
  const phone = phoneMatch ? phoneMatch[0].trim() : null;

  const emailMatch = text.match(EMAIL_RE);
  const email = emailMatch ? emailMatch[0] : null;

  // The street address is on the "Location:" line itself; a wrapped
  // "City, State[, Country]" (or "City, ST ZIP") continuation, if present,
  // follows on the next line(s) with no prefix of its own — see
  // looksLikePlaceLine for how that's told apart from the freeform notes
  // that come after it.
  let address: string | null = null;
  const locationLineIdx = lines.findIndex((l) => LOCATION_LINE_RE.test(l));
  if (locationLineIdx !== -1) {
    const addressParts = [lines[locationLineIdx].replace(LOCATION_LINE_RE, "$1").replace(/,\s*$/, "").trim()].filter(
      Boolean
    );
    let i = locationLineIdx + 1;
    while (i < lines.length && looksLikePlaceLine(lines[i])) {
      addressParts.push(lines[i].replace(/,\s*$/, "").trim());
      i++;
    }
    address = addressParts.length > 0 ? addressParts.join(", ") : null;
  }

  let startTime: string | null = null;
  let endTime: string | null = null;
  const scheduleMatch = text.match(SCHEDULED_RE);
  if (scheduleMatch) {
    const [, monthName, dayStr, yearStr, sh, sm, sAmPm, eh, em, eAmPm, tz] = scheduleMatch;
    const month = MONTHS[monthName.toLowerCase()];
    if (month !== undefined) {
      const day = Number(dayStr);
      const year = Number(yearStr);
      const startHour24 = to24Hour(sh, sAmPm);
      const endHour24 = to24Hour(eh, eAmPm);
      const offset = tz ? TZ_OFFSETS[tz.toUpperCase()] : undefined;

      if (offset !== undefined) {
        // A known zone abbreviation gives an unambiguous absolute instant,
        // independent of whatever timezone this code happens to run in.
        startTime = new Date(Date.UTC(year, month, day, startHour24 - offset, Number(sm))).toISOString();
        endTime = new Date(Date.UTC(year, month, day, endHour24 - offset, Number(em))).toISOString();
      } else {
        // No recognized zone abbreviation — fall back to interpreting the
        // wall-clock time in whatever timezone this runs in (the browser's
        // local zone). Worth the user double-checking in the preview.
        startTime = new Date(year, month, day, startHour24, Number(sm)).toISOString();
        endTime = new Date(year, month, day, endHour24, Number(em)).toISOString();
      }
    }
  }

  return { firstName, lastName, phone, email, address, startTime, endTime, notes: text };
}
