import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { createHash } from "node:crypto";

// The adaptive wiki: it synthesizes VoiceMap cards (raw captured ideas) into
// coherent, interlinked articles that are rebuilt on demand as new cards
// arrive. One page per top-level topic (a root card + its subtree). This module
// is server-only (Anthropic + node crypto).

const MODEL = "claude-sonnet-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

// A VoiceMap node row as read from voicemap_nodes (plus the full card in `data`).
export interface WikiNode {
  id: string;
  parent_id: string | null;
  label: string | null;
  summary: string | null;
  last_modified: string | null;
  data?: { archived?: boolean | null; transcript?: string | null; status?: string | null } | null;
}

export interface WikiSourceCard {
  id: string;
  label: string;
  summary: string;
  transcript: string;
  last_modified: string | null;
}

const isArchived = (n: WikiNode): boolean => !!n.data?.archived;

// The root cards of a session (parent_id null / missing), non-archived — each is
// a wiki topic. Sorted by label for stable ordering.
export function topicRootNodes(nodes: WikiNode[]): WikiNode[] {
  const ids = new Set(nodes.map((n) => n.id));
  return nodes
    .filter((n) => !isArchived(n) && (!n.parent_id || !ids.has(n.parent_id)))
    .sort((a, b) => (a.label ?? "").localeCompare(b.label ?? ""));
}

// The source cards for a topic: the root node plus all descendants, excluding
// archived cards. Walks children with a `seen` guard against circular parents.
export function gatherTopicCards(nodes: WikiNode[], topicNodeId: string): WikiSourceCard[] {
  const byParent = new Map<string, WikiNode[]>();
  for (const n of nodes) {
    if (!n.parent_id) continue;
    const list = byParent.get(n.parent_id) ?? [];
    list.push(n);
    byParent.set(n.parent_id, list);
  }
  const root = nodes.find((n) => n.id === topicNodeId);
  if (!root) return [];

  const out: WikiSourceCard[] = [];
  const seen = new Set<string>();
  const walk = (n: WikiNode) => {
    if (seen.has(n.id) || isArchived(n)) return;
    seen.add(n.id);
    out.push({
      id: n.id,
      label: n.label ?? "",
      summary: n.summary ?? "",
      transcript: n.data?.transcript ?? "",
      last_modified: n.last_modified,
    });
    for (const child of byParent.get(n.id) ?? []) walk(child);
  };
  walk(root);
  return out;
}

// Stable hash of a topic's source cards — changes whenever any card's text or
// membership changes, which is how we detect "new info since last build".
export function hashCards(cards: WikiSourceCard[]): string {
  const basis = cards
    .map((c) => ({ id: c.id, label: c.label, summary: c.summary, transcript: c.transcript, m: c.last_modified }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return createHash("sha256").update(JSON.stringify(basis)).digest("hex");
}

// How many source cards changed since the page was last built — the nudge count.
export function newCardsSince(cards: WikiSourceCard[], builtAt: string | null): number {
  if (!builtAt) return cards.length;
  const t = new Date(builtAt).getTime();
  return cards.filter((c) => c.last_modified && new Date(c.last_modified).getTime() > t).length;
}

const slug = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

// Replace [[Topic Title]] wiki-links with real markdown. Known topics become
// links to their page; unknown ones render as bold text (a "red link").
export function resolveWikiLinks(markdown: string, titleToHref: Map<string, string>): string {
  const bySlug = new Map<string, string>();
  for (const [title, href] of titleToHref) bySlug.set(slug(title), href);
  return markdown.replace(/\[\[([^\]]+)\]\]/g, (_m, raw: string) => {
    const label = raw.trim();
    const href = bySlug.get(slug(label));
    return href ? `[${label}](${href})` : `**${label}**`;
  });
}

const WRITE_WIKI_TOOL: Tool = {
  name: "write_wiki_page",
  description: "Emit the synthesized wiki article for a topic.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "The article title — usually the topic name, cleaned up." },
      markdown: {
        type: "string",
        description:
          "The full article in GitHub-flavored Markdown: encyclopedic prose organized under descriptive ## headings, merging overlapping ideas and preserving every distinct point. Use [[Topic Title]] to link a referenced topic from the provided list.",
      },
    },
    required: ["title", "markdown"],
  },
};

export interface SynthesisResult {
  title: string;
  markdown: string;
}

// Synthesize one topic's cards into a wiki article. `siblingTitles` are the
// other topics in the session, offered to the model for [[wiki-link]]ing.
export async function synthesizeWikiPage(args: {
  topicTitle: string;
  cards: WikiSourceCard[];
  siblingTitles: string[];
}): Promise<SynthesisResult> {
  const { topicTitle, cards, siblingTitles } = args;

  const cardText = cards
    .map((c, i) => {
      const parts = [`${i + 1}. ${c.label || "(untitled)"}`];
      if (c.summary) parts.push(`   ${c.summary}`);
      if (c.transcript && c.transcript !== c.summary) parts.push(`   (captured: ${c.transcript})`);
      return parts.join("\n");
    })
    .join("\n");

  const links = siblingTitles.filter((t) => slug(t) !== slug(topicTitle));
  const linkList = links.length ? links.map((t) => `- ${t}`).join("\n") : "(none)";

  const system = [
    "You maintain a living personal wiki built from voice-captured idea cards.",
    "Synthesize the cards for ONE topic into a single coherent, well-structured wiki article in GitHub-flavored Markdown.",
    "Rules:",
    "- Write flowing encyclopedic prose, not a restatement or bulleted dump of the cards.",
    "- Merge overlapping or duplicate ideas; preserve every DISTINCT point — never drop information.",
    "- Organize with descriptive `##`/`###` headings when the material warrants it. Do not repeat the title as an H1.",
    "- Do not invent facts beyond what the cards support; it's fine to note open questions the cards raise.",
    "- When you reference one of the other topics listed, link it with [[Exact Topic Title]].",
    "Call write_wiki_page exactly once.",
  ].join("\n");

  const user = [
    `TOPIC: ${topicTitle}`,
    "",
    "OTHER TOPICS you may link with [[...]]:",
    linkList,
    "",
    "CARDS (captured ideas under this topic):",
    cardText || "(no cards)",
  ].join("\n");

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4096,
    system,
    tools: [WRITE_WIKI_TOOL],
    tool_choice: { type: "tool", name: "write_wiki_page" },
    messages: [{ role: "user", content: user }],
  });

  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    // Fallback: never fail the rebuild outright.
    return { title: topicTitle, markdown: cardText };
  }
  const input = block.input as Record<string, unknown>;
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : topicTitle;
  const markdown = typeof input.markdown === "string" ? input.markdown : cardText;
  return { title, markdown };
}
