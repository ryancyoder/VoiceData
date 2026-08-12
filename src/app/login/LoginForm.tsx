"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

export function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Sign in failed");
      }
      // Full navigation (not router.push) so the request carries the new cookie
      // and the middleware re-evaluates it.
      const dest = next.startsWith("/") ? next : "/";
      window.location.assign(dest);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{
        width: "100%",
        maxWidth: 360,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: 28,
        border: "1px solid #e4e4e7",
        borderRadius: 16,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      <div>
        <h1 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>Ricci&apos;s Landscape Management</h1>
        <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "#71717a" }}>Enter the shared password to continue.</p>
      </div>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        autoFocus
        autoComplete="current-password"
        style={{ padding: "10px 12px", border: "1px solid #d4d4d8", borderRadius: 10, fontSize: "1rem" }}
      />
      {error && <div style={{ color: "#dc2626", fontSize: "0.85rem" }}>{error}</div>}
      <button
        type="submit"
        disabled={submitting || !password}
        style={{
          padding: "10px 12px",
          borderRadius: 10,
          border: "none",
          background: submitting || !password ? "#a1a1aa" : "#15803d",
          color: "white",
          fontWeight: 600,
          fontSize: "1rem",
          cursor: submitting || !password ? "default" : "pointer",
        }}
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
