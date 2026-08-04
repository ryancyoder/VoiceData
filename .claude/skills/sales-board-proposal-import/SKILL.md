---
name: sales-board-proposal-import
description: Turn a photo of a Ricci's Landscape Management (RLM) proposal cover page into a deal on the Sales Board. Trigger whenever the user attaches or references a photo of a proposal — especially one with the "RLM | Ricci's Landscape Management, Inc." letterhead, a "Prepared For:" section, or a "Proposal #" — and asks to add it to the sales board, pipeline, CRM, or database, even if they just say "add this" or "can you enter this deal." Also trigger if they ask how to get proposal photos into the system going forward.
---

# Sales Board proposal import

Ricci's Landscape Management proposals always open with the same cover
page layout. This skill reads that cover page and turns it into a new
row in the Supabase "Sales Board" table — directly, when the session's
Supabase MCP tools allow it, falling back to a paste block for the user
otherwise (see "Direct write vs. paste box" below — read this before
step 3, it decides which path you take).

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

## 3. Show the user what you found, then write it

Always show the parsed fields as a short table first, whichever path you
end up taking below — this is the point where a misread digit or
swapped name gets caught, and it should happen before anything is
written, not after.

**Try the direct write first.** Call `execute_sql` on project
`ktgpjizfntdfpghalukx` with an `insert into "Sales Board" (...)`
statement covering whichever fields you have, `stage` always `'Lead'`,
and `returning id, deal_name, stage` so you can confirm what landed.
This tool takes raw SQL with no parameter binding, so escape every text
value yourself: double any single quote (`O'Brien` → `O''Brien`) and
wrap the whole thing in single quotes; omit a field entirely (don't send
empty-string) rather than guessing a value. If it succeeds, tell the
user the deal was created and show the returned row — done, no further
steps.

**If that call is rejected** (an MCP-level error about the tool call
needing approval, not a SQL error) **fall back to the paste block**,
since this has flipped between working and blocked across sessions
before and isn't something you can fix from inside the conversation:

1. Build a single-line JSON object with only the fields you have (omit
   blanks). Field names must match exactly: `deal_name`, `company`,
   `contact_first_name`, `contact_last_name`, `contact_email`,
   `contact_phone`, `proposal_number`, `proposal_date`,
   `proposal_description`, `jobsite_address`, `value`.
2. Give it to the user along with the board's link
   (`https://claude.ai/code/artifact/dd6cc8c0-0c78-4c11-bab8-12d85023683e`)
   and tell them: "Open the board, paste this into the box next to
   '+ New deal', click 'Fill form', check it looks right, and click
   Create deal."

Example JSON, for a proposal from Bill Maar (proposal #20407, dated
2026-07-30, "Hardscape Repair", jobsite at 29 S 400 E, Valparaiso, IN
46383):

```json
{"deal_name":"Maar","contact_first_name":"Bill","contact_last_name":"Maar","contact_email":"bill.maar@thrivent.com","contact_phone":"219-508-5844","proposal_number":"20407","proposal_date":"2026-07-30","jobsite_address":"29 S 400 E, Valparaiso, IN 46383","proposal_description":"Hardscape Repair"}
```

The board also accepts these same fields as URL query params on that
link (e.g. `?deal_name=Maar&...`) — but whether claude.ai's artifact
viewer forwards the address-bar query string through to the page isn't
reliable, so lead with the paste block, not the link.

## Direct write vs. paste box

Whether `execute_sql`/`apply_migration` work directly from a Claude Code
session depends on that session's MCP tool permissions, which are
configured outside this conversation and can change between sessions —
it's been seen both blocked (`MCP error -32003: MCP tool call requires
approval`, with no way to grant that approval from inside the session)
and working fine. Don't assume either state from what a past session
found; just try the direct write and see. When it's blocked, the live
artifact can still write successfully because it calls Supabase through
`window.claude.mcp` using the *viewer's own browser-authenticated
connector session* — a different path, unaffected by this session's
tool permissions — which is what the paste-and-confirm fallback relies
on.
