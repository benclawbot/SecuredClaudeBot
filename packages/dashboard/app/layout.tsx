import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SocketProvider } from "@/lib/socket";
import { Sidebar } from "@/components/sidebar";

export const metadata: Metadata = {
  title: "SecureClaudebot",
  description: "Ultra-secure personal AI gateway",
  manifest: "/manifest.json",
  icons: {
    icon: "/logo.svg",
    apple: "/logo.svg",
  },
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
      <body className="bg-[#0a0a0a] text-white antialiased min-h-screen">
        <SocketProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 overflow-auto bg-[#0a0a0a]">{children}</main>
          </div>
        </SocketProvider>
      </body>
    </html>
  );
}
