-- Hand-authored initial migration (see README "Deviations from prompt" /
-- "Known limitations": this sandbox's network policy blocked
-- binaries.prisma.sh, so `prisma migrate dev` could not generate this file
-- automatically here. It was written to match prisma/schema.prisma exactly
-- and applied+verified against a local Postgres with psql. On a normal
-- machine, `prisma migrate dev` would regenerate an equivalent file.

-- Enums
CREATE TYPE "Role" AS ENUM ('ADMIN', 'FLOOR');
CREATE TYPE "BundleStatus" AS ENUM ('QUALITY_HOLD', 'AVAILABLE', 'REJECTED', 'CONSUMED');
CREATE TYPE "LotStatus" AS ENUM ('IN_HOUSE', 'AT_JOB_WORK', 'JW_RETURN_QC', 'REJECTED', 'CLOSED');
CREATE TYPE "FgLotStatus" AS ENUM ('AVAILABLE', 'CONSUMED', 'REJECTED');
CREATE TYPE "LocationType" AS ENUM ('QC', 'STORES', 'WIP', 'JW_VENDOR', 'REJECTION', 'FG', 'VIRTUAL');
CREATE TYPE "MrnStatus" AS ENUM ('OPEN', 'PARTIALLY_ISSUED', 'CLOSED');
CREATE TYPE "OpType" AS ENUM ('IN_HOUSE', 'JOB_WORK');
CREATE TYPE "ChallanStatus" AS ENUM ('OPEN', 'PARTIALLY_RECEIVED', 'OVERDUE', 'CLOSED');
CREATE TYPE "RejectionStage" AS ENUM ('IQC', 'WIP', 'JW_RETURN', 'FQI', 'CUSTOMER_RETURN');
CREATE TYPE "DisposalType" AS ENUM ('PENDING', 'RTS', 'REWORK', 'SCRAP');
CREATE TYPE "TxnType" AS ENUM (
  'T1_GRN','T2_IQC_ACCEPT','T3_IQC_REJECT','T4_RTS','T5_ISSUE','T6_RETURN_TO_STORES',
  'T7_OP_COMPLETE','T8_JW_SEND','T9_JW_RECEIVE','T10_JW_RETURN_QC','T11_FINAL_INSPECTION',
  'T12_REJECTION','T13_REWORK','T14_SCRAP','T15_DISPATCH','T16_CUSTOMER_RETURN','T17_ADJUSTMENT'
);
CREATE TYPE "ItemType" AS ENUM ('RM', 'WIP', 'FG');

-- User / Audit
CREATE TABLE "User" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "forcePasswordChange" BOOLEAN NOT NULL DEFAULT false,
  "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "AuditLog" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT REFERENCES "User"("id"),
  "action" TEXT NOT NULL,
  "entity" TEXT,
  "entityId" TEXT,
  "oldValue" JSONB,
  "newValue" JSONB,
  "success" BOOLEAN NOT NULL DEFAULT true,
  "message" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- Masters
CREATE TABLE "Item" (
  "id" TEXT PRIMARY KEY,
  "itemCode" TEXT NOT NULL UNIQUE,
  "grade" TEXT NOT NULL,
  "diameterMm" DECIMAL(6,2) NOT NULL,
  "uom" TEXT NOT NULL DEFAULT 'kg',
  "agingAlertDays" INTEGER NOT NULL DEFAULT 30,
  "active" BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX "Item_grade_diameterMm_idx" ON "Item"("grade", "diameterMm");

CREATE TABLE "Customer" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "gstin" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE "Part" (
  "id" TEXT PRIMARY KEY,
  "partNo" TEXT NOT NULL UNIQUE,
  "customerId" TEXT NOT NULL REFERENCES "Customer"("id"),
  "description" TEXT NOT NULL,
  "netWtPerPcKg" DECIMAL(10,4) NOT NULL,
  "scrapAllowancePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE "Location" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "type" "LocationType" NOT NULL
);

CREATE TABLE "JobWorker" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "address" TEXT,
  "gstin" TEXT,
  "maxReturnDays" INTEGER NOT NULL DEFAULT 10,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "locationId" TEXT UNIQUE REFERENCES "Location"("id")
);

CREATE TABLE "BomLine" (
  "id" TEXT PRIMARY KEY,
  "partId" TEXT NOT NULL REFERENCES "Part"("id"),
  "opSeq" INTEGER NOT NULL,
  "opName" TEXT NOT NULL,
  "opType" "OpType" NOT NULL,
  "itemId" TEXT REFERENCES "Item"("id"),
  "defaultVendorId" TEXT REFERENCES "JobWorker"("id"),
  "jwLeadDays" INTEGER,
  UNIQUE ("partId", "opSeq")
);

CREATE TABLE "Supplier" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "gstin" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE "ReasonCode" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,
  "stage" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE "AdminSetting" (
  "id" TEXT PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "value" TEXT NOT NULL
);

CREATE TABLE "DocSequence" (
  "id" TEXT PRIMARY KEY,
  "docType" TEXT NOT NULL,
  "fiscalYear" TEXT NOT NULL,
  "lastNumber" INTEGER NOT NULL DEFAULT 0,
  UNIQUE ("docType", "fiscalYear")
);

-- PO / GRN / Bundle / IQC
CREATE TABLE "Po" (
  "id" TEXT PRIMARY KEY,
  "poNo" TEXT NOT NULL UNIQUE,
  "supplierId" TEXT NOT NULL REFERENCES "Supplier"("id"),
  "poDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "PoLine" (
  "id" TEXT PRIMARY KEY,
  "poId" TEXT NOT NULL REFERENCES "Po"("id"),
  "itemId" TEXT NOT NULL REFERENCES "Item"("id"),
  "orderedKg" DECIMAL(12,2) NOT NULL,
  "receivedKg" DECIMAL(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE "Grn" (
  "id" TEXT PRIMARY KEY,
  "grnNo" TEXT NOT NULL UNIQUE,
  "grnDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "poId" TEXT NOT NULL REFERENCES "Po"("id"),
  "invoiceNo" TEXT NOT NULL,
  "vehicleNo" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Bundle" (
  "id" TEXT PRIMARY KEY,
  "bundleNo" TEXT NOT NULL UNIQUE,
  "grnId" TEXT NOT NULL REFERENCES "Grn"("id"),
  "itemId" TEXT NOT NULL REFERENCES "Item"("id"),
  "heatNo" TEXT NOT NULL,
  "tcRef" TEXT,
  "receivedKg" DECIMAL(12,2) NOT NULL,
  "balanceKg" DECIMAL(12,2) NOT NULL,
  "inwardDate" TIMESTAMP(3) NOT NULL,
  "status" "BundleStatus" NOT NULL DEFAULT 'QUALITY_HOLD',
  "locationId" TEXT NOT NULL REFERENCES "Location"("id")
);
CREATE INDEX "Bundle_status_locationId_inwardDate_idx" ON "Bundle"("status", "locationId", "inwardDate");
CREATE INDEX "Bundle_itemId_status_idx" ON "Bundle"("itemId", "status");

CREATE TABLE "Iqc" (
  "id" TEXT PRIMARY KEY,
  "iqcNo" TEXT NOT NULL UNIQUE,
  "bundleId" TEXT NOT NULL UNIQUE REFERENCES "Bundle"("id"),
  "results" JSONB NOT NULL,
  "decision" TEXT NOT NULL,
  "enteredById" TEXT NOT NULL,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "reasonCodeId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- MRN / Issue / Production Lot
CREATE TABLE "Mrn" (
  "id" TEXT PRIMARY KEY,
  "mrnNo" TEXT NOT NULL UNIQUE,
  "partId" TEXT NOT NULL REFERENCES "Part"("id"),
  "plannedQtyNos" INTEGER NOT NULL,
  "requiredKg" DECIMAL(12,2) NOT NULL,
  "status" "MrnStatus" NOT NULL DEFAULT 'OPEN',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Issue" (
  "id" TEXT PRIMARY KEY,
  "issueNo" TEXT NOT NULL UNIQUE,
  "mrnId" TEXT NOT NULL REFERENCES "Mrn"("id"),
  "issuedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "overrideReason" TEXT
);

CREATE TABLE "IssueLine" (
  "id" TEXT PRIMARY KEY,
  "issueId" TEXT NOT NULL REFERENCES "Issue"("id"),
  "bundleId" TEXT NOT NULL REFERENCES "Bundle"("id"),
  "kgIssued" DECIMAL(12,2) NOT NULL
);

CREATE TABLE "ProductionLot" (
  "id" TEXT PRIMARY KEY,
  "lotNo" TEXT NOT NULL UNIQUE,
  "partId" TEXT NOT NULL REFERENCES "Part"("id"),
  "mrnId" TEXT NOT NULL REFERENCES "Mrn"("id"),
  "currentOpSeq" INTEGER NOT NULL DEFAULT 1,
  "qtyNos" INTEGER NOT NULL DEFAULT 0,
  "status" "LotStatus" NOT NULL DEFAULT 'IN_HOUSE',
  "locationId" TEXT NOT NULL REFERENCES "Location"("id"),
  "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ProductionLot_status_locationId_startDate_idx" ON "ProductionLot"("status", "locationId", "startDate");

CREATE TABLE "LotBundleLink" (
  "id" TEXT PRIMARY KEY,
  "lotId" TEXT NOT NULL REFERENCES "ProductionLot"("id"),
  "bundleId" TEXT NOT NULL REFERENCES "Bundle"("id"),
  "kgConsumed" DECIMAL(12,2) NOT NULL
);
CREATE INDEX "LotBundleLink_lotId_idx" ON "LotBundleLink"("lotId");
CREATE INDEX "LotBundleLink_bundleId_idx" ON "LotBundleLink"("bundleId");

CREATE TABLE "OperationEntry" (
  "id" TEXT PRIMARY KEY,
  "lotId" TEXT NOT NULL REFERENCES "ProductionLot"("id"),
  "opSeq" INTEGER NOT NULL,
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "goodNos" INTEGER NOT NULL,
  "rejectedNos" INTEGER NOT NULL DEFAULT 0,
  "reasonCodeId" TEXT,
  "enteredById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Job Work
CREATE TABLE "JwOutChallan" (
  "id" TEXT PRIMARY KEY,
  "challanNo" TEXT NOT NULL UNIQUE,
  "vendorId" TEXT NOT NULL REFERENCES "JobWorker"("id"),
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expectedReturnDate" TIMESTAMP(3) NOT NULL,
  "status" "ChallanStatus" NOT NULL DEFAULT 'OPEN',
  "createdById" TEXT NOT NULL,
  "closedWithShortageReason" TEXT
);

CREATE TABLE "JwChallanLine" (
  "id" TEXT PRIMARY KEY,
  "challanId" TEXT NOT NULL REFERENCES "JwOutChallan"("id"),
  "lotId" TEXT NOT NULL REFERENCES "ProductionLot"("id"),
  "opSeq" INTEGER NOT NULL,
  "qtyNos" INTEGER NOT NULL,
  "qtyKg" DECIMAL(12,2) NOT NULL,
  "receivedNos" INTEGER NOT NULL DEFAULT 0,
  "rejectedNos" INTEGER NOT NULL DEFAULT 0,
  "shortNos" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE "JwInReceipt" (
  "id" TEXT PRIMARY KEY,
  "receiptNo" TEXT NOT NULL UNIQUE,
  "challanId" TEXT NOT NULL REFERENCES "JwOutChallan"("id"),
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT NOT NULL
);

CREATE TABLE "JwReceiptLine" (
  "id" TEXT PRIMARY KEY,
  "receiptId" TEXT NOT NULL REFERENCES "JwInReceipt"("id"),
  "challanLineId" TEXT NOT NULL REFERENCES "JwChallanLine"("id"),
  "lotId" TEXT NOT NULL REFERENCES "ProductionLot"("id"),
  "receivedNos" INTEGER NOT NULL,
  "rejectedNos" INTEGER NOT NULL DEFAULT 0,
  "shortNos" INTEGER NOT NULL DEFAULT 0
);

-- Final inspection / FG / Dispatch
CREATE TABLE "FgLot" (
  "id" TEXT PRIMARY KEY,
  "fgLotNo" TEXT NOT NULL UNIQUE,
  "partId" TEXT NOT NULL REFERENCES "Part"("id"),
  "sourceLotId" TEXT NOT NULL REFERENCES "ProductionLot"("id"),
  "qtyNos" INTEGER NOT NULL,
  "balanceNos" INTEGER NOT NULL,
  "inwardDate" TIMESTAMP(3) NOT NULL,
  "status" "FgLotStatus" NOT NULL DEFAULT 'AVAILABLE',
  "approvedById" TEXT NOT NULL
);
CREATE INDEX "FgLot_status_partId_inwardDate_idx" ON "FgLot"("status", "partId", "inwardDate");

CREATE TABLE "CustomerSchedule" (
  "id" TEXT PRIMARY KEY,
  "customerId" TEXT NOT NULL REFERENCES "Customer"("id"),
  "partId" TEXT NOT NULL REFERENCES "Part"("id"),
  "dueDate" TIMESTAMP(3) NOT NULL,
  "qtyNos" INTEGER NOT NULL,
  "dispatchedNos" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE "Dispatch" (
  "id" TEXT PRIMARY KEY,
  "dispatchNo" TEXT NOT NULL UNIQUE,
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "customerId" TEXT NOT NULL REFERENCES "Customer"("id"),
  "invoiceNo" TEXT NOT NULL,
  "vehicleNo" TEXT,
  "createdById" TEXT NOT NULL
);

CREATE TABLE "DispatchLine" (
  "id" TEXT PRIMARY KEY,
  "dispatchId" TEXT NOT NULL REFERENCES "Dispatch"("id"),
  "scheduleId" TEXT NOT NULL REFERENCES "CustomerSchedule"("id"),
  "fgLotId" TEXT NOT NULL REFERENCES "FgLot"("id"),
  "qtyNos" INTEGER NOT NULL
);

-- Rejections / Disposal
CREATE TABLE "Rejection" (
  "id" TEXT PRIMARY KEY,
  "rejNo" TEXT NOT NULL UNIQUE,
  "stage" "RejectionStage" NOT NULL,
  "refType" TEXT NOT NULL,
  "refId" TEXT NOT NULL,
  "qty" DECIMAL(12,4) NOT NULL,
  "uom" TEXT NOT NULL,
  "reasonCodeId" TEXT NOT NULL,
  "disposal" "DisposalType" NOT NULL DEFAULT 'PENDING',
  "approvedById" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Stock Ledger: single source of truth
CREATE TABLE "StockLedger" (
  "id" TEXT PRIMARY KEY,
  "txnId" TEXT NOT NULL UNIQUE,
  "txnType" "TxnType" NOT NULL,
  "txnDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "docNo" TEXT NOT NULL,
  "itemType" "ItemType" NOT NULL,
  "refNo" TEXT NOT NULL,
  "fromLocationId" TEXT,
  "toLocationId" TEXT,
  "fromStatus" TEXT,
  "toStatus" TEXT,
  "qty" DECIMAL(14,4) NOT NULL,
  "uom" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "User"("id"),
  "reason" TEXT
);
CREATE INDEX "StockLedger_txnDate_refNo_idx" ON "StockLedger"("txnDate", "refNo");
CREATE INDEX "StockLedger_refNo_idx" ON "StockLedger"("refNo");
CREATE INDEX "StockLedger_docNo_idx" ON "StockLedger"("docNo");
