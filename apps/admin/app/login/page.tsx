"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useAdminAuth } from "../../lib/auth";

export default function Login() {
  const { login, loading, error } = useAdminAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try { await login(email, password); }
    catch { /* provider exposes the precise authorization error */ }
    finally { setBusy(false); }
  }

  if (loading) return <main className="splash"><p className="muted">Restoring administrator session…</p></main>;

  return <main className="splash"><section className="card" style={{ width: "min(520px, calc(100% - 32px))" }}>
    <Link className="brand" href="/">Task Marketplace Admin</Link>
    <h1>Administrator sign in</h1>
    <p className="muted">Privileged access is verified by the API. The client cannot assign or manufacture administrator privileges.</p>
    <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
      <label>Email<input aria-label="Email" required type="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>Password<input aria-label="Password" required minLength={8} type="password" value={password} onChange={e => setPassword(e.target.value)} /></label>
      <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
    {error && <p className="muted" role="alert">{error}</p>}
  </section></main>;
}
