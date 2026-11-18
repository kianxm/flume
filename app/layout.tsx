import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { STATE_STORAGE_KEY } from "@/lib/storage";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Absolute base for the social-share image URLs.
  metadataBase: new URL("https://flumechart.vercel.app"),
  title: "Flume — see where your money flows",
  description:
    "Turn your income and spending into a clean Sankey chart. Your AI agent prepares the data, Flume draws it. Nothing leaves your browser.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the page paint under the notch and home indicator; the layout pads
  // itself with env(safe-area-inset-*).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f2" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0d0c" },
  ],
};

// Runs before first paint so the page never flashes the wrong theme.
const themeScript = `(function(){try{var t=localStorage.getItem("flume-theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}})()`;

// Also before first paint: when a chart is saved in this browser, flag it so
// CSS can hold back the landing content until the chart replaces it.
const restoreScript = `(function(){try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(STATE_STORAGE_KEY)})||"null");if(s&&typeof s.text==="string"&&s.text.trim())document.documentElement.dataset.flumeRestore=""}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: restoreScript }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
