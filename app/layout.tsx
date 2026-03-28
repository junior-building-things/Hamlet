import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Hamlet — PM Dashboard",
  description: "Product feature tracking dashboard powered by Meego",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} antialiased`} style={{ backgroundColor: '#0c0e1a' }}>
      <body className="min-h-screen" style={{ backgroundColor: '#0c0e1a' }}>
        {children}
      </body>
    </html>
  );
}
