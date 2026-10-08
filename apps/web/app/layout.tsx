import "./globals.css";
import type { ReactNode } from "react";
import { AuthProvider } from "../lib/auth";

export const metadata = {
  title: "Task Marketplace",
  description: "An international task marketplace centred on tasks.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
