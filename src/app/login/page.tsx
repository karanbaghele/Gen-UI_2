"use client";
import { useState } from "react";
import { Brand } from "@/components/shell";
import { ErrorNote } from "@/components/ui";
export default function LoginPage() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const signIn = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/google", { redirect: "manual" });
      if (
        response.type === "opaqueredirect" ||
        (response.status >= 300 && response.status < 400)
      ) {
        window.location.assign(
          new URL("/api/auth/google", window.location.origin).href,
        );
        return;
      }
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.error?.message ??
            data.error ??
            "Google sign-in is not configured yet.",
        );
      if (data.url) window.location.assign(data.url);
      else
        window.location.assign(
          new URL("/api/auth/google", window.location.origin).href,
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign in.");
      setBusy(false);
    }
  };
  return (
    <div className="login-page">
      <div className="login-card">
        <Brand />
        <h1>
          Turn your data
          <br />
          into a dashboard.
        </h1>
        <p>
          Less time building reports.
          <br />
          More room for understanding.
        </p>
        <button
          className="button google-button"
          onClick={() => void signIn()}
          disabled={busy}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M21.8 12.2c0-.7-.1-1.5-.2-2.2H12v4.2h5.5a4.7 4.7 0 0 1-2 3.1v2.6h3.3c1.9-1.8 3-4.4 3-7.7ZM12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.6c-.9.6-2 .9-3.4.9-2.6 0-4.8-1.8-5.6-4.1H3v2.7A10 10 0 0 0 12 22ZM6.4 13.8A6 6 0 0 1 6.1 12c0-.6.1-1.2.3-1.8V7.5H3A10 10 0 0 0 3 16.5l3.4-2.7ZM12 6.1c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.5 9.5 0 0 0 12 2a10 10 0 0 0-9 5.5l3.4 2.7C7.2 7.9 9.4 6.1 12 6.1Z"
            />
          </svg>
          {busy ? "Connecting…" : "Continue with Google"}
        </button>
        <ErrorNote message={error} />
        <p className="login-footnote">
          A quiet workspace for your data.
          <br />
          Secure sign-in with Google.
        </p>
      </div>
    </div>
  );
}
