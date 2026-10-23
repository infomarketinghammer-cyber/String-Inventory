# Spring Manufacturing Inventory Module

A full-stack inventory module for a spring manufacturing factory, covering
receipt (GRN), incoming QC, bundle tagging, material requisition and FIFO
issue, production/WIP tracking, job work, final inspection, dispatch,
rejections/disposal, stock adjustments/reversals, masters, reports and a
traceability explorer — per the SOP specification (v1.0, 13 Oct 2026).

## Deviations from the original prompt

**Database: SQLite (a local file) via Prisma.** The original brief asked for
"Mongo"; the first build used PostgreSQL. This build stores all data in a
single local SQLite file (`prisma/dev.db`) so the app runs on any machine with
Node and nothing else — no database server, no Docker. It keeps the same
relational guarantees the design needs: every stock movement runs in one
transaction together with its ledger row, and SQLite serializes write
transactions, so two concurrent issues can never double-consume a bundle (the
old `SELECT ... FOR UPDATE` lock is no longer needed). The previous PostgreSQL
schema and migration are kept in `prisma/postgres-backup/` for reference.

## Tech stack

TypeScript (strict, no `any`) end to end · Next.js 15 App Router, React 19 ·
SQLite + Prisma ORM · Auth.js (NextAuth v5) Credentials provider +
argon2 · Zod validation on every server action/route · Tailwind CSS ·
React Hook Form (FIFO scan screen) · `qrcode` for bundle tag QR codes ·
`exceljs` / `pdf-lib` for report export · Vitest (unit) + Playwright (e2e).

## Running it

```bash
cp .env.example .env            # edit AUTH_SECRET for anything beyond local use
npm install
npx prisma db push              # creates prisma/dev.db from the schema
npm run db:seed                 # demo data (reproduces the SOP section 7 worked example)
npm run db:demo                 # optional: rich client-demo data on top of the seed
npm run db:verify               # ledger reconciliation (must print "OK")
npm run dev                     # http://localhost:3000
```

Or with Docker (single container, data on a persistent volume):
`docker compose up --build`.

To start over with fresh demo data: `npx prisma db push --force-reset && npm run db:seed && npm run db:demo`.
## Demo credentials

All seeded users share the password `Demo@1234` — **change this before any
real deployment.** Roles per the spec's named people:

| Email | Role | Typical person |
|---|---|---|
| stores.admin@demo.local | Admin | Stores in-charge |
| quality.admin@demo.local | Admin | Quality head |
| plant.admin@demo.local | Admin | Plant/Production manager |
| storekeeper@demo.local | Floor | Store keeper |
| supervisor@demo.local | Floor | Production supervisor |
| qc.inspector@demo.local | Floor | QC inspector |
| dispatch@demo.local | Floor | Dispatch clerk |

## Seeded scenario

The seed reproduces **Section 7's worked example exactly**: Item SW-C
3.0mm has bundles `RM-2609-0031` (inward 2026-09-04, 150kg),
`RM-2609-0047` (inward 2026-09-18, 500kg), `RM-2610-0003` (inward
2026-10-02, 500kg) and `RM-2610-0019` (inward 2026-10-09, 500kg), all
Available in RM Stores, plus an **Open** `MRN-2610-0008` requiring 900kg of
the same item. Go to **Material Issue (FIFO) → MRN-2610-0008** and scan
`RM-2610-0019` first to see the exact block message
("Wrong bundle. Issue RM-2609-0031 first (inward 2026-09-04)."), or scan
the three oldest bundles in order (150 + 500 + 250kg) to see it accepted and
`RM-2610-0019` left untouched. The same scenario is reproduced as a pure
Vitest unit test in `tests/unit/fifo.test.ts` (passing).

Beyond that, the seed includes 6 wire items, 8 parts across 4 customers
with BOM/routing (coiling → heat treatment [Job Work] → grinding → plating
[Job Work]), 5 suppliers, 4 job workers, 4 customers, 20 reason codes,
admin settings (PO tolerance +2%, aging buckets 30/60/90/180, QC-hold alert
2 days, JW alert 3 days before due), ~12 GRNs/bundles, ~10 MRNs, a
reconciled Issue→Production Lot→Operations→JW→FG→Dispatch chain, a few more
FG lots/schedules/dispatches, and rejections across stages.

## Section 10 assumptions, as implemented

| # | Question | Assumed (spec) | Implemented as |
|---|---|---|---|
| 1 | IQC per bundle or per GRN? | Per bundle | `Iqc` has a 1:1 relation to `Bundle`; the IQC screen lists individual pending bundles |
| 2 | Partial acceptance of one bundle? | No | `approveIqc()` moves the bundle's *entire* `balanceKg`; there is no per-bundle split path |
| 3 | Bundle No. format/generator | System, RM-YYMM-#### | `genBundleNo()` in `docNumber.ts`, atomic per-YYMM sequence, no manual entry field exists |
| 4 | One MRN/Lot = one Part No. always? | Yes | `ProductionLot.partId` is a single required FK; schema has no multi-part lot concept |
| 5 | WIP in nos after coiling; kg↔nos conversion | Nos after coiling, via net wt/pc | `recordOperationEntry()` for op 1 (coiling) records `goodNos`; `Part.netWtPerPcKg` drives the MRN's `requiredKg` calc |
| 6 | One JW challan, multiple lots/Parts? | Yes, multiple lines | `JwOutChallan` has a `lines: JwChallanLine[]` (1:N) |
| 7 | Max JW return period / ITC-04 | Admin-set per vendor; ITC-04 out of scope | `JobWorker.maxReturnDays`; no ITC-04 export exists |
| 8 | QC on every JW return? | Yes | `JW_RETURN_QC` location/status is mandatory between JW receipt (T9) and re-entry to in-house WIP (T10) |
| 9 | In-process inspection recorded? | Only final inspection; per-op rejections recorded | `OperationEntry.rejectedNos` per op; `approveFinalInspection()` is the only FG-creating gate |
| 10 | Customer returns in this module? | Yes, into Rejected-FG | `createCustomerReturn()` (T16) |
| 11 | Scrap sale / scrap kg tracked? | Scrap kg tracked; sale out of scope | `T14_SCRAP` ledger rows; no sales/invoicing model |
| 12 | Aging buckets/alerts | 0-30/31-60/61-90/91-180/over180; QC-hold 2d; JW 3d | `AdminSetting` rows `AGING_BUCKETS`, `QC_HOLD_ALERT_DAYS`, `JW_ALERT_DAYS_BEFORE`, all editable, with code defaults matching the spec |
| 13 | Barcode/QR on floor, manual fallback? | Yes, manual fallback | Bundle Tag print page renders a `qrcode`-generated QR; the Issue scan input also accepts typed Bundle No. |
| 14 | Valuation (₹) in aging report? | No, quantity only | Aging report has no currency column anywhere |

