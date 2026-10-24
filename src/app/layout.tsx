import "./globals.css";
import type { Metadata } from "next";
import { Suspense } from "react";
import { NavigationProgress } from "@/components/NavigationProgress";

export const metadata: Metadata = {
  title: "Spring Inventory",
  description: "Spring manufacturing factory inventory module",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {/* Top progress bar while a page or a save is in progress (reads the URL, hence Suspense). */}
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
