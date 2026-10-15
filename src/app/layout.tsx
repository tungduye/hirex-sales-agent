import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Intalent Viet Nam",
  icons: { icon: "/brand/intalent-mark.png" },
  description: "A focused workspace for modern sales teams.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 text-slate-950">
        {children}
      </body>
    </html>
  );
}
