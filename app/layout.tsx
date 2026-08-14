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
  icons: { icon: "/hamlet-icon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Inline script to set the theme before paint, so there is no flash.
  // Reads the same 'hamlet_theme' key the ThemeToggle writes ('system' |
  // 'light' | 'dark'); unset means follow the OS.
  const themeScript = `
    (function() {
      try {
        var mode = localStorage.getItem('hamlet_theme') || 'system';
        var dark = mode === 'dark' ||
          (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      } catch (e) {
        document.documentElement.setAttribute('data-theme', 'light');
      }
    })();
  `;

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="h-screen overflow-hidden">
        <div className="app-bg" aria-hidden />
        {children}
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
