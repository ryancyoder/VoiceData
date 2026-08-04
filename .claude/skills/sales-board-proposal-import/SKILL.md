---
name: sales-board-proposal-import
description: Turn a photo of a Ricci's Landscape Management (RLM) proposal cover page into a deal on the Sales Board. Trigger whenever the user attaches or references a photo of a proposal — especially one with the "RLM | Ricci's Landscape Management, Inc." letterhead, a "Prepared For:" section, or a "Proposal #" — and asks to add it to the sales board, pipeline, CRM, or database, even if they just say "add this" or "can you enter this deal." Also trigger if they ask how to get proposal photos into the system going forward.
---

# Sales Board proposal import

Ricci's Landscape Management proposals always open with the same cover
page layout. This skill reads that cover page and turns it into a
pre-filled link the user opens and clicks once to create the deal — it
does not write to the database directly (see "Why a link, not a direct
write" below).

## 1. Read the cover page

Use the Read tool on the attached photo. The layout is consistent:

- **Top**: proposal title/type in large bold text next to the "RLM" logo
  (e.g. "Hardscape Repair") — this is `proposal_description`.
- **"Prepared By:"** — the RLM salesperson's name. There's no column for
  this yet (see "Fields with nowhere to go" below).
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

**Fields with nowhere to go yet**: "Prepared By" (the RLM salesperson) has
no column in the Sales Board today. Don't silently drop it — mention it
in your summary to the user (e.g. "Prepared by Ryan Yoder, per the
proposal — let me know if you want that tracked too"), but don't block
on it or invent a field for it yourself.

## 3. Build the link

Every new deal goes through the live Sales Board artifact, which reads
pre-fill values from its URL query string:

```
https://claude.ai/code/artifact/dd6cc8c0-0c78-4c11-bab8-12d85023683e
```

Build the query string the way `new URLSearchParams({...}).toString()`
would — percent-encode values, use `&` between pairs, and only include
fields you actually have (omit blank ones rather than sending empty
strings). Field names must match exactly: `deal_name`, `company`,
`contact_first_name`, `contact_last_name`, `contact_email`,
`contact_phone`, `proposal_number`, `proposal_date`,
`proposal_description`, `jobsite_address`, `value`.

Example, for a proposal from Bill Maar (proposal #20407, dated
2026-07-30, "Hardscape Repair", jobsite at 29 S 400 E, Valparaiso, IN
46383):

```
https://claude.ai/code/artifact/dd6cc8c0-0c78-4c11-bab8-12d85023683e?deal_name=Maar&contact_first_name=Bill&contact_last_name=Maar&contact_email=bill.maar%40thrivent.com&contact_phone=219-508-5844&proposal_number=20407&proposal_date=2026-07-30&jobsite_address=29+S+400+E%2C+Valparaiso%2C+IN+46383&proposal_description=Hardscape+Repair
```

## 4. Hand it to the user

Show the parsed fields as a short table so they can sanity-check the OCR
at a glance (this is the point where a misread digit or swapped name
gets caught), then give them the link with something like: "Open this,
check the pre-filled New Deal form looks right, and click Create deal."

Don't try execute_sql/apply_migration first and fall back to the link —
go straight to the link. It's the working path, not a fallback (see
below).

## Why a link, not a direct write

Direct Supabase tool calls from a Claude Code session
(`execute_sql`/`apply_migration`) currently return `MCP error -32003:
MCP tool call requires approval` with no way to grant that approval from
inside the session — confirmed by repeated testing, not a one-off
fluke. The live artifact writes successfully because it calls Supabase
through `window.claude.mcp` using the *viewer's own browser-authenticated
connector session*, a completely different path that isn't affected by
this. The pre-fill-and-confirm flow exists specifically to route around
that gap while still keeping a human glance on OCR'd data before it
lands in a real CRM — don't try to "fix" this by attempting a direct
write first.
