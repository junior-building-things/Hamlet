import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans  = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono  = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const newsreader = Newsreader({ variable: "--font-newsreader", subsets: ["latin"], weight: ["400"], style: ["normal"] });

export const metadata: Metadata = {
  title: "Hamlet — PM Dashboard",
  description: "Product feature tracking dashboard powered by Meego",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Inline script to set theme before paint to avoid flash. Default to
  // light; toggle persists only within the session for now.
  const themeScript = `
    (function() {
      document.documentElement.setAttribute('data-theme', 'light');
    })();
  `;

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen">
        <div className="app-bg" aria-hidden />
        {children}
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
