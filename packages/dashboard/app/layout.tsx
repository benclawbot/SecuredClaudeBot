import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SocketProvider } from "@/lib/socket";
import { AuthProvider } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { AuthModal } from "@/components/auth-modal";

export const metadata: Metadata = {
  title: "FastBot",
  description: "Ultra-secure personal AI gateway",
  manifest: "/manifest.json",
  icons: {
    icon: "/logo.jpg",
    apple: "/logo.jpg",
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
          <AuthProvider>
            <div className="flex min-h-screen">
              <Sidebar />
              <main className="flex-1 overflow-auto bg-[#0a0a0a]">{children}</main>
            </div>
            <AuthModal />
          </AuthProvider>
        </SocketProvider>
      </body>
    </html>
  );
}
