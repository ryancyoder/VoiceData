import { NextRequest, NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { parseAspireProposalText } from "@/lib/parseAspireProposal";

const FETCH_TIMEOUT_MS = 20000;

// pdfjs-dist (which pdf-parse wraps) normally spins up its worker by
// dynamically import()-ing a path resolved relative to its own bundled
// chunk — that path doesn't survive Turbopack/webpack bundling. Statically
// importing the worker module and registering it globally is the
// documented Node.js escape hatch: pdfjs checks `globalThis.pdfjsWorker`
// before attempting that dynamic import, so this skips the broken path
// instead of trying to fix it.
(globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = pdfjsWorker;

// This fetches whatever URL the user pastes in, server-side — block the
// obvious loopback/private/metadata targets rather than letting the route
// double as an internal port-scanner.
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "0.0.0.0" || h === "::1" || h === "169.254.169.254") return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  return false;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { link?: unknown };
  const link = typeof body.link === "string" ? body.link.trim() : "";
  if (!link) {
    return NextResponse.json({ error: "link is required" }, { status: 400 });
  }

  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return NextResponse.json({ error: "That doesn't look like a valid URL" }, { status: 400 });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return NextResponse.json({ error: "Link must be http(s)" }, { status: 400 });
  }
  if (isBlockedHost(url.hostname)) {
    return NextResponse.json({ error: "That host isn't allowed" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let buffer: Buffer;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VoiceDataBot/1.0)" },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Couldn't fetch that link (HTTP ${res.status}) — check it's public and points at the proposal` },
        { status: 502 }
      );
    }
    const contentType = res.headers.get("content-type") || "";
    const arrayBuffer = await res.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
    const looksLikePdf = contentType.includes("pdf") || buffer.subarray(0, 4).toString("latin1") === "%PDF";
    if (!looksLikePdf) {
      return NextResponse.json(
        { error: "That link didn't return a PDF — it may require signing into Aspire first" },
        { status: 422 }
      );
    }
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "AbortError";
    return NextResponse.json(
      { error: timedOut ? "Timed out fetching that link" : "Couldn't fetch that link" },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }

  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const parsed = parseAspireProposalText(result.text);
    return NextResponse.json(parsed);
  } catch (err) {
    console.error("Aspire proposal parse failed:", err);
    return NextResponse.json({ error: "Couldn't read that PDF" }, { status: 500 });
  } finally {
    await parser.destroy();
  }
}
