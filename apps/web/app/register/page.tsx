"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useAuth } from "../../lib/auth";

export default function Register() {
  const { register, loading, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await register(email, password);
    } catch {
      // The provider exposes the server error through its auth state.
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="splash"><p className="muted">Loading…</p></main>;

  return (
    <main className="main">
      <section className="card" style={{ maxWidth: 520, margin: "40px auto" }}>
        <Link href="/">Task Marketplace</Link>
        <h1>Create your account</h1>
        <p className="muted">One account can later operate across marketplace roles.</p>
        <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
          <label>Email
            <input aria-label="Email" required type="email" value={email} onChange={e => setEmail(e.target.value)} style={{ display: "block", width: "100%", marginTop: 6, padding: 12, border: "1px solid #e5e7eb", borderRadius: 8 }} />
          </label>
          <label>Password
            <input aria-label="Password" required minLength={8} type="password" value={password} onChange={e => setPassword(e.target.value)} style={{ display: "block", width: "100%", marginTop: 6, padding: 12, border: "1px solid #e5e7eb", borderRadius: 8 }} />
          </label>
          <button className="button" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
        </form>
        {error && <p className="muted" role="alert">{error}</p>}
        <p className="muted">Already registered? <Link href="/login">Sign in</Link>.</p>
      </section>
    </main>
  );
}
