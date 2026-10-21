import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Spring Inventory",
  description: "Spring manufacturing factory inventory module",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
