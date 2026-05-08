import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Photos · admin",
  description: "Каталог фото запчастей",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#262625",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Inline init: pick theme from localStorage before paint to avoid flash.
const themeInit = `(function(){try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
