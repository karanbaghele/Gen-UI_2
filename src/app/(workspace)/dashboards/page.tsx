"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Plus,
  Search,
  MoreHorizontal,
  Pin,
  Copy,
  Trash2,
  Pencil,
  History,
} from "lucide-react";
import { api, post, relativeTime } from "@/lib/client";
import {
  EmptyState,
  ErrorNote,
  Loading,
  Menu,
  MenuItem,
  Modal,
} from "@/components/ui";
import type { DashboardSpec } from "@/lib/domain/schema";
export type DashboardRecord = {
  id: string;
  title?: string;
  spec: DashboardSpec;
  version: number;
  pinned: boolean;
  updatedAt: string;
  createdAt: string;
  generationId?: string;
};
export default function DashboardsPage() {
  const router = useRouter();
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["dashboards"],
    queryFn: () => api<{ dashboards: DashboardRecord[] }>("/api/dashboards"),
  });
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("updated");
  const [error, setError] = useState("");
  const [renaming, setRenaming] = useState<DashboardRecord | null>(null);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<DashboardRecord | null>(null);
  const refresh = () => cache.invalidateQueries({ queryKey: ["dashboards"] });
  const action = async (record: DashboardRecord, kind: string) => {
    setError("");
    try {
      if (kind === "duplicate")
        await post(`/api/dashboards/${record.id}/duplicate`, {});
      else if (kind === "pin")
        await api(`/api/dashboards/${record.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            pinned: !record.pinned,
            expectedVersion: record.version,
          }),
        });
      else if (kind === "delete") {
        await api(`/api/dashboards/${record.id}`, { method: "DELETE" });
        setDeleting(null);
      } else if (kind === "rename") {
        await api(`/api/dashboards/${record.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            spec: { ...record.spec, title: name.trim() },
            expectedVersion: record.version,
          }),
        });
        setRenaming(null);
      }
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update dashboard");
    }
  };
  const records = [...(query.data?.dashboards ?? [])]
    .filter((item) =>
      (item.title ?? item.spec.title)
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (sort === "name"
          ? (a.title ?? a.spec.title).localeCompare(b.title ?? b.spec.title)
          : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    );
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>A clearer picture.</h1>
          <p>Your questions, shaped into dashboards.</p>
        </div>
        <Link className="button primary" href="/app">
          <Plus size={16} />
          New dashboard
        </Link>
      </div>
      <div className="toolbar">
        <div className="search-input">
          <Search size={15} />
          <input
            aria-label="Search dashboards"
            placeholder="Find a dashboard…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="spacer" />
        <select
          aria-label="Sort dashboards"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="updated">Recently updated</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>
      <ErrorNote message={error || query.error?.message} />
      {query.isPending ? (
        <Loading label="Loading dashboards…" />
      ) : records.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<LayoutDashboard size={24} />}
            title={
              search
                ? "No matching dashboards"
                : "Your next insight starts here."
            }
            description={
              search
                ? "Try a different name."
                : "Choose your data and ask a question. Your dashboards will be saved here."
            }
          >
            {!search && (
              <Link className="button primary" href="/app">
                Create a dashboard
              </Link>
            )}
          </EmptyState>
        </div>
      ) : (
        <div className="library-grid">
          {records.map((record) => (
            <article className="card library-card" key={record.id}>
              <Link
                href={`/dashboards/${record.id}`}
                aria-label={`Open ${record.title ?? record.spec.title}`}
              >
                <div className="library-preview" aria-hidden="true">
                  <div className="preview-kpis">
                    {record.spec.widgets
                      .filter((w) => w.type === "kpi")
                      .slice(0, 4)
                      .map((w) => (
                        <i key={w.id} />
                      ))}
                  </div>
                  <div className="preview-chart">
                    {[35, 60, 48, 80, 68, 92, 73, 100].map((height, i) => (
                      <i key={i} style={{ height: `${height}%` }} />
                    ))}
                  </div>
                </div>
              </Link>
              <div className="library-info">
                <div className="row">
                  <Link className="spacer" href={`/dashboards/${record.id}`}>
                    <h3>{record.title ?? record.spec.title}</h3>
                  </Link>
                  {record.pinned && (
                    <Pin size={13} style={{ color: "var(--gold)" }} />
                  )}
                  <Menu
                    trigger={
                      <button
                        className="icon-button"
                        aria-label={`Actions for ${record.title ?? record.spec.title}`}
                      >
                        <MoreHorizontal size={17} />
                      </button>
                    }
                  >
                    <MenuItem onSelect={() => void action(record, "pin")}>
                      <Pin size={14} />
                      {record.pinned ? "Unpin" : "Pin dashboard"}
                    </MenuItem>
                    <MenuItem
                      onSelect={() => {
                        setRenaming(record);
                        setName(record.title ?? record.spec.title);
                      }}
                    >
                      <Pencil size={14} />
                      Rename
                    </MenuItem>
                    <MenuItem onSelect={() => void action(record, "duplicate")}>
                      <Copy size={14} />
                      Duplicate
                    </MenuItem>
                    <MenuItem
                      onSelect={() => {
                        router.push(`/dashboards/${record.id}?versions=1`);
                      }}
                    >
                      <History size={14} />
                      Version history
                    </MenuItem>
                    <MenuItem danger onSelect={() => setDeleting(record)}>
                      <Trash2 size={14} />
                      Delete
                    </MenuItem>
                  </Menu>
                </div>
                <p>
                  {record.spec.widgets.length} widgets · Updated{" "}
                  {relativeTime(record.updatedAt)}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
      <Modal
        title="Rename dashboard"
        open={!!renaming}
        onOpenChange={(v) => {
          if (!v) setRenaming(null);
        }}
      >
        <div className="stack">
          <label>
            Dashboard name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
            />
          </label>
          <button
            className="button primary"
            disabled={!name.trim()}
            onClick={() => renaming && void action(renaming, "rename")}
          >
            Save name
          </button>
        </div>
      </Modal>
      <Modal
        title="Delete dashboard?"
        description={`“${deleting?.title ?? deleting?.spec.title}” and its saved versions will be deleted.`}
        open={!!deleting}
        onOpenChange={(v) => {
          if (!v) setDeleting(null);
        }}
      >
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="button" onClick={() => setDeleting(null)}>
            Cancel
          </button>
          <button
            className="button danger"
            onClick={() => deleting && void action(deleting, "delete")}
          >
            Delete dashboard
          </button>
        </div>
      </Modal>
    </div>
  );
}
