---
name: sales-board-proposal-import
description: Turn a photo of a Ricci's Landscape Management (RLM) proposal cover page into a deal on the Sales Board. Trigger whenever the user attaches or references a photo of a proposal — especially one with the "RLM | Ricci's Landscape Management, Inc." letterhead, a "Prepared For:" section, or a "Proposal #" — and asks to add it to the sales board, pipeline, CRM, or database, even if they just say "add this" or "can you enter this deal." Also trigger if they ask how to get proposal photos into the system going forward.
---

# Sales Board proposal import

Ricci's Landscape Management proposals always open with the same cover
page layout. This skill reads that cover page and turns it into a small
block of text the user pastes into the Sales Board to pre-fill a new
deal — it does not write to the database directly (see "Why a paste box,
not a direct write" below).

## 1. Read the cover page

Use the Read tool on the attached photo. The layout is consistent:

- **Top**: proposal title/type in large bold text next to the "RLM" logo
  (e.g. "Hardscape Repair") — this is `proposal_description`.
- **"Prepared By:"** — the RLM salesperson's name. Not tracked on the
  Sales Board (decided deliberately) — read past it, no need to mention
  it to the user.
- **"Prepared For:"** block — customer's full name (bold), then their
  mailing address, then email and phone on one line together.
- **"Jobsite Location:"** block — often a *different* address than the
  mailing address above it. Usually formatted as "LastName - street
  address" followed by city/state/zip on the next line. Capture the
  whole thing as one string in `jobsite_address` — don't confuse it with
  the contact's mailing address, and don't drop it just because it looks
  redundant with the customer's address.
- **Near the top, right side**: `Proposal #` (a 5-digit number) and a
  date in MM/DD/YYYY — convert the date to ISO `YYYY-MM-DD`.
- **Footer**: Ricci's Landscape Management's own address and phone. This
  is the company's own info, never the customer's — don't let it leak
  into contact fields.

If any of this is illegible, cropped out, or the page doesn't match this
layout, ask the user rather than guessing — a wrong phone number or
proposal number is worse than a blank one.

## 2. Map to Sales Board fields

| Cover page | Field | Notes |
|---|---|---|
| Customer's last name | `deal_name` | **Last name only**, not the full name. Every existing deal on the board is named this way (e.g. "Maar", "KOELLING") — matching it keeps the board scannable and consistent. |
| "Prepared For" first/last | `contact_first_name` / `contact_last_name` | |
| "Prepared For" email/phone | `contact_email` / `contact_phone` | |
| Proposal # | `proposal_number` | Keep as text, even though it looks numeric — don't cast it. |
| Proposal date | `proposal_date` | Convert to `YYYY-MM-DD`. |
| Proposal title (top of page) | `proposal_description` | |
| "Jobsite Location" | `jobsite_address` | One string, full address. |
| — | `company` | **Leave blank** unless "Prepared For" is clearly a business name, not a person — RLM's proposals are almost always residential. |
| — | `value` | **Always leave blank.** The dollar total is never on this cover page (it's later in the multi-page proposal). Only set it if the user gives you a number directly — never estimate or infer it. |

"Prepared By" (the RLM salesperson) is deliberately not tracked on the
Sales Board — skip it silently, don't ask about it or propose adding a
field for it.

## 3. Build the paste block

The live Sales Board artifact is here:

```
https://claude.ai/code/artifact/dd6cc8c0-0c78-4c11-bab8-12d85023683e
```

It has a small "Paste deal data from Claude here…" box next to the
"+ New deal" button, top of the board. Give it a single-line JSON object
with only the fields you actually have (omit blank ones rather than
sending empty strings). Field names must match exactly: `deal_name`,
`company`, `contact_first_name`, `contact_last_name`, `contact_email`,
`contact_phone`, `proposal_number`, `proposal_date`,
`proposal_description`, `jobsite_address`, `value`.

Example, for a proposal from Bill Maar (proposal #20407, dated
2026-07-30, "Hardscape Repair", jobsite at 29 S 400 E, Valparaiso, IN
46383):

```json
{"deal_name":"Maar","contact_first_name":"Bill","contact_last_name":"Maar","contact_email":"bill.maar@thrivent.com","contact_phone":"219-508-5844","proposal_number":"20407","proposal_date":"2026-07-30","jobsite_address":"29 S 400 E, Valparaiso, IN 46383","proposal_description":"Hardscape Repair"}
```

The board also accepts these same fields as URL query params on that
link (e.g. `?deal_name=Maar&...`) as a bonus shortcut — but whether
claude.ai's artifact viewer forwards the address-bar query string
through to the page isn't something this skill can rely on, so always
give the user the paste block as the primary method. Only mention the
URL-param form if the user specifically wants a clickable link and
you've confirmed with them that it worked before relying on it again.

## 4. Hand it to the user

Show the parsed fields as a short table so they can sanity-check the OCR
at a glance (this is the point where a misread digit or swapped name
gets caught), then give them the JSON block with something like: "Open
the board, paste this into the box next to '+ New deal', click 'Fill
form', check it looks right, and click Create deal."

Don't try execute_sql/apply_migration first and fall back to the paste
block — go straight to it. It's the working path, not a fallback (see
below).

## Why a paste box, not a direct write

Direct Supabase tool calls from a Claude Code session
(`execute_sql`/`apply_migration`) currently return `MCP error -32003:
MCP tool call requires approval` with no way to grant that approval from
inside the session — confirmed by repeated testing, not a one-off
fluke. The live artifact writes successfully because it calls Supabase
through `window.claude.mcp` using the *viewer's own browser-authenticated
connector session*, a completely different path that isn't affected by
this. The paste-and-confirm flow exists specifically to route around
that gap while still keeping a human glance on OCR'd data before it
lands in a real CRM — don't try to "fix" this by attempting a direct
write first.
