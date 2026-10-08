import "./globals.css";
import type { ReactNode } from "react";
import { AdminAuthProvider } from "../lib/auth";
import { AdminGate } from "./admin-gate";

export const metadata = { title: "Task Marketplace Admin" };

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><AdminAuthProvider><AdminGate>{children}</AdminGate></AdminAuthProvider></body></html>;
}
