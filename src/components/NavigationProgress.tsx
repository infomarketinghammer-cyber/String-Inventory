"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Immediate "working" feedback for the whole app: a thin progress bar at the top of the window (and a busy cursor)
 * from the moment a user clicks an in-app link or submits a form, until the next page or the save result appears.
 * Every save in this app ends in a redirect, so a change of address marks "done"; a 30 s safety limit clears it.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = () => {
    setBusy(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setBusy(false), 30_000);
  };

  // New address (page loaded or save redirected): done.
  useEffect(() => {
    setBusy(false);
    if (timer.current) clearTimeout(timer.current);
  }, [pathname, search]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      start();
    };
    const onSubmit = (e: SubmitEvent) => {
      // The browser only fires "submit" once its own checks (required fields etc.) pass.
      const form = e.target as HTMLFormElement | null;
      // A save through a server action: Next.js renders such forms with a hidden "$ACTION_ID_…" field (or, for
      // client-side forms, a "javascript:" action) and handles the submission itself.
      const serverAction =
        !!form?.querySelector('input[name^="$ACTION_ID_"]') || (form?.getAttribute("action") ?? "").startsWith("javascript:");
      setTimeout(() => {
        // Otherwise only a form the browser really submits (a screen that handles its own form is not a page load).
        if (serverAction || !e.defaultPrevented) start();
      }, 0);
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("app-busy", busy);
  }, [busy]);

  return busy ? (
    <div className="top-progress" role="progressbar" aria-label="Loading" aria-busy="true">
      <div className="top-progress-bar" />
    </div>
  ) : null;
}
