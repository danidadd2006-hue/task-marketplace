"use client";

import Link from "next/link";
import { useAuth } from "../../lib/auth";

const nav = [["/home","Home"],["/tasks","Task Feed"],["/post-task","Post Task"],["/applications","Applications"],["/messages","Messages"],["/notifications","Notifications"],["/profile","Profile"],["/settings","Settings"]];

export default function Page() {
  const { user, loading, logout } = useAuth();
  if (loading || !user) return <main className="splash"><p className="muted">Loading account…</p></main>;

  return (
    <main className="main">
      <header className="header">
        <Link className="brand" href="/home">Task Marketplace</Link>
        <nav className="nav" aria-label="Marketplace">
          {nav.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
          <button className="button secondary" onClick={() => void logout()}>Log out</button>
        </nav>
      </header>
      <section className="card" style={{ marginTop: 32 }}>
        <h1>Welcome back</h1>
        <p className="muted">{user.email}</p>
        <p className="muted">Authenticated session established. Permissions and business rules remain server-authoritative.</p>
      </section>
    </main>
  );
}
