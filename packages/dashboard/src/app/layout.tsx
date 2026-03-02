import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SocketProvider } from "@/lib/socket";
import { Sidebar } from "@/components/sidebar";

export const metadata: Metadata = {
  title: "SecureClaudebot — Mission Control",
  description: "Ultra-secure personal AI gateway dashboard",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-zinc-950 text-zinc-100 antialiased min-h-screen">
        <SocketProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 overflow-auto">{children}</main>
          </div>
        </SocketProvider>
      </body>
    </html>
  );
}
