/**
 * AI OCR for purchase orders: reads a scanned / PDF PO with a Claude vision model and returns the
 * fields as a *proposal*. Nothing is saved here — the user reviews and edits every field in the
 * confirmation box and only then saves the PO through the normal createPo path (all validations apply).
 *
 * Config: ANTHROPIC_API_KEY (required to enable the feature), PO_OCR_MODEL (optional, default below).
 * The document is sent to the Anthropic API for reading.
 */
import { prisma } from "@/lib/prisma";
import { ValidationError } from "./errors";
import { NEW_SUPPLIER } from "./po";

const DEFAULT_MODEL = "claude-opus-5-5";

export function poOcrEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** What the model is asked to return. */
interface ExtractedPo {
  poNo: string | null;
  poDate: string | null;
  supplierName: string | null;
  supplierGstin: string | null;
  lines: { description: string | null; grade: string | null; diameterMm: number | null; quantityKg: number | null }[];
}

/** Proposal shown in the confirmation box: extracted values matched to this system's masters. */
export interface PoProposal {
  poNo: string;
  /** Date printed on the document (for information only: a new PO is always dated today). */
  documentDate: string | null;
  supplierId: string; // matched supplier id, NEW_SUPPLIER, or "" when nothing was found
  newSupplierName: string;
  newSupplierGstin: string;
  lines: { itemId: string; orderedKg: string; readAs: string }[];
  warnings: string[];
}

const PROMPT = `You are reading a purchase order (PO) for spring steel wire sent by a spring manufacturer to a wire supplier.
Extract the following and reply with ONLY a JSON object, no other text:
{
  "poNo": string | null,            // the PO number exactly as printed
  "poDate": "YYYY-MM-DD" | null,    // the PO date
  "supplierName": string | null,    // the supplier / vendor the PO is addressed to (not the buyer)
  "supplierGstin": string | null,   // supplier GSTIN if printed
  "lines": [                        // one entry per ordered material line
    { "description": string | null, "grade": string | null, "diameterMm": number | null, "quantityKg": number | null }
  ]
}
Rules: convert quantities to kilograms (1 MT = 1000 kg). diameterMm is the wire diameter in millimetres.
Use null for anything you cannot read with confidence. Do not invent values.`;

async function callModel(bytes: Buffer, mime: string): Promise<ExtractedPo> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new ValidationError("AI PO reading is not configured (ANTHROPIC_API_KEY is not set).");
  const source = { type: "base64", media_type: mime, data: bytes.toString("base64") };
  const fileBlock = mime === "application/pdf" ? { type: "document", source } : { type: "image", source };

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.PO_OCR_MODEL || DEFAULT_MODEL,
        max_tokens: 2000,
        messages: [{ role: "user", content: [fileBlock, { type: "text", text: PROMPT }] }],
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new ValidationError("Could not reach the AI service. Check the internet connection and try again, or enter the PO manually.");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("PO OCR failed", res.status, detail.slice(0, 500));
    throw new ValidationError(`The AI service could not read the document (HTTP ${res.status}). Enter the PO manually.`);
  }
  const body = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    const parsed = JSON.parse(json) as ExtractedPo;
    return { ...parsed, lines: Array.isArray(parsed.lines) ? parsed.lines : [] };
  } catch {
    throw new ValidationError("The AI reply could not be understood. Enter the PO manually.");
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Read a PO document and match what was found to suppliers and wire items. */
export async function readPoDocument(bytes: Buffer, mime: string): Promise<PoProposal> {
  const x = await callModel(bytes, mime);
  const warnings: string[] = [];

  // Supplier: exact/contained name match, then GSTIN; otherwise propose it as a new supplier.
  const suppliers = await prisma.supplier.findMany({ where: { active: true } });
  const name = x.supplierName?.trim() ?? "";
  const match =
    (x.supplierGstin && suppliers.find((s) => s.gstin && norm(s.gstin) === norm(x.supplierGstin!))) ||
    (name && suppliers.find((s) => norm(s.name) === norm(name))) ||
    (name && suppliers.find((s) => norm(name).includes(norm(s.name)) || norm(s.name).includes(norm(name))));
  let supplierId = "";
  if (match) supplierId = match.id;
  else if (name) {
    supplierId = NEW_SUPPLIER;
    warnings.push(`Supplier "${name}" is not registered; it will be added as a new supplier unless you pick an existing one.`);
  } else warnings.push("The supplier could not be read; select it.");

  // Lines: match grade + diameter to an active wire item.
  const items = await prisma.item.findMany({ where: { active: true } });
  const lines = x.lines.map((l, i) => {
    const readAs = [l.description, l.grade, l.diameterMm != null ? `${l.diameterMm} mm` : null, l.quantityKg != null ? `${l.quantityKg} kg` : null]
      .filter(Boolean)
      .join(" · ");
    const item = items.find(
      (it) =>
        l.diameterMm != null &&
        Math.abs(Number(it.diameterMm) - l.diameterMm) < 0.001 &&
        (!l.grade || norm(it.grade) === norm(l.grade) || norm(l.grade).includes(norm(it.grade))),
    );
    if (!item) warnings.push(`Line ${i + 1} (${readAs || "unreadable"}): no matching wire item; select it.`);
    if (l.quantityKg == null) warnings.push(`Line ${i + 1}: quantity could not be read; enter it.`);
    return { itemId: item?.id ?? "", orderedKg: l.quantityKg != null ? String(l.quantityKg) : "", readAs };
  });
  if (lines.length === 0) warnings.push("No material lines were found; add them manually.");
  if (!x.poNo) warnings.push("The PO number could not be read; enter it.");

  return {
    poNo: x.poNo?.trim() ?? "",
    documentDate: x.poDate,
    supplierId,
    newSupplierName: supplierId === NEW_SUPPLIER ? name : "",
    newSupplierGstin: supplierId === NEW_SUPPLIER ? (x.supplierGstin ?? "") : "",
    lines: lines.length ? lines : [{ itemId: "", orderedKg: "", readAs: "" }],
    warnings,
  };
}
