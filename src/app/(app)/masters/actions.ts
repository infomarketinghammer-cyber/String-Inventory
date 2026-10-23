"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { requireAction } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { toUserError } from "@/server/userError";
import { createJobWorker } from "@/server/services/jobwork";

/** Redirect back to /masters with a banner message. */
function done(ok: string): never {
  redirect(`/masters?ok=${encodeURIComponent(ok)}`);
}
function fail(err: string): never {
  redirect(`/masters?err=${encodeURIComponent(err)}`);
}

/** Prisma unique-constraint violations become a friendly message instead of a 500. */
async function guarded<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (typeof e === "object" && e && (e as { code?: string }).code === "P2002") {
      fail(`${what} already exists.`);
    }
    // Anything else: a safe message on screen, details only in the server log.
    fail(toUserError(e).message);
  }
}

const text = (name: string) => z.string().trim().min(1, `${name} is required`);
const opt = z.string().trim().optional().transform((v) => v || undefined);

// ---------------------------------------------------------------- items / reason codes

const itemSchema = z.object({ itemCode: text("Item code"), grade: text("Grade"), diameterMm: z.coerce.number().positive() });

export async function createItemAction(formData: FormData) {
  await requireAction("masters.manage"); // Admin-only create/approve of masters
  const parsed = itemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("Invalid item.");
  await guarded("That item code", () => prisma.item.create({ data: parsed.data }));
  done("Item added.");
}

const reasonSchema = z.object({ code: text("Code"), stage: text("Stage"), description: text("Description") });

export async function createReasonCodeAction(formData: FormData) {
  await requireAction("masters.manage");
  const parsed = reasonSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("Invalid reason code.");
  await guarded("That reason code", () => prisma.reasonCode.create({ data: parsed.data }));
  done("Reason code added.");
}

// ---------------------------------------------------------------- suppliers / customers / job workers

const partySchema = z.object({ name: text("Name"), gstin: opt });

export async function createSupplierAction(formData: FormData) {
  await requireAction("masters.manage");
  const parsed = partySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("Supplier name is required.");
  await prisma.supplier.create({ data: parsed.data });
  done("Supplier added.");
}

export async function createCustomerAction(formData: FormData) {
  await requireAction("masters.manage");
  const parsed = partySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("Customer name is required.");
  await prisma.customer.create({ data: parsed.data });
  done("Customer added.");
}

const jobWorkerSchema = z.object({
  name: text("Name"),
  address: opt,
  gstin: opt,
  maxReturnDays: z.coerce.number().int().min(1).max(365),
});

/** Each job worker gets its own "At Job Worker - <name>" location (SOP section 5). */
export async function createJobWorkerAction(formData: FormData) {
  await requireAction("masters.manage");
  const parsed = jobWorkerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("Enter a name and a max return period of 1-365 days.");
  await guarded("A job worker or location with that name", () =>
    prisma.$transaction((tx) =>
      createJobWorker(tx, {
        name: parsed.data.name,
        address: parsed.data.address ?? undefined,
        gstin: parsed.data.gstin ?? undefined,
        maxReturnDays: parsed.data.maxReturnDays,
      }),
    ),
  );
  done("Job worker added with its own location.");
}

// ---------------------------------------------------------------- parts / BOM routing

const partSchema = z.object({
  partNo: text("Part no."),
  customerId: text("Customer"),
  description: text("Description"),
  netWtPerPcKg: z.coerce.number().positive(),
  scrapAllowancePct: z.coerce.number().min(0).max(100).default(0),
});

export async function createPartAction(formData: FormData) {
  await requireAction("masters.manage");
  const parsed = partSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("Enter part no., customer, description and a positive net weight per piece.");
  await guarded("That part no.", () => prisma.part.create({ data: parsed.data }));
  done("Part added. Now add its routing steps (the first step must name the wire item).");
}

const bomSchema = z.object({
  partId: text("Part"),
  opSeq: z.coerce.number().int().positive(),
  opName: text("Operation name"),
  opType: z.enum(["IN_HOUSE", "JOB_WORK"]),
  itemId: opt,
  defaultVendorId: opt,
  jwLeadDays: z.coerce.number().int().positive().optional().or(z.literal("").transform(() => undefined)),
});

