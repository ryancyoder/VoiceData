<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Repo skills

Project skills live in `.claude/skills/`. They auto-load when their trigger
matches, but are worth knowing about up front:

- **`sales-board-proposal-import`** — turn a photo of an RLM proposal cover
  page into a new deal on the Sales Board.
- **`plaud-transcript-import`** — import Plaud voice recordings of sales
  appointments into `deal_transcripts`, matched and auto-linked to each deal's
  Appointment event. Use it whenever pulling Plaud recordings, matching them to
  appointments, or saving an appointment transcript to a deal.
