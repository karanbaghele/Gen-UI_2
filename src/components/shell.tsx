"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  Home,
  LayoutDashboard,
  Database,
  ChevronsUpDown,
  Settings,
  LogOut,
  Menu as MenuIcon,
  PanelLeftClose,
  Moon,
  Sun,
  Monitor,
  Circle,
  LockKeyhole,
} from "lucide-react";
import { api, ApiError, post } from "@/lib/client";
import { Menu, MenuItem, MenuSeparator, Modal, Loading, ErrorNote } from "./ui";
export type Session = {
  user: { id: string; name: string; email: string; avatarUrl?: string } | null;
  workspace: { id: string; name: string; role: string } | null;
  config: {
    supabase: boolean;
    database: boolean;
    google: boolean;
    sheets: boolean;
    ollama: boolean;
    gemini: boolean;
    devAuth: boolean;
  };
};
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      GenUI
      <span
        style={{
          fontSize: 10,
          letterSpacing: 0,
          fontWeight: 400,
          alignSelf: "flex-start",
          marginTop: 6,
          color: "var(--secondary)",
        }}
      >
        BETA
      </span>
    </span>
  );
}
export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const cache = useQueryClient();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api<Session>("/api/session"),
    retry: false,
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [settingsStatus, setSettingsStatus] = useState<
    "idle" | "saving" | "saved"
  >("idle");
  const [settingsError, setSettingsError] = useState("");
  const theme = useSyncExternalStore(
    (onChange) => {
      addEventListener("storage", onChange);
      addEventListener("genui-appearance", onChange);
      return () => {
        removeEventListener("storage", onChange);
        removeEventListener("genui-appearance", onChange);
      };
    },
    () => localStorage.getItem("genui-appearance") ?? "light",
    () => "light",
  );
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    if (
      (session.error instanceof ApiError && session.error.status === 401) ||
      (session.data && !session.data.user)
    )
      router.replace("/login");
  }, [session.error, session.data, router]);
  const chooseTheme = (value: string) => {
    localStorage.setItem("genui-appearance", value);
    dispatchEvent(new Event("genui-appearance"));
  };
  const signOut = async () => {
    await post("/api/auth/logout", {});
    cache.clear();
    router.replace("/login");
  };
  const saveWorkspace = async () => {
    const nextName = workspaceName.trim();
    if (!nextName || !session.data?.workspace) return;
    setSettingsStatus("saving");
    setSettingsError("");
    try {
      await api<{ saved: true }>("/api/session", {
        method: "PATCH",
        body: JSON.stringify({ workspaceName: nextName }),
      });
      cache.setQueryData<Session>(["session"], (current) =>
        current?.workspace
          ? {
              ...current,
              workspace: { ...current.workspace, name: nextName },
            }
          : current,
      );
      setSettingsStatus("saved");
    } catch (error) {
      setSettingsStatus("idle");
      setSettingsError(
        error instanceof Error ? error.message : "The workspace was not saved.",
      );
    }
  };
  if (session.isPending || (session.data && !session.data.user))
    return <Loading />;
  if (
    session.error ||
    !session.data ||
    !session.data.user ||
    !session.data.workspace
  )
    return (
      <div className="login-page">
        <div className="login-card">
          <Brand />
          <ErrorNote message={session.error?.message} />
          <button className="button" onClick={() => session.refetch()}>
            Try again
          </button>
          <Link className="button quiet" href="/login">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  const { user, workspace, config } = session.data;
  const section = path.startsWith("/data")
    ? "Data"
    : path.startsWith("/dashboards")
      ? "Dashboards"
      : "Home";
  return (
    <div className="app-shell">
      <a className="sr-only" href="#main">
        Skip to content
      </a>
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <Link href="/">
          <Brand />
        </Link>
        <div className="workspace-label">
          <Circle size={6} fill="currentColor" />
          {workspace.name || "Personal workspace"}
        </div>
        <nav aria-label="Main navigation">
          {[
            { label: "Home", href: "/", icon: Home },
            { label: "Dashboards", href: "/dashboards", icon: LayoutDashboard },
            { label: "Data", href: "/data", icon: Database },
          ].map((item) => (
            <Link
              key={item.label}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`nav-link ${section === item.label ? "active" : ""}`}
              aria-current={section === item.label ? "page" : undefined}
            >
              <item.icon size={17} strokeWidth={1.6} />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          {config.devAuth && (
            <span className="badge" style={{ margin: "0 10px 12px" }}>
              Local test session
            </span>
          )}
          <Menu
            align="start"
            trigger={
              <button className="profile-button">
                <span className="avatar">
                  {user.name
                    ?.split(" ")
                    .map((s) => s[0])
                    .slice(0, 2)
                    .join("") || "U"}
                </span>
                <span className="spacer">
                  <span className="profile-name">{user.name}</span>
                  <br />
                  <span className="profile-meta">Personal workspace</span>
                </span>
                <ChevronsUpDown size={14} />
              </button>
            }
          >
            <div style={{ padding: "9px 11px", maxWidth: 240 }}>
              <strong style={{ fontSize: 12 }}>{user.name}</strong>
              <p style={{ fontSize: 11, overflowWrap: "anywhere" }}>
                {user.email}
              </p>
            </div>
            <MenuSeparator />
            <MenuItem
              onSelect={() => {
                setWorkspaceName(workspace.name);
                setSettingsStatus("idle");
                setSettingsError("");
                setSettings(true);
              }}
            >
              <Settings size={14} />
              Settings
            </MenuItem>
            <MenuItem
              onSelect={() => chooseTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}Switch
              to {theme === "dark" ? "light" : "dark"} theme
            </MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => void signOut()}>
              <LogOut size={14} />
              Sign out
            </MenuItem>
          </Menu>
        </div>
      </aside>
      {mobileOpen && (
        <button
          aria-label="Close navigation"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 25,
            background: "#0005",
            border: 0,
          }}
          onClick={() => setMobileOpen(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <PanelLeftClose size={19} /> : <MenuIcon size={19} />}
          </button>
          <span>{workspace.name}</span>
          <span style={{ opacity: 0.4 }}>/</span>
          <span style={{ color: "var(--text)" }}>{section}</span>
          <span className="spacer" />
          <span className="row local-label" style={{ gap: 6 }}>
            <LockKeyhole size={12} />
            Local workspace
          </span>
        </header>
        <main id="main">{children}</main>
      </div>
      <Modal
        title="Settings"
        description="Your workspace, your way."
        open={settings}
        onOpenChange={setSettings}
      >
        <div className="stack">
          <div className="row">
            <span className="avatar">{user.name?.[0]}</span>
            <div>
              <h3>{user.name}</h3>
              <small>{user.email}</small>
            </div>
          </div>
          <div className="divider" />
          <label>
            Workspace name
            <div className="row">
              <input
                className="spacer"
                value={workspaceName}
                maxLength={120}
                disabled={!config.database || settingsStatus === "saving"}
                onChange={(event) => {
                  setWorkspaceName(event.target.value);
                  setSettingsStatus("idle");
                }}
              />
              <button
                className="button"
                disabled={
                  !config.database ||
                  settingsStatus === "saving" ||
                  !workspaceName.trim() ||
                  workspaceName.trim() === workspace.name
                }
                onClick={() => void saveWorkspace()}
              >
                {settingsStatus === "saving"
                  ? "Saving…"
                  : settingsStatus === "saved"
                    ? "Saved"
                    : "Save"}
              </button>
            </div>
            {!config.database && (
              <small>Connect the local database to rename this workspace.</small>
            )}
          </label>
          {settingsError && <ErrorNote message={settingsError} />}
          <div className="divider" />
          <label>Appearance</label>
          <div className="theme-options">
            {[
              { id: "light", icon: Sun },
              { id: "dark", icon: Moon },
              { id: "system", icon: Monitor },
            ].map((item) => (
              <button
                key={item.id}
                className={`button ${theme === item.id ? "selected" : ""}`}
                onClick={() => chooseTheme(item.id)}
              >
                <item.icon size={15} />
                {item.id[0].toUpperCase() + item.id.slice(1)}
              </button>
            ))}
          </div>
          <div className="divider" />
          <h3>Configuration</h3>
          <div className="status-grid">
            {[
              ["Local database", config.database],
              ["Google sign-in", config.google],
              ["Google Sheets", config.sheets],
              ["Local Ollama", config.ollama],
              ["Gemini", config.gemini],
            ].map(([label, value]) => (
              <div className="status-cell" key={String(label)}>
                <small>{label}</small>
                {value ? "Configured" : "Setup needed"}
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11 }}>
            Data and dashboards stay in your local workspace. Google sign-in and
            Sheets use Google services. A configured hosted AI provider receives
            only the context selected for your request.
          </p>
        </div>
      </Modal>
    </div>
  );
}
