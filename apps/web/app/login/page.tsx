"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";

export default function Login() {
  const { login, loading, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("registered")) {
      setMessage("Registration successful. Sign in to continue.");
    }
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try { await login(email, password); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Sign-in failed."); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="splash"><p className="muted">Restoring session…</p></main>;

  return (
    <main className="main">
      <section className="card" style={{ maxWidth: 520, margin: "40px auto" }}>
        <Link href="/">Task Marketplace</Link>
        <h1>Sign in</h1>
        <p className="muted">Use your marketplace account to continue.</p>
        <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
          <label>Email<input aria-label="Email" required type="email" value={email} onChange={e => setEmail(e.target.value)} style={{ display: "block", width: "100%", marginTop: 6, padding: 12, border: "1px solid #e5e7eb", borderRadius: 8 }} /></label>
          <label>Password<input aria-label="Password" required minLength={8} type="password" value={password} onChange={e => setPassword(e.target.value)} style={{ display: "block", width: "100%", marginTop: 6, padding: 12, border: "1px solid #e5e7eb", borderRadius: 8 }} /></label>
          <button className="button" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
        {(message || error) && <p className="muted" role="alert">{message || error}</p>}
        <p className="muted">New here? <Link href="/register">Create an account</Link>.</p>
      </section>
    </main>
  );
}
