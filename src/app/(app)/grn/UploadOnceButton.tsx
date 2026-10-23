"use client";

import { useRef, useState } from "react";
import { UPLOAD_ACCEPT } from "@/lib/uploads";

/**
 * A single "Upload" button: it opens the file picker and uploads as soon as a file is chosen.
 * Used where a document is uploaded once and can only be viewed afterwards (the server refuses a second upload).
 */
export function UploadOnceButton({
  action,
  hidden,
  fileField,
  label = "Upload",
  ariaLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  hidden: Record<string, string>;
  fileField: string;
  label?: string;
  ariaLabel: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form ref={formRef} action={action} onSubmit={() => setBusy(true)}>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input
        ref={inputRef}
        name={fileField}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label={ariaLabel}
        onChange={(e) => {
          if (e.target.files?.length) {
            setBusy(true);
            formRef.current?.requestSubmit();
          }
        }}
      />
      <button
        type="button"
        disabled={busy}
        className="btn-secondary px-3 py-1 text-xs font-medium whitespace-nowrap disabled:opacity-60"
        onClick={() => inputRef.current?.click()}
        title="PDF, JPG, JPEG or PNG, up to 5 MB"
      >
        {busy ? "Uploading…" : label}
      </button>
    </form>
  );
}
