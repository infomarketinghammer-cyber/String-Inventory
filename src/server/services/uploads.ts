/**
 * Local file storage for GRN receipts (supplier invoice / delivery challan scans).
 * Files go to UPLOAD_DIR (default ./uploads) under a random server-generated name; the client's
 * file name is only kept as a display label. Type and size are checked here, never trusted from the browser.
 */
import { randomUUID } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { ValidationError } from "./errors";

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

// Allowed: PDF, JPG / JPEG and PNG only.
const TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  "application/pdf": { ext: ".pdf", magic: (b) => b.subarray(0, 4).toString("latin1") === "%PDF" },
  "image/png": { ext: ".png", magic: (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
  "image/jpeg": { ext: ".jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
};
// Some browsers / operating systems label JPEGs differently, or send no type at all: fall back to the extension.
const TYPE_ALIASES: Record<string, string> = { "image/jpg": "image/jpeg", "image/pjpeg": "image/jpeg", "image/x-png": "image/png" };
const EXT_TYPES: Record<string, string> = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };

function mimeOf(file: File): string | null {
  const declared = TYPE_ALIASES[file.type] ?? file.type;
  if (TYPES[declared]) return declared;
  if (!file.type || file.type === "application/octet-stream") return EXT_TYPES[path.extname(file.name).toLowerCase()] ?? null;
  return null;
}

export type UploadKind = "grn-receipts" | "po-documents";

function uploadDir(kind: UploadKind): string {
  return path.resolve(process.env.UPLOAD_DIR || "uploads", kind);
}

export interface StoredDocument {
  path: string;
  name: string;
  mime: string;
}

/** Checks size, declared type and the file's real content (magic bytes). Never trusts the browser. */
export async function validateDocument(file: File, what = "File"): Promise<{ bytes: Buffer; mime: string; ext: string }> {
  if (file.size > MAX_RECEIPT_BYTES) {
    throw new ValidationError(`${what} is too large (${(file.size / 1048576).toFixed(1)} MB). Maximum is 5 MB.`);
  }
  const mime = mimeOf(file);
  const type = mime ? TYPES[mime] : undefined;
  if (!mime || !type) throw new ValidationError(`${what} must be a PDF, JPG, JPEG or PNG file.`);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!type.magic(bytes)) throw new ValidationError("The file content does not match its type; upload a real PDF, JPG or PNG.");
  return { bytes, mime, ext: type.ext };
}

/** Validates and stores an uploaded PDF/image; returns null when no file was chosen. */
export async function saveDocument(file: File | null | undefined, kind: UploadKind, what = "File"): Promise<StoredDocument | null> {
  if (!file || typeof file === "string" || file.size === 0) return null;
  const { bytes, ext, mime } = await validateDocument(file, what);

  await mkdir(uploadDir(kind), { recursive: true });
  const stored = `${randomUUID()}${ext}`;
  await writeFile(path.join(uploadDir(kind), stored), bytes);
  const label = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || `document${ext}`;
  return { path: stored, name: label, mime };
}

/** Deletes a file this module stored (used when a save is refused after the file was written). */
export async function removeDocument(stored: string, kind: UploadKind): Promise<void> {
  if (stored !== path.basename(stored)) return;
  await unlink(path.join(uploadDir(kind), stored)).catch(() => undefined);
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