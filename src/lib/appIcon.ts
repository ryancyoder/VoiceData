// Finding an app's home-screen icon: the image a phone uses when its link is
// saved to the home screen. Server-only — it fetches the app's own site.
//
// Preference order matches what a phone actually does: the apple-touch-icon
// first, then the web manifest's icons, then a declared favicon, then the
// /favicon.ico fallback. Largest wins within each group, since a home-screen
// icon is rendered big and a 16px favicon looks like mush.

export interface FoundIcon {
  url: string;
  source: string;
  size: number;
}

const FETCH_TIMEOUT_MS = 8000;
// An icon is small. Anything past this is a hero image or a mistake, and it is
// going into a text column, so refuse it rather than bloat every page load.
const MAX_ICON_BYTES = 250_000;

function parseSizes(attr: string | undefined): number {
  if (!attr) return 0;
  const match = /(\d+)\s*[x×]\s*(\d+)/i.exec(attr);
  return match ? Number(match[1]) : 0;
}

function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag);
  return match?.[1];
}

function absolute(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

// Every <link rel="...icon..."> and the manifest href, from the page's markup.
export function iconLinksFromHtml(html: string, pageUrl: string): FoundIcon[] {
  const head = html.slice(0, 200_000);
  const found: FoundIcon[] = [];

  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    const href = attr(tag, "href");
    if (!href) continue;
    const url = absolute(href, pageUrl);
    if (!url) continue;
    const size = parseSizes(attr(tag, "sizes"));

    if (rel.includes("apple-touch-icon")) {
      found.push({ url, source: "apple-touch-icon", size: size || 180 });
    } else if (rel === "manifest") {
      found.push({ url, source: "manifest", size: -1 });
    } else if (rel.split(/\s+/).includes("icon") || rel.includes("shortcut icon")) {
      found.push({ url, source: "favicon", size });
    }
  }
  return found;
}

// A web manifest's icons, largest first. Purpose "maskable" is skipped when
// anything else is available: it is padded for a circle mask and looks cropped
// rendered flat.
export function iconsFromManifest(manifest: unknown, manifestUrl: string): FoundIcon[] {
  const icons = (manifest as { icons?: unknown })?.icons;
  if (!Array.isArray(icons)) return [];

  const parsed: (FoundIcon & { maskable: boolean })[] = [];
  for (const icon of icons) {
    const src = (icon as { src?: unknown })?.src;
    if (typeof src !== "string") continue;
    const url = absolute(src, manifestUrl);
    if (!url) continue;
    parsed.push({
      url,
      source: "manifest",
      size: parseSizes((icon as { sizes?: string }).sizes),
      maskable: String((icon as { purpose?: string }).purpose ?? "").includes("maskable"),
    });
  }

  const plain = parsed.filter((i) => !i.maskable);
  return (plain.length > 0 ? plain : parsed).sort((a, b) => b.size - a.size);
}

async function get(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "VoiceData Agent Ops icon fetcher" },
    });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

// Download one icon and inline it. Returns null for anything that is not
// actually an image, or is too big to keep.
export async function toDataUrl(url: string): Promise<string | null> {
  const res = await get(url);
  if (!res) return null;

  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!type.startsWith("image/")) return null;

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_ICON_BYTES) return null;

  return `data:${type};base64,${buffer.toString("base64")}`;
}

export type IconHunt =
  | { ok: true; dataUrl: string; source: string }
  | { ok: false; reason: string };

// The whole hunt: page markup, then the manifest it points at, then the
// conventional /favicon.ico. Returns the first candidate that downloads.
//
// "Could not reach the site" and "reached it and there was no icon" are
// different problems with different fixes, so they come back as different
// reasons rather than one shrug.
export async function findAppIcon(siteUrl: string): Promise<IconHunt> {
  const page = await get(siteUrl);
  const candidates: FoundIcon[] = [];

  if (page) {
    const pageUrl = page.url || siteUrl;
    const links = iconLinksFromHtml(await page.text(), pageUrl);

    const manifestLink = links.find((l) => l.source === "manifest");
    if (manifestLink) {
      const manifestRes = await get(manifestLink.url);
      if (manifestRes) {
        try {
          candidates.push(...iconsFromManifest(await manifestRes.json(), manifestRes.url || manifestLink.url));
        } catch {
          // A manifest that is not JSON is not worth failing the whole hunt.
        }
      }
    }

    const apple = links.filter((l) => l.source === "apple-touch-icon").sort((a, b) => b.size - a.size);
    const favicons = links.filter((l) => l.source === "favicon").sort((a, b) => b.size - a.size);
    candidates.unshift(...apple);
    candidates.push(...favicons);
  }

  const fallback = absolute("/favicon.ico", siteUrl);
  if (fallback) candidates.push({ url: fallback, source: "favicon", size: 0 });

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    const dataUrl = await toDataUrl(candidate.url);
    if (dataUrl) return { ok: true, dataUrl, source: candidate.source };
  }

  return {
    ok: false,
    reason: page
      ? "Reached the site but found no icon on it"
      : "Could not reach that URL — it may be down, or blocking requests",
  };
}