export async function addBomLineAction(formData: FormData) {
  await requireAction("masters.manage");
  const parsed = bomSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("Enter part, operation sequence, name and type.");
  const d = parsed.data;
  if (d.opSeq === 1 && !d.itemId) fail("The first operation (coiling) must name the wire item it consumes.");
  if (d.opType === "IN_HOUSE" && (d.defaultVendorId || d.jwLeadDays)) fail("Vendor and lead time apply to Job Work steps only.");
  await guarded("That operation sequence for this part", () =>
    prisma.bomLine.create({
      data: {
        partId: d.partId,
        opSeq: d.opSeq,
        opName: d.opName,
        opType: d.opType,
        itemId: d.itemId,
        defaultVendorId: d.opType === "JOB_WORK" ? d.defaultVendorId : undefined,
        jwLeadDays: d.opType === "JOB_WORK" ? d.jwLeadDays : undefined,
      },
    }),
  );
  done("Routing step added.");
}

// ---------------------------------------------------------------- PO / customer schedule (reference data)

const poSchema = z.object({
  poNo: text("PO no."),
  supplierId: text("Supplier"),
  itemId: text("Item"),
  orderedKg: z.coerce.number().positive(),
});

/** PO creation/approval is out of scope for the module; this records a PO as reference data for GRN. */
export async function createPoAction(formData: FormData) {
  await requireAction("masters.manage");
  const parsed = poSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("Enter PO no., supplier, item and ordered kg.");
  const { poNo, supplierId, itemId, orderedKg } = parsed.data;
  const existing = await prisma.po.findUnique({ where: { poNo }, include: { lines: true } });
  if (existing) {
    if (existing.supplierId !== supplierId) fail(`PO ${poNo} belongs to a different supplier.`);
    if (existing.lines.some((l) => l.itemId === itemId)) fail(`PO ${poNo} already has a line for that item.`);
    await prisma.poLine.create({ data: { poId: existing.id, itemId, orderedKg } });
    done(`Line added to PO ${poNo}.`);
  }
  await prisma.po.create({ data: { poNo, supplierId, lines: { create: { itemId, orderedKg } } } });
  done(`PO ${poNo} added.`);
}

const scheduleSchema = z.object({
  partId: text("Part"),
  dueDate: z.coerce.date(),
  qtyNos: z.coerce.number().int().positive(),
});

export async function createScheduleAction(formData: FormData) {
  await requireAction("masters.manage");
  const parsed = scheduleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("Enter part, due date and a positive quantity.");
  const part = await prisma.part.findUnique({ where: { id: parsed.data.partId } });
  if (!part) fail("Part not found.");
  await prisma.customerSchedule.create({
    data: { customerId: part.customerId, partId: part.id, dueDate: parsed.data.dueDate, qtyNos: parsed.data.qtyNos },
  });
  done("Customer schedule line added.");
}

// ---------------------------------------------------------------- admin settings

const settingsSchema = z.object({
  PO_TOLERANCE_PCT: z.coerce.number().min(0).max(100),
  AGING_BUCKETS: z
    .string()
    .trim()
    .regex(/^\d+(\s*,\s*\d+)*$/, "Aging buckets must be comma-separated whole numbers"),
  QC_HOLD_ALERT_DAYS: z.coerce.number().min(0),
  JW_ALERT_DAYS_BEFORE: z.coerce.number().min(0),
  MRN_KG_EDIT_PCT: z.coerce.number().min(0).max(100),
});

export async function saveSettingsAction(formData: FormData) {
  await requireAction("masters.manage");
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? "Invalid settings.");
  const buckets = parsed.data.AGING_BUCKETS.split(",").map((s) => Number(s.trim()));
  if (buckets.some((b, i) => b <= 0 || (i > 0 && b <= buckets[i - 1]!))) {
    fail("Aging buckets must be positive and strictly increasing, e.g. 30,60,90,180.");
  }
  const entries: Record<string, string> = {
    PO_TOLERANCE_PCT: String(parsed.data.PO_TOLERANCE_PCT),
    AGING_BUCKETS: buckets.join(","),
    QC_HOLD_ALERT_DAYS: String(parsed.data.QC_HOLD_ALERT_DAYS),
    JW_ALERT_DAYS_BEFORE: String(parsed.data.JW_ALERT_DAYS_BEFORE),
    MRN_KG_EDIT_PCT: String(parsed.data.MRN_KG_EDIT_PCT),
  };
  for (const [key, value] of Object.entries(entries)) {
    await prisma.adminSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }
  done("Settings saved.");
}
