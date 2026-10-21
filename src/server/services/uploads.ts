/**
 * Local file storage for GRN receipts (supplier invoice / delivery challan scans).
 * Files go to UPLOAD_DIR (default ./uploads) under a random server-generated name; the client's
 * file name is only kept as a display label. Type and size are checked here, never trusted from the browser.
 */
import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { ValidationError } from "./errors";

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

const TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  "application/pdf": { ext: ".pdf", magic: (b) => b.subarray(0, 4).toString("latin1") === "%PDF" },
  "image/png": { ext: ".png", magic: (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
  "image/jpeg": { ext: ".jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  "image/webp": {
    ext: ".webp",
    magic: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  },
};

export type UploadKind = "grn-receipts" | "po-documents";

function uploadDir(kind: UploadKind): string {
  return path.resolve(process.env.UPLOAD_DIR || "uploads", kind);
}

export interface StoredDocument {
  path: string;
  name: string;
  mime: string;
}

/** Validates and stores an uploaded PDF/image; returns null when no file was chosen. */
export async function saveDocument(file: File | null | undefined, kind: UploadKind, what = "File"): Promise<StoredDocument | null> {
  if (!file || typeof file === "string" || file.size === 0) return null;
  if (file.size > MAX_RECEIPT_BYTES) {
    throw new ValidationError(`${what} is too large (${(file.size / 1048576).toFixed(1)} MB). Maximum is 5 MB.`);
  }
  const type = TYPES[file.type];
  if (!type) throw new ValidationError(`${what} must be a PDF, PNG, JPG or WEBP file.`);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!type.magic(bytes)) throw new ValidationError("The file content does not match its type; upload a real PDF or image.");

  await mkdir(uploadDir(kind), { recursive: true });
  const stored = `${randomUUID()}${type.ext}`;
  await writeFile(path.join(uploadDir(kind), stored), bytes);
  const label = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || `document${type.ext}`;
  return { path: stored, name: label, mime: file.type };
}

/** Reads a stored file. `stored` is only ever a name we generated, but guard against traversal anyway. */
export async function readDocument(stored: string, kind: UploadKind): Promise<Buffer> {
  if (stored !== path.basename(stored)) throw new ValidationError("Invalid file reference.");
  return readFile(path.join(uploadDir(kind), stored));
}

export interface StoredReceipt {
  receiptPath: string;
  receiptName: string;
  receiptMime: string;
}

/** GRN receipt (supplier invoice / challan scan). */
export async function saveReceipt(file: File | null | undefined): Promise<StoredReceipt | null> {
  const d = await saveDocument(file, "grn-receipts", "Receipt");
  return d && { receiptPath: d.path, receiptName: d.name, receiptMime: d.mime };
}

export const readReceipt = (stored: string) => readDocument(stored, "grn-receipts");