/**
 * `npm run db:receipt-check` — checks PO creation and GRN receipt upload rules.
 * Writes data: run it on a scratch DB only, e.g. (PowerShell) $env:DATABASE_URL="file:./scenario.db".
 */
import "./scratch-guard";
import { prisma } from "../src/lib/prisma";
import { createPo } from "../src/server/services/po";
import { createGrn, localDateString } from "../src/server/services/grn";
import { saveReceipt, readReceipt, saveDocument } from "../src/server/services/uploads";

let failed = 0;
const check = (name: string, ok: boolean, d = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${!ok && d ? ` (${d})` : ""}`);
};
async function throwsWith(name: string, part: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    check(name, m.toLowerCase().includes(part.toLowerCase()), m);
  }
}

async function main() {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "storekeeper@demo.local" } });
  const supplier = await prisma.supplier.findFirstOrThrow();
  const items = await prisma.item.findMany({ take: 2 });

  console.log("PO creation");
  await throwsWith("PO needs at least one line", "at least one", () => createPo({ poNo: "PO-T1", supplierId: supplier.id, lines: [] }));
  await throwsWith("ordered kg must be positive", "greater than zero", () =>
    createPo({ poNo: "PO-T1", supplierId: supplier.id, lines: [{ itemId: items[0]!.id, orderedKg: 0 }] }),
  );
  await throwsWith("same item twice is refused", "twice", () =>
    createPo({ poNo: "PO-T1", supplierId: supplier.id, lines: [{ itemId: items[0]!.id, orderedKg: 5 }, { itemId: items[0]!.id, orderedKg: 5 }] }),
  );
  const po = await createPo({
    poNo: "PO-TEST-001",
    supplierId: supplier.id,
    lines: [{ itemId: items[0]!.id, orderedKg: 1000 }, { itemId: items[1]!.id, orderedKg: 500 }],
  });
  check("multi-line PO is created", po.lines.length === 2);
  check("a new PO is always dated today (no back/post-dating)", localDateString(po.poDate) === localDateString(new Date()));
  await throwsWith("duplicate PO no. is refused", "already exists", () =>
    createPo({ poNo: "PO-TEST-001", supplierId: supplier.id, lines: [{ itemId: items[0]!.id, orderedKg: 5 }] }),
  );

  console.log("\nNew supplier + PO document");
  await throwsWith("new supplier needs a name", "supplier's name", () =>
    createPo({ poNo: "PO-NS0", supplierId: "__new__", newSupplier: { name: "  " }, lines: [{ itemId: items[0]!.id, orderedKg: 5 }] }),
  );
  await throwsWith("new supplier with an existing name is refused", "already exists", () =>
    createPo({ poNo: "PO-NS1", supplierId: "__new__", newSupplier: { name: supplier.name }, lines: [{ itemId: items[0]!.id, orderedKg: 5 }] }),
  );
  const suppliersBefore = await prisma.supplier.count();
  await throwsWith("a PO that fails does not leave a half-created supplier behind", "greater than zero", () =>
    createPo({ poNo: "PO-NS2", supplierId: "__new__", newSupplier: { name: "Rollback Metals" }, lines: [{ itemId: items[0]!.id, orderedKg: 0 }] }),
  );
  check("...(supplier count unchanged)", (await prisma.supplier.count()) === suppliersBefore);
  const doc = await saveDocument(new File([Buffer.from("%PDF-1.4\n")], "po-77.pdf", { type: "application/pdf" }), "po-documents", "PO document");
  const poNew = await createPo({
    poNo: "PO-NEWV-001",
    supplierId: "__new__",
    newSupplier: { name: "Fresh Wire Traders", gstin: "27ABCDE1234F1Z5" },
    lines: [{ itemId: items[0]!.id, orderedKg: 250 }],
    document: doc,
  });
  const created = await prisma.supplier.findFirstOrThrow({ where: { name: "Fresh Wire Traders" } });
  check("PO with a brand-new supplier registers the supplier and links it", poNew.supplierId === created.id && created.gstin === "27ABCDE1234F1Z5");
  const poRow = await prisma.po.findUniqueOrThrow({ where: { id: poNew.id } });
  check("PO keeps its uploaded document", poRow.documentPath === doc!.path && poRow.documentName === "po-77.pdf");

  console.log("\nReceipt upload");
  const pdf = new File([Buffer.from("%PDF-1.4\n%test\n")], "invoice 42.pdf", { type: "application/pdf" });
  const stored = await saveReceipt(pdf);
  check("a real PDF is stored under a server-generated name", !!stored && /^[0-9a-f-]{36}\.pdf$/.test(stored.receiptPath) && stored.receiptName === "invoice 42.pdf");
  check("the stored bytes can be read back", stored ? (await readReceipt(stored.receiptPath)).toString().startsWith("%PDF") : false);
  check("no file chosen -> nothing stored (optional)", (await saveReceipt(null)) === null && (await saveReceipt(new File([], "x.pdf"))) === null);
  await throwsWith("a text file renamed .pdf is refused", "does not match", () =>
    saveReceipt(new File([Buffer.from("just text")], "evil.pdf", { type: "application/pdf" })),
  );
  await throwsWith("an executable is refused", "PDF, JPG, JPEG or PNG", () =>
    saveReceipt(new File([Buffer.from("MZ")], "a.exe", { type: "application/x-msdownload" })),
  );
  await throwsWith("a WEBP image is refused (only PDF, JPG, JPEG, PNG)", "PDF, JPG, JPEG or PNG", () =>
    saveReceipt(new File([Buffer.from("RIFF0000WEBPVP8 ")], "scan.webp", { type: "image/webp" })),
  );
  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
  const jpg = await saveReceipt(new File([jpegBytes], "challan.jpeg", { type: "" }));
  check("a .jpeg file is accepted even when the browser sends no type", !!jpg && jpg.receiptMime === "image/jpeg" && jpg.receiptPath.endsWith(".jpg"));
  const png = await saveReceipt(new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])], "invoice.png", { type: "image/png" }));
  check("a PNG is accepted", !!png && png.receiptMime === "image/png");
  await throwsWith("a file over 5 MB is refused", "too large", () =>
    saveReceipt(new File([Buffer.alloc(5 * 1024 * 1024 + 1)], "big.pdf", { type: "application/pdf" })),
  );
  await throwsWith("path traversal is refused on read", "Invalid", () => readReceipt("../.env"));

  console.log("\nInvoice date");
  const tomorrow = new Date(`${localDateString(new Date(Date.now() + 86400000))}T00:00:00.000Z`);
  await throwsWith("a post-dated (future) invoice date is refused", "cannot be in the future", () =>
    createGrn({ poId: po.id, invoiceNo: "FUT-1", invoiceDate: tomorrow, bundles: [{ itemId: items[0]!.id, heatNo: "H-F", weightKg: 10 }], userId: user.id }),
  );

  console.log("\nGRN with receipt");
  const grn = await createGrn({
    poId: po.id,
    invoiceNo: "INV-77",
    invoiceDate: new Date("2026-10-20"),
    bundles: [{ itemId: items[0]!.id, heatNo: "H-1", weightKg: 400 }],
    userId: user.id,
    receipt: stored,
  });
  const row = await prisma.grn.findUniqueOrThrow({ where: { id: grn.grn.id } });
  check("GRN keeps the receipt reference and invoice date", row.receiptPath === stored!.receiptPath && !!row.invoiceDate);
  console.log("\nPer-line received quantity (SOP 4.1 step 2)");
  const b = (kg: number) => [{ itemId: items[0]!.id, heatNo: "H-2", weightKg: kg }];
  await throwsWith("a line quantity that differs from the bundle weights is refused", "does not match", () =>
    createGrn({ poId: po.id, invoiceNo: "L1", bundles: b(100), lineQtys: { [items[0]!.id]: 120 }, userId: user.id }),
  );
  await throwsWith("receiving without entering the line quantity is refused", "received quantity", () =>
    createGrn({ poId: po.id, invoiceNo: "L2", bundles: b(100), lineQtys: {}, userId: user.id }),
  );
  await throwsWith("a line quantity with no bundles is refused", "no bundles", () =>
    createGrn({ poId: po.id, invoiceNo: "L3", bundles: b(100), lineQtys: { [items[0]!.id]: 100, [items[1]!.id]: 50 }, userId: user.id }),
  );
  await throwsWith("receipt above PO balance + tolerance is blocked", "exceeds PO balance", () =>
    createGrn({ poId: po.id, invoiceNo: "L4", bundles: b(700), lineQtys: { [items[0]!.id]: 700 }, userId: user.id }),
  );
  const ok = await createGrn({ poId: po.id, invoiceNo: "L5", bundles: [{ itemId: items[0]!.id, heatNo: "H-3", weightKg: 60 }, { itemId: items[0]!.id, heatNo: "H-4", weightKg: 40 }], lineQtys: { [items[0]!.id]: 100 }, userId: user.id });
  check("matching line quantity saves; bundles start in Quality Hold", ok.bundles.length === 2 && ok.bundles.every((x) => x.status === "QUALITY_HOLD"));
  const ql = await prisma.location.findUniqueOrThrow({ where: { name: "Incoming/QC area" } });
  check("bundles are in the Incoming / QC area with inward date = GRN date", ok.bundles.every((x) => x.locationId === ql.id && x.inwardDate.getTime() === ok.grn.grnDate.getTime()));
  await throwsWith("item that is not on the PO is refused", "does not belong", () =>
    createGrn({ poId: po.id, invoiceNo: "X", bundles: [{ itemId: "no-such-item", heatNo: "H", weightKg: 1 }], userId: user.id }),
  );

  console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed.");
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
