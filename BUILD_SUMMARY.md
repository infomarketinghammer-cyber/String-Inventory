# Build Summary — Spring Manufacturing Inventory Module

## State of the build

The module implements the SOP (`Inventory_Module_SOP_Process_Flow.pdf`, v1.0) on
Next.js 15 + Prisma + a local SQLite file. It type-checks (`npx tsc --noEmit`), passes
`next build`, and has been exercised end to end:

| Check | Command | Result |
|---|---|---|
| Ledger reconciliation | `npm run db:verify` | OK on the seeded database |
| SOP replay through the real services | `npm run db:scenario` | 67 checks pass (incl. negative cases) |
| Role matrix over HTTP | manual sweep as Admin / Floor / anonymous | every screen + export responds; Floor gets 403 on admin-only reports and pages |

`npm test` (Vitest) and `npm run test:e2e` (Playwright) exist but could not be run in the
authoring environment (an OS application-control policy blocks the Vitest/Rollup native module).

## What the SOP audit found and fixed

- **Would not run:** Next 15 async `searchParams`/`params`; Edge middleware importing argon2;
  missing `Dispatch -> Customer` relation; the seed left a lot without a bundle link; document
  sequences were never aligned with seeded numbers, so the first real GRN/issue/lot collided.
- **FIFO / issue:** multi-bundle issues were rejected as "wrong bundle"; the issue form never
  submitted (React Hook Form `preventDefault` on a server-action form); MRN closed on a single
  issue instead of cumulatively; no cap at the MRN requirement; return to stores had no checks.
- **Production:** a lot could be inspected before its last operation was performed; coiling had no
  kg->nos cap; the same operation could be recorded repeatedly.
- **Job work:** no FIFO on send, no job-work-operation check, ignored vendor lead time / max return,
  vendor rejections not recorded, QC quantities unchecked, close-with-shortage left lots stranded.
- **Rejections / reversals:** disposal never zeroed stock and wrote ledger rows against internal ids;
  rework produced a lot with quantity 0; reversals subtracted kg for status-only moves and could be
  applied twice. Documents (rejection, adjustment, return) now use system-generated sequential numbers.
- **Reports / UI:** added Excel + PDF export, as-on-date aging with filters, opening/closing stock
  summary, JW pending kg and status, role-enforced report access, Return to Stores and Customer
  Return screens, full Masters entry (parts, routing, vendors, customers, suppliers, PO, schedule,
  settings), the "stock over the oldest bucket" alert, and forced password change.

See `README.md` ("SOP conformance and known limitations") for what is intentionally not built.