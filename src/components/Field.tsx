/** Shared form-field styles: a visible label above every control. */
export const FIELD_LABEL = "block text-xs font-medium mb-1";
export const FIELD_INPUT = "w-full rounded border px-2 py-1.5 bg-transparent text-sm";

/**
 * Visible label above a form control. Placeholders alone are not enough: they disappear once a field
 * has a value (e.g. a default 0), leaving the user guessing what the box is.
 * With `id` the label points at the control (htmlFor); without it the label wraps the control.
 */
export function Field({
  id,
  label,
  className,
  children,
}: {
  id?: string;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  if (!id) {
    return (
      <label className={`block ${className ?? ""}`}>
        <span className={FIELD_LABEL}>{label}</span>
        {children}
      </label>
    );
  }
  return (
    <div className={className}>
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
      </label>
      {children}
    </div>
  );
}
