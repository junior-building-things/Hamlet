import type { Metadata } from "next";
import { Geist, Newsreader } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans  = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const newsreader = Newsreader({ variable: "--font-newsreader", subsets: ["latin"], weight: ["400"], style: ["normal"] });

export const metadata: Metadata = {
  title: "Hamlet — PM Dashboard",
  description: "Product feature tracking dashboard powered by Meego",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Inline script to set theme before paint to avoid flash.
  const themeScript = `
    (function() {
      var t = localStorage.getItem('hamlet_theme') || 'dark';
      document.documentElement.setAttribute('data-theme', t);
    })();
  `;

  return (
    <html lang="en" className={`${geistSans.variable} ${newsreader.variable} antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen" style={{ backgroundImage: 'radial-gradient(circle, var(--dot-color) 1px, transparent 1px)', backgroundSize: '24px 24px', backgroundAttachment: 'fixed' }}>
        {children}
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
