import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { searchAspireProposal, type AspireErrorCode } from "@/lib/aspireBrowser";
import { recordAspireFailure, clearAspireFailure } from "@/lib/aspireSession";

// A headless browser is a Node.js thing, and driving Aspire's search takes
// well past a default serverless slice — the click path is fill → debounce →
// wait for results → click → wait for the proposal page to load. The budget
// also has to cover the verification-code pause: when Aspire challenges the
// login, the run holds the door open up to two minutes while the user types
// the code into the live view.
export const runtime = "nodejs";
export const maxDuration = 300;

// Which HTTP status each failure deserves. `ambiguous` is a 409 because the
// caller can resolve it by re-posting with a resultIndex; the rest are either
// a misconfiguration (503) or a genuine failure to find the proposal.
const STATUS_BY_CODE: Record<AspireErrorCode, number> = {
  browser_unavailable: 503,
  session_missing: 503,
  login_failed: 502,
  search_unavailable: 502,
  no_match: 404,
  ambiguous: 409,
  navigation_failed: 502,
  unexpected: 500,
};

// What a completed run produced, before it becomes a Response. Deduping at
// this level rather than on Response objects matters: a Response body can only
// be read once, so two callers can't share one.
interface RunOutcome {
  status: number;
  payload: Record<string, unknown>;
}

// One headless browser per proposal at a time. Double-clicking the button (or
// two people opening the same deal) would otherwise launch a second browser to
// do identical work; instead the second caller rides along on the first run.
const inFlight = new Map<string, Promise<RunOutcome>>();

export async function POST(req: NextRequest) {
  let body: { dealId?: unknown; proposalNumber?: unknown; resultIndex?: unknown; refresh?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const dealId = typeof body.dealId === "number" ? body.dealId : null;
  const resultIndex = typeof body.resultIndex === "number" ? body.resultIndex : undefined;
  const refresh = body.refresh === true;
  let proposalNumber = typeof body.proposalNumber === "string" ? body.proposalNumber.trim() : "";

  // With a deal id we can both read the cached link and write the resolved one
  // back, which is the whole point — the search only ever runs once per deal.
  let cachedLink: string | null = null;
  if (dealId !== null) {
    const { data, error } = await supabase
      .from("Sales Board")
      .select("id, proposal_number, aspire_link")
      .eq("id", dealId)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: `Couldn't load that deal: ${error.message}` }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    cachedLink = (data.aspire_link as string | null)?.trim() || null;
    if (!proposalNumber) proposalNumber = ((data.proposal_number as string | null) || "").trim();
  }

  // Strip a leading "#" so "#20519" and "20519" both work — the number, not
  // the way it was typed, is what Aspire's list is matched on.
  proposalNumber = proposalNumber.replace(/^#\s*/, "");
  if (!proposalNumber) {
    return NextResponse.json({ error: "This deal has no proposal number to search for" }, { status: 400 });
  }

  // Already resolved: hand the link straight back, no browser involved. The
  // frontend short-circuits this too, but a stale client shouldn't be able to
  // trigger a needless headless run.
  if (cachedLink && !refresh && resultIndex === undefined) {
    return NextResponse.json({ url: cachedLink, cached: true });
  }

  const key = `${dealId ?? "-"}:${proposalNumber}:${resultIndex ?? "-"}`;
  const running = inFlight.get(key) ?? startRun(key, { dealId, proposalNumber, resultIndex });
  const { status, payload } = await running;
  return NextResponse.json(payload, { status });
}

function startRun(
  key: string,
  { dealId, proposalNumber, resultIndex }: { dealId: number | null; proposalNumber: string; resultIndex?: number }
): Promise<RunOutcome> {
  const run = (async (): Promise<RunOutcome> => {
    const result = await searchAspireProposal({ proposalNumber, resultIndex });

    if (!result.ok) {
      await recordAspireFailure(result.code, result.message, proposalNumber);
      return {
        status: STATUS_BY_CODE[result.code],
        payload: { error: result.message, code: result.code, candidates: result.candidates ?? null },
      };
    }

    let saveError: string | null = null;
    if (dealId !== null) {
      const { error } = await supabase.from("Sales Board").update({ aspire_link: result.url }).eq("id", dealId);
      // The link is still useful even if caching it failed — return it, and
      // say the cache didn't take so the next click isn't a silent re-run.
      if (error) saveError = error.message;
    }

    await clearAspireFailure();
    return { status: 200, payload: { url: result.url, title: result.title, cached: false, saveError } };
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, run);
  return run;
}
