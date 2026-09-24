"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Database,
  Plus,
  FileSpreadsheet,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  ArrowUpRight,
  BookOpen,
  Table2,
} from "lucide-react";
import { api, post, relativeTime } from "@/lib/client";
import type { Dataset } from "@/lib/domain/schema";
import { AddData } from "@/components/add-data";
import {
  EmptyState,
  ErrorNote,
  Loading,
  Menu,
  MenuItem,
  Modal,
} from "@/components/ui";
type DatasetSummary = Dataset & {
  lastSyncedAt?: string | null;
  sourceStatus?: string;
  sourceError?: string | null;
  refreshIntervalSeconds?: number;
};
function freshness(dataset: DatasetSummary) {
  if (["csv", "sample"].includes(dataset.sourceType)) return "Snapshot";
  if (dataset.sourceStatus === "syncing") return "Refreshing";
  if (dataset.sourceStatus === "error") return "Needs attention";
  if (dataset.sourceStatus === "disconnected") return "Disconnected";
  const seconds = dataset.refreshIntervalSeconds ?? 60;
  return seconds < 60
    ? `Refreshes every ${seconds}s`
    : `Refreshes every ${Math.round(seconds / 60)}m`;
}
export default function DataPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sheetsConnection = searchParams.get("sheets") ?? "";
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["datasets"],
    queryFn: () => api<{ datasets: DatasetSummary[] }>("/api/datasets"),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
  const [adding, setAdding] = useState(Boolean(sheetsConnection));
  const [selected, setSelected] = useState<DatasetSummary | null>(null);
  const [error, setError] = useState("");
  const [definition, setDefinition] = useState("");
  const [definitionTitle, setDefinitionTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState("");
  const [deleting, setDeleting] = useState<DatasetSummary | null>(null);
  const detail = useQuery({
    queryKey: ["dataset", selected?.id],
    queryFn: () =>
      api<{
        dataset: Dataset;
        definitions?: { id: string; title: string; content: string }[];
        indexingStatus?: string;
      }>(`/api/datasets/${selected?.id}`),
    enabled: !!selected,
  });
  const current = detail.data?.dataset ?? selected;
  const refresh = async (dataset: DatasetSummary) => {
    setError("");
    setNotice("");
    setRefreshing(dataset.id);
    try {
      await post(`/api/datasets/${dataset.id}/refresh`, {});
      await cache.invalidateQueries({ queryKey: ["datasets"] });
      setNotice(`${dataset.name} is up to date.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing("");
    }
  };
  const remove = async () => {
    if (!deleting) return;
    try {
      await api(`/api/datasets/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      cache.invalidateQueries({ queryKey: ["datasets"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete dataset");
    }
  };
  const addDefinition = async () => {
    if (!current || !definition.trim() || !definitionTitle.trim()) return;
    setBusy(true);
    setNotice("");
    try {
      await post(`/api/datasets/${current.id}/definitions`, {
        title: definitionTitle.trim(),
        content: definition.trim(),
      });
      setDefinition("");
      setDefinitionTitle("");
      setNotice("Definition saved. It will be indexed for future requests.");
      cache.invalidateQueries({ queryKey: ["dataset", current.id] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save definition");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>Your data, connected.</h1>
          <p>A home for the data behind every answer.</p>
        </div>
        <button className="button primary" onClick={() => setAdding(true)}>
          <Plus size={16} />
          Add data
        </button>
      </div>
      <ErrorNote message={error} />
      {notice && !selected && (
        <p
          role="status"
          style={{ fontSize: 12, color: "var(--primary)", marginBottom: 16 }}
        >
          {notice}
        </p>
      )}
      {query.isPending ? (
        <Loading label="Loading your datasets…" />
      ) : query.error ? (
        <ErrorNote message={query.error.message} />
      ) : !query.data?.datasets.length ? (
        <div className="card">
          <EmptyState
            icon={<Database size={23} />}
            title="Every insight starts somewhere."
            description="Upload a CSV, connect a source, or get a feel for GenUI with sample sales data."
          >
            <button className="button primary" onClick={() => setAdding(true)}>
              <Plus size={15} />
              Add your first dataset
            </button>
          </EmptyState>
        </div>
      ) : (
        <div className="card data-list">
          <div className="data-list-head">
            <span>Dataset</span>
            <span>Rows & columns</span>
            <span>Freshness</span>
            <span>Updated</span>
            <span />
          </div>
          {query.data.datasets.map((dataset) => (
            <div className="data-row" key={dataset.id}>
              <button
                className="row"
                style={{
                  textAlign: "left",
                  background: "none",
                  border: 0,
                  padding: 0,
                }}
                onClick={() => {
                  setSelected(dataset);
                  setNotice("");
                }}
              >
                <span className="source-symbol">
                  {dataset.sourceType === "postgresql" ? (
                    <Database size={18} />
                  ) : dataset.sourceType === "sample" ? (
                    <Table2 size={18} />
                  ) : (
                    <FileSpreadsheet size={18} />
                  )}
                </span>
                <span>
                  <span className="data-name">{dataset.name}</span>
                  <span className="data-caption" style={{ display: "block" }}>
                    {
                      {
                        csv: "CSV file",
                        sample: "Sample dataset",
                        google_sheets: "Google Sheets",
                        postgresql: "PostgreSQL",
                      }[dataset.sourceType]
                    }
                  </span>
                </span>
              </button>
              <span className="muted">
                {dataset.rowCount.toLocaleString()} rows
                <span className="data-caption" style={{ display: "block" }}>
                  {dataset.fields.length} columns
                </span>
              </span>
              <span>
                <span className="badge">
                  {dataset.sourceStatus === "syncing" && (
                    <RefreshCw size={11} className="spin" />
                  )}
                  {freshness(dataset)}
                </span>
                {dataset.sourceError && (
                  <span className="data-caption" style={{ display: "block" }}>
                    {dataset.sourceError}
                  </span>
                )}
              </span>
              <span className="muted">
                {relativeTime(dataset.lastSyncedAt ?? dataset.updatedAt)}
              </span>
              <Menu
                trigger={
                  <button
                    className="icon-button"
                    aria-label={`Actions for ${dataset.name}`}
                  >
                    <MoreHorizontal size={17} />
                  </button>
                }
              >
                <MenuItem onSelect={() => setSelected(dataset)}>
                  <ArrowUpRight size={14} />
                  View data & definitions
                </MenuItem>
                {!["csv", "sample"].includes(dataset.sourceType) && (
                  <MenuItem
                    disabled={refreshing === dataset.id}
                    onSelect={() => void refresh(dataset)}
                  >
                    <RefreshCw
                      size={14}
                      className={refreshing === dataset.id ? "spin" : ""}
                    />
                    {refreshing === dataset.id ? "Refreshing…" : "Refresh source"}
                  </MenuItem>
                )}
                <MenuItem danger onSelect={() => setDeleting(dataset)}>
                  <Trash2 size={14} />
                  Delete dataset
                </MenuItem>
              </Menu>
            </div>
          ))}
        </div>
      )}
      <p style={{ fontSize: 11, marginTop: 20 }}>
        CSV files and sample datasets are snapshots. Connected sources show
        their supported refresh behavior.
      </p>
      <AddData
        open={adding}
        initialConnectionId={sheetsConnection || undefined}
        onOpenChange={(open) => {
          setAdding(open);
          if (!open && sheetsConnection) router.replace("/data");
        }}
      />
      <Modal
        title={current?.name ?? "Dataset"}
        description="Explore the fields and add the business context behind them."
        open={!!selected}
        onOpenChange={(value) => {
          if (!value) setSelected(null);
        }}
        wide
      >
        <div className="stack">
          {current && (
            <>
              <div className="row">
                <span className="badge">
                  {current.rowCount.toLocaleString()} rows
                </span>
                <span className="badge">{current.fields.length} fields</span>
                <span className="badge">
                  Index: {detail.data?.indexingStatus ?? "Pending"}
                </span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Type</th>
                      <th>Meaning</th>
                      <th>Distinct</th>
                      <th>Null / missing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {current.fields.map((field) => (
                      <tr key={field.name}>
                        <td>{field.name}</td>
                        <td>{field.type}</td>
                        <td>{field.semantic}</td>
                        <td>{field.stats.distinctCount}</td>
                        <td>
                          {field.stats.nullCount} / {field.stats.missingCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divider" />
              <h3 className="row">
                <BookOpen size={17} />
                Business definitions
              </h3>
              <p style={{ fontSize: 12 }}>
                Explain terms such as “active customer” or “net revenue”. GenUI
                checks the necessary fields before calculating a metric.
              </p>
              {detail.data?.definitions?.map((item) => (
                <div className="card" style={{ padding: 13 }} key={item.id}>
                  <h3>{item.title}</h3>
                  <p style={{ fontSize: 12, marginTop: 5 }}>{item.content}</p>
                </div>
              ))}
              <label>
                Definition title
                <input
                  value={definitionTitle}
                  onChange={(e) => setDefinitionTitle(e.target.value)}
                  placeholder="For example, Active customer"
                  maxLength={200}
                />
              </label>
              <label>
                Definition
                <textarea
                  rows={3}
                  value={definition}
                  onChange={(e) => setDefinition(e.target.value)}
                  placeholder="An active customer has at least one paid order in the previous 90 days."
                  maxLength={10000}
                />
              </label>
              {notice && (
                <p
                  style={{ fontSize: 12, color: "var(--primary)" }}
                  role="status"
                >
                  {notice}
                </p>
              )}
              <button
                className="button primary"
                disabled={busy || !definition.trim() || !definitionTitle.trim()}
                onClick={() => void addDefinition()}
              >
                {busy ? "Saving…" : "Add definition"}
              </button>
            </>
          )}
        </div>
      </Modal>
      <Modal
        title="Delete this dataset?"
        description={`“${deleting?.name}” will be removed. Dashboards that use it will show the source as unavailable.`}
        open={!!deleting}
        onOpenChange={(value) => {
          if (!value) setDeleting(null);
        }}
      >
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="button" onClick={() => setDeleting(null)}>
            Cancel
          </button>
          <button className="button danger" onClick={() => void remove()}>
            Delete dataset
          </button>
        </div>
      </Modal>
    </div>
  );
}