## SOP conformance and known limitations

The build was audited against the SOP (`Inventory_Module_SOP_Process_Flow.pdf`) and the
gaps found were fixed; `npm run db:scenario` (below) replays the SOP end to end and asserts
the rules, including the negative cases. What to know:

- **Partial job-work returns.** A Production Lot is one stock unit, so while any quantity of
  a challan line is still at the vendor the lot stays *At Job Work*. It moves to JW Return QC
  when the line is fully received, or when an Admin closes the challan with a shortage reason
  (the outstanding quantity is written off as *short*). Each receipt still posts its own T9
  ledger row. Likewise, a lot is sent to a job worker whole (no partial lot sends).
- **WIP aging is current-state.** RM and FG aging / stock summary are rebuilt from the Stock
  Ledger as on the chosen date. WIP lots carry no per-lot quantity history in the ledger, so
  the WIP aging report shows each lot's current state for lots started on or before the date.
  The stock summary covers RM (kg, per wire item) and FG (nos, per Part).
- **Transaction reversal** supports GRN, Issue, Dispatch and Adjustment entries. Status-only
  moves (IQC, job work, rejections) are corrected through their own screens; a reversal is
  refused if it would cause negative stock, or if an issue's lot has already started production.
- **ITC-04 export** is not built (open question 7 in the SOP). **JW challan and Issue-slip
  print views** are not built; Bundle Tag (with QR) and Dispatch Note print views are.
- **GRN receipts and POs.** A scanned supplier invoice/challan (PDF, PNG, JPG, WEBP, max 5 MB) can be uploaded when saving a GRN or attached later from the GRN list; files are stored under `UPLOAD_DIR` (default `./uploads`) and served only to signed-in users. Admins can add multi-line POs from the GRN screen (or Masters). `npm run db:receipt-check` tests these rules (scratch DB only).
- **Barcode scanning** works with a keyboard-wedge scanner or typed Bundle No. (no camera).
- **Seed volume** is deliberately small so every balance is hand-reconcilable.
## Mandatory architecture rules — where to find them

- **Stock Ledger as single source of truth**: `src/server/services/ledger.ts`
  (`writeLedger`), written in the same Prisma transaction as every balance
  update, in every service under `src/server/services/`.
- **Immutability / reversal**: `src/server/services/adjustment.ts`
  (`reverseTransaction`) — never edits/deletes, always a new signed row;
  refuses if it would cause negative stock.
- **Concurrency safety**: every stock-moving service runs in a
  `Serializable` transaction (SQLite serializes writers), re-validating balances and FIFO
  inside the transaction before writing the balance and ledger rows together.
- **System-generated doc numbers**: `src/server/services/docNumber.ts`,
  atomic per-period `upsert` + `increment` inside the same transaction.
- **State machine, not free text**: all statuses/locations are Prisma enums
  (`BundleStatus`, `LotStatus`, `FgLotStatus`, `LocationType`, ...).
- **Business logic in services, not components**: see `src/server/services/*`;
  pages/server actions only call these.
- **Central policy**: `src/server/policy/index.ts` (`can()`), unit-tested in
  `tests/unit/policy.test.ts`.

## Testing

```bash
npm run db:verify     # reconciles every Bundle / FG Lot balance against the ledger
npm run db:scenario   # end-to-end SOP replay through the real services (writes data!)
npm run db:sop-check  # SOP 4.2-4.10 data flow + role matrix checks (writes data!)
npm run db:receipt-check # PO / GRN / receipt-upload / invoice-date rules (writes data!)
npm test              # Vitest unit tests (FIFO engine, permission matrix, doc numbers)
npm run test:e2e      # Playwright specs (need the app running)
```

`db:scenario`, `db:receipt-check` and `db:sop-check` write test data, so they only run when
`DATABASE_URL` is set explicitly to a scratch database. They refuse to start against `dev.db` or when
the variable comes only from `.env` (see `prisma/scratch-guard.ts`):

```powershell
$env:DATABASE_URL="file:./scenario.db"
npx prisma db push --force-reset --skip-generate
npm run db:seed
npm run db:scenario; npm run db:receipt-check; npm run db:sop-check; npm run db:verify
Remove-Item Env:DATABASE_URL   # back to the working database
```

`db:scenario` covers GRN
tolerance, IQC, the FIFO worked example (including blocked out-of-order scans), return to stores,
production limits, job-work send/receive/QC/close-with-shortage, final inspection, dispatch and
over-dispatch approval, customer returns, rejection disposal (RTS / rework / scrap), adjustments
and reversals.