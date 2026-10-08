"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAdminAuth } from "../lib/auth";

export function AdminGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, loading, authorized } = useAdminAuth();
  if (pathname === "/login") return <>{children}</>;
  if (loading) return <main className="splash"><p className="muted">Loading administrator session…</p></main>;
  if (!user) return null;
  if (!authorized) return <main className="splash"><section className="card" style={{ width: "min(680px, calc(100% - 32px))" }}><h1>Administrator access unavailable</h1><p className="muted">The current API /auth/me response does not expose effective roles. Privileged sections remain unavailable rather than trusting client state.</p></section></main>;
  return <>{children}</>;
}
