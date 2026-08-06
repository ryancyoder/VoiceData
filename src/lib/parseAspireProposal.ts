export interface AspireProposalParseResult {
  title: string | null;
  proposalNumber: string | null;
  proposalDate: string | null;
  value: number | null;
}

// Aspire-generated RLM proposals always open with the same layout: a
// "Page N of M" header, the proposal title, then "Prepared By:" — captured
// here rather than parsed visually since the PDF's own page-1 columns
// (Prepared For / Jobsite Location / Proposal #) interleave unpredictably
// once flattened to text.
export function parseAspireProposalText(text: string): AspireProposalParseResult {
  return {
    title: extractTitle(text),
    proposalNumber: extractProposalNumber(text),
    proposalDate: extractProposalDate(text),
    value: extractTotal(text),
  };
}

function extractTitle(text: string): string | null {
  const match = text.match(/Page\s+\d+\s+of\s+\d+\s*\n([\s\S]*?)\nPrepared By:/);
  if (!match) return null;
  const title = match[1].replace(/\s+/g, " ").trim();
  return title || null;
}

function extractProposalNumber(text: string): string | null {
  const match = text.match(/Proposal #(\d+)/);
  return match ? match[1] : null;
}

function extractProposalDate(text: string): string | null {
  // Page 2's "Date:" label is unambiguous, unlike the bare date line on
  // page 1 that sits next to the Proposal # with no label of its own.
  const match = text.match(/Date:\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) return null;
  return toIsoDate(match[1], match[2], match[3]);
}

function toIsoDate(month: string, day: string, year: string): string {
  const yyyy = year.length === 2 ? `20${year}` : year;
  const mm = month.padStart(2, "0");
  const dd = day.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function extractTotal(text: string): number | null {
  // The grand total sits on its own "Total $X" line just before the Terms
  // & Conditions section — cut the search off there so a per-group
  // subtotal further back in the document (formatted differently, but
  // just in case) can never be picked up instead.
  const termsIdx = text.search(/Terms\s*&\s*Conditions/i);
  const searchText = termsIdx === -1 ? text : text.slice(0, termsIdx);
  const matches = [...searchText.matchAll(/^Total\s*\$([\d,]+\.\d{2})\s*$/gm)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1][1];
  return Number(last.replace(/,/g, ""));
}
