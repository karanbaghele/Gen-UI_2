"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileSpreadsheet,
  Database,
  Table2,
  ArrowLeft,
  Upload,
  Check,
  Loader2,
} from "lucide-react";
import { api, post } from "@/lib/client";
import type { Dataset } from "@/lib/domain/schema";
import { ErrorNote, Modal } from "./ui";
import type { Session } from "./shell";
type Preview = {
  fields: Dataset["fields"];
  rows: Dataset["rows"];
  rowCount: number;
  warnings: string[];
};
export function AddData({
  open,
  onOpenChange,
  onAdded,
  initialConnectionId,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onAdded?: (dataset: Dataset) => void;
  initialConnectionId?: string;
}) {
  const cache = useQueryClient();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api<Session>("/api/session"),
    retry: false,
  });
  const [kind, setKind] = useState<
    "choose" | "csv" | "google_sheets" | "postgresql"
  >(initialConnectionId ? "google_sheets" : "choose");
  const [name, setName] = useState("");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const close = (value: boolean) => {
    onOpenChange(value);
    if (!value) {
      setKind("choose");
      setPreview(null);
      setCsv("");
      setError("");
    }
  };
  const added = (dataset: Dataset) => {
    cache.invalidateQueries({ queryKey: ["datasets"] });
    onAdded?.(dataset);
    close(false);
  };
  const sample = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await post<{ dataset: Dataset }>("/api/datasets", {
        kind: "sample",
      });
      added(result.dataset);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to add sample data");
    } finally {
      setBusy(false);
    }
  };
  const readFile = async (file?: File) => {
    if (!file) return;
    setError("");
    setBusy(true);
    setPreview(null);
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error("Choose a CSV file smaller than 10 MB.");
      const buffer = await file.arrayBuffer();
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      } catch {
        throw new Error(
          "This file is not valid UTF-8. Save it as a UTF-8 CSV and try again.",
        );
      }
      setCsv(text);
      setName(file.name.replace(/\.[^.]+$/, ""));
      const result = await post<Preview | { preview: Preview }>(
        "/api/datasets/preview",
        { csv: text },
      );
      setPreview("preview" in result ? result.preview : result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to read file");
    } finally {
      setBusy(false);
    }
  };
  const importCsv = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await post<{ dataset: Dataset }>("/api/datasets", {
        kind: "csv",
        name: name.trim(),
        csv,
      });
      added(result.dataset);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to import CSV");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={
        kind === "choose"
          ? "Bring your data into focus"
          : kind === "csv"
            ? "Upload a CSV"
            : kind === "google_sheets"
              ? "Connect Google Sheets"
              : "Connect PostgreSQL"
      }
      description={
        kind === "choose"
          ? "Start with a file, connect a source, or explore a sample."
          : kind === "csv"
            ? "Preview your data before adding it to your workspace."
            : undefined
      }
      open={open}
      onOpenChange={close}
      wide={!!preview}
    >
      {kind !== "choose" && (
        <button
          className="button quiet small"
          style={{ marginBottom: 14 }}
          onClick={() => {
            setKind("choose");
            setError("");
          }}
        >
          <ArrowLeft size={14} />
          All sources
        </button>
      )}
      {kind === "choose" ? (
        <div className="source-options">
          <button className="source-option" onClick={() => setKind("csv")}>
            <Upload size={23} />
            <span>Upload CSV</span>
            <small>A snapshot from your files</small>
          </button>
          <button
            className="source-option"
            onClick={() => setKind("google_sheets")}
          >
            <FileSpreadsheet size={23} />
            <span>Google Sheets</span>
            <small>Connect a spreadsheet</small>
          </button>
          <button
            className="source-option"
            onClick={() => setKind("postgresql")}
          >
            <Database size={23} />
            <span>PostgreSQL</span>
            <small>Connect a read-only database</small>
          </button>
          <button
            className="source-option"
            onClick={() => void sample()}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="spin" size={23} />
            ) : (
              <Table2 size={23} />
            )}
            <span>Sample sales data</span>
            <small>Explore with a realistic dataset</small>
          </button>
        </div>
      ) : kind === "csv" ? (
        <div className="stack">
          {!preview ? (
            <div
              className={`drop-zone ${dragging ? "dragging" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void readFile(e.dataTransfer.files[0]);
              }}
            >
              <Upload size={25} />
              <div>{busy ? "Reading your file…" : "Drop a CSV file here"}</div>
              <button
                className="button small"
                disabled={busy}
                onClick={() => input.current?.click()}
              >
                Choose a file
              </button>
              <input
                ref={input}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                aria-label="Choose CSV file"
                onChange={(e) => void readFile(e.target.files?.[0])}
              />
              <small>UTF-8 · CSV · Up to 10 MB</small>
            </div>
          ) : (
            <>
              <label>
                Dataset name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={200}
                />
              </label>
              <div className="row">
                <span className="badge green">
                  <Check size={12} />
                  {preview.rowCount.toLocaleString()} rows
                </span>
                <span className="badge">{preview.fields.length} columns</span>
                <span className="badge">Snapshot</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {preview.fields.map((field) => (
                        <th key={field.name}>
                          {field.name}
                          <br />
                          <small>{field.type}</small>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 5).map((row, i) => (
                      <tr key={i}>
                        {preview.fields.map((field) => (
                          <td key={field.name}>
                            {row[field.name] === undefined ? (
                              <em className="muted">Missing</em>
                            ) : row[field.name] === null ? (
                              <em className="muted">Null</em>
                            ) : (
                              String(row[field.name])
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.warnings?.map((warning, i) => (
                <p key={i} style={{ fontSize: 11 }}>
                  {warning}
                </p>
              ))}
              <div className="row spread">
                <button
                  className="button quiet"
                  onClick={() => setPreview(null)}
                >
                  Choose another file
                </button>
                <button
                  className="button primary"
                  onClick={() => void importCsv()}
                  disabled={busy || !name.trim()}
                >
                  {busy ? "Importing…" : "Add dataset"}
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <ConnectorSetup
          kind={kind}
          onAdded={added}
          configured={kind !== "google_sheets" || session.data?.config.sheets}
          initialConnectionId={
            kind === "google_sheets" ? initialConnectionId : undefined
          }
        />
      )}
      <ErrorNote message={error} />
    </Modal>
  );
}
function ConnectorSetup({
  kind,
  onAdded,
  configured,
  initialConnectionId,
}: {
  kind: "google_sheets" | "postgresql";
  onAdded: (dataset: Dataset) => void;
  configured?: boolean;
  initialConnectionId?: string;
}) {
  const [values, setValues] = useState<Record<string, string>>({
    port: "5432",
    ssl: "require",
    refreshIntervalSeconds: "60",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(Boolean(initialConnectionId));
  const [connectionId, setConnectionId] = useState(initialConnectionId ?? "");
  const [tables, setTables] = useState<{ id: string; name: string }[]>([]);
  const [selection, setSelection] = useState("");
  const [sourcePreview, setSourcePreview] = useState<Preview | null>(null);
  useEffect(() => {
    if (!initialConnectionId) return;
    let active = true;
    void post<{ tables: { id: string; name: string }[] }>(
      "/api/sources/discover",
      { connectionId: initialConnectionId },
    )
      .then((result) => {
        if (!active) return;
        setTables(result.tables);
        setSelection(result.tables[0]?.id ?? "");
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to discover worksheets",
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [initialConnectionId]);
  const field = (name: string, label: string, type = "text") => (
    <label key={name}>
      {label}
      <input
        type={type}
        value={values[name] ?? ""}
        onChange={(e) => setValues({ ...values, [name]: e.target.value })}
        autoComplete={type === "password" ? "new-password" : "off"}
      />
    </label>
  );
  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const payload =
        kind === "google_sheets"
          ? {
              kind,
              spreadsheet: values.spreadsheet ?? "",
              refreshIntervalSeconds: values.refreshIntervalSeconds,
            }
          : {
              kind,
              host: values.host ?? "",
              port: values.port,
              database: values.database ?? "",
              user: values.user ?? "",
              password: values.password ?? "",
              ssl: values.ssl,
              refreshIntervalSeconds: values.refreshIntervalSeconds,
            };
      const result = await post<{
        connectionId: string;
        tables?: { id: string; name: string }[];
        authorizationUrl?: string;
      }>("/api/sources/connect", payload);
      if (result.authorizationUrl) {
        window.location.href = result.authorizationUrl;
        return;
      }
      setConnectionId(result.connectionId);
      setTables(result.tables ?? []);
      setSelection(result.tables?.[0]?.id ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to connect");
    } finally {
      setBusy(false);
    }
  };
  const importSource = async () => {
    setBusy(true);
    try {
      const result = await post<{ dataset: Dataset }>("/api/sources/import", {
        connectionId,
        selection,
      });
      onAdded(result.dataset);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to import");
    } finally {
      setBusy(false);
    }
  };
  const previewSource = async () => {
    if (!connectionId || !selection) return;
    setBusy(true);
    setError("");
    try {
      setSourcePreview(
        await post<Preview>("/api/sources/preview", {
          connectionId,
          selection,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to preview this data");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      {kind === "google_sheets" ? (
        <>
          {field("spreadsheet", "Spreadsheet URL or ID")}
          <p style={{ fontSize: 12 }}>
            Connecting Sheets asks Google for separate, read-only spreadsheet
            access. Your sign-in permission does not include access to private
            spreadsheets.
          </p>
          {configured === false && (
            <div className="setup-note" role="status">
              <strong>Google Sheets setup is required</strong>
              <p>
                Add <code>GOOGLE_SHEETS_CLIENT_ID</code> and{" "}
                <code>GOOGLE_SHEETS_CLIENT_SECRET</code> to{" "}
                <code>.env.local</code>, then restart GenUI.
              </p>
              <p>
                Authorized callback: <code>http://127.0.0.1:3000/auth/google-sheets/callback</code>
              </p>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="field-grid">
            {field("host", "Host")}
            {field("port", "Port")}
            {field("database", "Database")}
            {field("user", "User")}
            {field("password", "Password", "password")}
            <label>
              SSL
              <select
                value={values.ssl}
                onChange={(e) => setValues({ ...values, ssl: e.target.value })}
              >
                <option value="require">Require SSL</option>
                <option value="disable">Disable (local only)</option>
              </select>
            </label>
          </div>
          <p style={{ fontSize: 11 }}>
            Use a dedicated read-only user. Queries are bounded and run in
            read-only transactions. Refresh uses polling unless change
            notifications are explicitly configured.
          </p>
        </>
      )}
      {!connectionId && (
        <label>
          Refresh interval
          <select
            value={values.refreshIntervalSeconds}
            onChange={(event) =>
              setValues({
                ...values,
                refreshIntervalSeconds: event.target.value,
              })
            }
          >
            <option value="30">Every 30 seconds</option>
            <option value="60">Every minute</option>
            <option value="300">Every 5 minutes</option>
            <option value="900">Every 15 minutes</option>
          </select>
          <small>Polling runs in the local worker while GenUI is running.</small>
        </label>
      )}
      {tables.length > 0 ? (
        <>
          <label>
            {kind === "google_sheets" ? "Worksheet" : "Table"}
            <select
              value={selection}
              onChange={(e) => {
                setSelection(e.target.value);
                setSourcePreview(null);
              }}
            >
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          {sourcePreview ? (
            <>
              <div className="row wrap">
                <span className="badge green">
                  <Check size={12} />
                  {sourcePreview.rowCount.toLocaleString()} rows
                </span>
                <span className="badge">
                  {sourcePreview.fields.length} columns
                </span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {sourcePreview.fields.map((field) => (
                        <th key={field.name}>{field.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sourcePreview.rows.slice(0, 5).map((row, index) => (
                      <tr key={index}>
                        {sourcePreview.fields.map((field) => (
                          <td key={field.name}>
                            {row[field.name] == null
                              ? "—"
                              : String(row[field.name])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {sourcePreview.warnings.map((warning) => (
                <p key={warning} style={{ fontSize: 11 }}>
                  {warning}
                </p>
              ))}
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void importSource()}
              >
                {busy ? "Importing…" : "Import selected data"}
              </button>
            </>
          ) : (
            <button
              className="button primary"
              disabled={busy || !selection}
              onClick={() => void previewSource()}
            >
              {busy ? "Loading preview…" : "Preview selected data"}
            </button>
          )}
        </>
      ) : (
        <button
          className="button primary"
          disabled={busy || configured === false}
          onClick={() => void connect()}
        >
          {busy
            ? "Connecting…"
            : configured === false
              ? "Setup needed"
            : kind === "google_sheets"
              ? "Authorize and connect"
              : "Test connection"}
        </button>
      )}
      <ErrorNote message={error} />
    </div>
  );
}
