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
  return (
    <html lang="en" className={`${geistSans.variable} ${newsreader.variable} antialiased`} style={{ backgroundColor: '#0c0e1a' }}>
      <body className="min-h-screen" style={{ backgroundColor: '#0c0e1a', backgroundImage: 'radial-gradient(circle, #ffffff18 1px, transparent 1px)', backgroundSize: '24px 24px', backgroundAttachment: 'fixed' }}>
        {children}
        <Toaster position="bottom-right" theme="dark" richColors />
      </body>
    </html>
  );
}
