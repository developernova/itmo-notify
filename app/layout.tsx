import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
export const metadata: Metadata = {
  title: "Срок — дедлайны под контролем",
  description: "Твоё спокойное место для университетских дедлайнов.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon-192.png" },
  appleWebApp: { capable: true, title: "Срок", statusBarStyle: "default" },
};
export const viewport: Viewport = {
  themeColor: "#4565e8",
  width: "device-width",
  initialScale: 1,
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body><TooltipProvider>{children}</TooltipProvider></body>
    </html>
  );
}
