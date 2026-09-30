"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Responsive,
  WidthProvider,
  type Layout as RglLayout,
} from "react-grid-layout/legacy";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  GripVertical,
  History,
  Info,
  ScanSearch,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  Redo2,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Undo2,
  WandSparkles,
  X,
} from "lucide-react";
import { api, ApiError, post } from "@/lib/client";
import { readGenerationStream } from "@/lib/client-stream";
import type {
  DashboardSpec,
  DataValue,
  Dataset,
  LayoutItem,
  QueryResult,
  Widget,
} from "@/lib/domain/schema";
import { componentRegistry } from "@/lib/domain/registry";
import { Menu, MenuItem, Modal, ErrorNote, Loading } from "./ui";
import type { Session } from "./shell";
const Grid = WidthProvider(Responsive);
type Layout = RglLayout[number];
const seriesColors = [
  "var(--chart-orange)",
  "var(--chart-cyan)",
  "var(--chart-lime)",
  "var(--chart-amber)",
  "var(--chart-magenta)",
  "var(--chart-violet)",
  "var(--chart-teal)",
  "var(--chart-red)",
];
const categoryColors = [
  "var(--chart-amber)",
  "var(--chart-orange)",
  "var(--chart-red)",
  "var(--chart-magenta)",
  "var(--chart-violet)",
  "var(--chart-cyan)",
  "var(--chart-lime)",
  "var(--chart-teal)",
];
const sliceColors = [
  "var(--chart-orange)",
  "var(--chart-red)",
  "var(--chart-lime)",
  "var(--chart-cyan)",
  "var(--chart-amber)",
  "var(--chart-magenta)",
  "var(--chart-teal)",
  "var(--chart-violet)",
];
type DashboardRecord = {
  id: string;
  title: string;
  spec: DashboardSpec;
  version: number;
  pinned: boolean;
  updatedAt: string;
  createdAt: string;
};
type Detail = {
  dashboard: DashboardRecord;
  datasets: Dataset[];
  results: Record<string, QueryResult>;
};
type DashboardContext = {
  selectedDatasets: {
    id: string;
    name: string;
    sourceType: string;
    indexingStatus: string;
    updatedAt: string;
  }[];
  generation: {
    id: string;
    provider: string;
    model: string;
    status: string;
    durationMs: number | null;
    retrieval: unknown;
    usage: unknown;
    validation: unknown;
    error: string | null;
    createdAt: string;
  } | null;
  queryRuns: {
    id: string;
    datasetId: string | null;
    query: unknown;
    resultsCount: number;
    durationMs: number;
    status: string;
    error: string | null;
    createdAt: string;
  }[];
  finalSchema: DashboardSpec;
};
const display = (value: unknown, kind?: string) => {
  if (typeof value !== "number") return value == null ? "—" : String(value);
  if (kind === "currency")
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  if (kind === "percent")
    return new Intl.NumberFormat(undefined, {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(value);
  if (kind === "compact")
    return new Intl.NumberFormat(undefined, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
    value,
  );
};
function Chart({
  widget,
  result,
  onExport,
}: {
  widget: Widget;
  result?: QueryResult;
  onExport?: () => void;
}) {
  const data = result?.rows ?? [];
  const config = widget.config as Record<string, unknown>;
  if (
    !result &&
    !["text", "dateFilter", "selectFilter", "searchFilter"].includes(
      widget.type,
    )
  )
    return <div className="widget-error">No query result available.</div>;
  if (widget.type === "text")
    return (
      <p style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>
        {String(config.content)}
      </p>
    );
  if (widget.type === "kpi") {
    const metric = String(config.metric);
    const comparison = result?.comparison?.[metric];
    return (
      <>
        <div className="kpi-value">
          {display(data[0]?.[metric], String(config.format ?? "compact"))}
        </div>
        <div className="kpi-caption">
          {widget.description ?? "Calculated from the active data"}
        </div>
        {comparison?.percentChange != null && (
          <div className="kpi-change">
            {comparison.percentChange >= 0 ? "↑" : "↓"}{" "}
            {display(Math.abs(comparison.percentChange), "percent")} versus
            comparison period
          </div>
        )}
      </>
    );
  }
  if (widget.type === "table") {
    const columns = (config.columns as string[]) ?? result?.columns ?? [];
    return (
      <TableWidget
        data={data}
        columns={columns}
        pageSize={Number(config.pageSize ?? 10)}
        onExport={onExport}
      />
    );
  }
  if (widget.type === "export")
    return (
      <button className="button" disabled={!onExport} onClick={onExport}>
        <Download size={14} />
        {String(config.label ?? "Export CSV")}
      </button>
    );
  if (widget.type === "progress") {
    const metric = Number(data[0]?.[String(config.metric)] ?? 0);
    const target = Number(data[0]?.[String(config.targetField)] ?? 0);
    const percent = target > 0 ? Math.min(100, (metric / target) * 100) : 0;
    return (
      <>
        <div className="kpi-value">
          {display(metric, String(config.format ?? "compact"))}
        </div>
        <div
          style={{
            height: 8,
            borderRadius: 8,
            background: "var(--muted)",
            overflow: "hidden",
            marginTop: 14,
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${percent}%`,
              background: "var(--primary)",
              borderRadius: 8,
            }}
          />
        </div>
        <p className="chart-description">
          {display(percent / 100, "percent")} of{" "}
          {display(target, String(config.format ?? "compact"))} target
        </p>
      </>
    );
  }
  if (widget.type === "insight") {
    const metric = String(config.metric);
    const numbers = data
      .map((row) => row[metric])
      .filter((value): value is number => typeof value === "number");
    const value =
      config.template === "largest" ? Math.max(...numbers) : numbers[0];
    return (
      <div className="stack" style={{ gap: 7 }}>
        <strong style={{ fontSize: 22, fontWeight: 550 }}>
          {display(value, String(config.format ?? "compact"))}
        </strong>
        <p style={{ fontSize: 12 }}>
          {widget.description ?? "Grounded in the current result."}
        </p>
      </div>
    );
  }
  if (widget.type === "pie" || widget.type === "donut") {
    const nameKey = String(config.nameKey);
    const valueKey = String(config.valueKey);
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey={valueKey}
            nameKey={nameKey}
            innerRadius={widget.type === "donut" ? "55%" : 0}
            outerRadius="78%"
            paddingAngle={2}
          >
            {data.map((_, index) => (
              <Cell key={index} fill={sliceColors[index % sliceColors.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: unknown) =>
              display(value, String(config.format ?? "compact"))
            }
          />
          <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (widget.type === "scatter") {
    const xKey = String(config.xKey);
    const yKey = String(config.yKey);
    return (
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            type="number"
            dataKey={xKey}
            name={xKey}
            tick={{ fontSize: 10, fill: "var(--secondary)" }}
          />
          <YAxis
            type="number"
            dataKey={yKey}
            name={yKey}
            tick={{ fontSize: 10, fill: "var(--secondary)" }}
          />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} />
          <Scatter data={data} fill={seriesColors[0]}>
            {Boolean(config.nameKey) &&
              data.map((_, index) => (
                <Cell key={index} fill={categoryColors[index % categoryColors.length]} />
              ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    );
  }
  if (
    widget.type === "bar" ||
    widget.type === "line" ||
    widget.type === "area"
  ) {
    const xKey = String(config.xKey);
    const yKeys = (config.yKeys as string[]) ?? [];
    const axes = (
      <>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          vertical={false}
        />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 10, fill: "var(--secondary)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "var(--secondary)" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(value) =>
            display(value, String(config.format ?? "compact"))
          }
        />
        <Tooltip
          formatter={(value: unknown) =>
            display(value, String(config.format ?? "compact"))
          }
        />
        {yKeys.length > 1 && (
          <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
        )}
      </>
    );
    if (widget.type === "bar")
      return config.orientation === "horizontal" ? (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 18, bottom: 4, left: 8 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              horizontal={false}
            />
            <XAxis
              type="number"
              tick={{ fontSize: 10, fill: "var(--secondary)" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value) =>
                display(value, String(config.format ?? "compact"))
              }
            />
            <YAxis
              type="category"
              dataKey={xKey}
              width={104}
              tick={{ fontSize: 10, fill: "var(--secondary)" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(value: unknown) =>
                display(value, String(config.format ?? "compact"))
              }
            />
            {yKeys.length > 1 && (
              <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
            )}
            {yKeys.map((key, index) => (
              <Bar
                key={key}
                dataKey={key}
                fill={seriesColors[index % seriesColors.length]}
                radius={[0, 3, 3, 0]}
                stackId={config.stacked ? "value" : undefined}
              >
                {yKeys.length === 1 &&
                  data.map((_, rowIndex) => (
                    <Cell key={rowIndex} fill={categoryColors[rowIndex % categoryColors.length]} />
                  ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            {axes}
            {yKeys.map((key, index) => (
              <Bar
                key={key}
                dataKey={key}
                fill={seriesColors[index % seriesColors.length]}
                radius={[3, 3, 0, 0]}
                stackId={config.stacked ? "value" : undefined}
              >
                {yKeys.length === 1 &&
                  data.map((_, rowIndex) => (
                    <Cell key={rowIndex} fill={categoryColors[rowIndex % categoryColors.length]} />
                  ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      );
    if (widget.type === "area")
      return (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              {yKeys.map((key, index) => (
                <linearGradient
                  key={key}
                  id={`area-${widget.id}-${index}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={seriesColors[index % seriesColors.length]} stopOpacity={0.38} />
                  <stop offset="100%" stopColor={seriesColors[index % seriesColors.length]} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            {axes}
            {yKeys.map((key, index) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stroke={seriesColors[index % seriesColors.length]}
                strokeWidth={2.5}
                fill={`url(#area-${widget.id}-${index})`}
                stackId={config.stacked ? "value" : undefined}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      );
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          {axes}
          {yKeys.map((key, index) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={seriesColors[index % seriesColors.length]}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }
  return (
    <div className="widget-error">This component needs a query result.</div>
  );
}

function TableWidget({
  data,
  columns,
  pageSize,
  onExport,
}: {
  data: QueryResult["rows"];
  columns: string[];
  pageSize: number;
  onExport?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{
    column: string;
    direction: "ascending" | "descending";
  } | null>(null);
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const rows = needle
      ? data.filter((row) =>
          columns.some((column) =>
            String(row[column] ?? "")
              .toLocaleLowerCase()
              .includes(needle),
          ),
        )
      : [...data];
    if (!sort) return rows;
    return rows.sort((left, right) => {
      const a = left[sort.column];
      const b = right[sort.column];
      const comparison =
        typeof a === "number" && typeof b === "number"
          ? a - b
          : String(a ?? "").localeCompare(String(b ?? ""), undefined, {
              numeric: true,
              sensitivity: "base",
            });
      return sort.direction === "ascending" ? comparison : -comparison;
    });
  }, [columns, data, search, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const rows = filtered.slice(
    currentPage * pageSize,
    currentPage * pageSize + pageSize,
  );
  return (
    <div className="table-widget">
      <div className="table-widget-controls no-print">
        <label className="search-input">
          <span className="sr-only">Filter table rows</span>
          <Search size={13} />
          <input
            value={search}
            placeholder="Filter rows…"
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <span className="spacer" />
        {onExport && (
          <button className="button quiet small" onClick={onExport}>
            <Download size={13} />
            CSV
          </button>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  aria-sort={sort?.column === column ? sort.direction : "none"}
                >
                  <button
                    className="table-sort"
                    onClick={() => {
                      setSort((current) => ({
                        column,
                        direction:
                          current?.column === column &&
                          current.direction === "ascending"
                            ? "descending"
                            : "ascending",
                      }));
                      setPage(0);
                    }}
                  >
                    {column}
                    {sort?.column === column
                      ? sort.direction === "ascending"
                        ? " ↑"
                        : " ↓"
                      : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={currentPage * pageSize + index}>
                {columns.map((column) => (
                  <td key={column}>{display(row[column])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-widget-footer no-print">
        <span>
          {filtered.length
            ? `${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, filtered.length)} of ${filtered.length}`
            : "No matching rows"}
        </span>
        <button
          className="icon-button"
          aria-label="Previous table page"
          disabled={currentPage === 0}
          onClick={() => setPage(currentPage - 1)}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          className="icon-button"
          aria-label="Next table page"
          disabled={currentPage >= pages - 1}
          onClick={() => setPage(currentPage + 1)}
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
function WidgetCard({
  widget,
  result,
  onRemove,
  onEdit,
  onExport,
}: {
  widget: Widget;
  result?: QueryResult;
  onRemove: () => void;
  onEdit: (widget: Widget) => void;
  onExport?: () => void;
}) {
  return (
    <section className={`card widget widget-${widget.type}`}>
      <header className="widget-header">
        <GripVertical className="drag-handle no-print" size={15} />
        <h3>{widget.title}</h3>
        <Menu
          trigger={
            <button
              className="icon-button no-print"
              aria-label={`Actions for ${widget.title}`}
            >
              <MoreHorizontal size={16} />
            </button>
          }
        >
          <MenuItem onSelect={() => onEdit(widget)}>
            <Info size={14} />
            Edit details
          </MenuItem>
          <MenuItem danger onSelect={onRemove}>
            <Trash2 size={14} />
            Remove widget
          </MenuItem>
        </Menu>
      </header>
      <div className="widget-body">
        <Chart
          widget={widget}
          result={widget.queryId ? result : undefined}
          onExport={onExport}
        />
      </div>
      {widget.queryId && (
        <div className="widget-lineage">
          Source: {widget.queryId} · deterministic query
        </div>
      )}
    </section>
  );
}
function WidgetEditor({
  widget,
  layout,
  onCancel,
  onSave,
}: {
  widget: Widget;
  layout: LayoutItem;
  onCancel: () => void;
  onSave: (value: { widget: Widget; layout: LayoutItem }) => void;
}) {
  const [title, setTitle] = useState(widget.title);
  const [description, setDescription] = useState(widget.description ?? "");
  const [position, setPosition] = useState(layout);
  const minimum = componentRegistry[widget.type].minSize;
  const validLayout =
    Number.isInteger(position.x) &&
    Number.isInteger(position.y) &&
    Number.isInteger(position.w) &&
    Number.isInteger(position.h) &&
    position.x >= 0 &&
    position.y >= 0 &&
    position.w >= minimum.w &&
    position.h >= minimum.h &&
    position.x + position.w <= 12;
  const layoutField = (
    key: "x" | "y" | "w" | "h",
    label: string,
    min: number,
    max: number,
  ) => (
    <label>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={position[key]}
        onChange={(event) =>
          setPosition({
            ...position,
            [key]: Number(event.target.value),
          })
        }
      />
    </label>
  );
  return (
    <div className="stack">
      <label>
        Title
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={300}
        />
      </label>
      <label>
        Description
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={10000}
          rows={3}
        />
      </label>
      <div className="divider" />
      <div>
        <h3>Position and size</h3>
        <p style={{ fontSize: 11, marginTop: 4 }}>
          Use these controls as an alternative to dragging and resizing.
        </p>
      </div>
      <div className="field-grid">
        {layoutField("x", "Column", 0, 11)}
        {layoutField("y", "Row", 0, 10000)}
        {layoutField("w", "Width", minimum.w, 12)}
        {layoutField("h", "Height", minimum.h, 50)}
      </div>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={!title.trim() || !validLayout}
          onClick={() =>
            onSave({
              widget: {
                ...widget,
                title: title.trim(),
                description: description.trim() || undefined,
              } as Widget,
              layout: position,
            })
          }
        >
          <Save size={14} />
          Save
        </button>
      </div>
    </div>
  );
}
export function DashboardEditor({ id }: { id: string }) {
  const detail = useQuery({
    queryKey: ["dashboard", id],
    queryFn: () => api<Detail>(`/api/dashboards/${id}`),
  });
  if (detail.isPending) return <Loading label="Loading your dashboard…" />;
  if (detail.error)
    return (
      <div className="page">
        <ErrorNote message={detail.error.message} />
      </div>
    );
  return <DashboardEditorReady id={id} initialDetail={detail.data} />;
}

function DashboardEditorReady({
  id,
  initialDetail,
}: {
  id: string;
  initialDetail: Detail;
}) {
  const cache = useQueryClient();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api<Session>("/api/session"),
  });
  const [record, setRecord] = useState(initialDetail.dashboard);
  const recordRef = useRef(initialDetail.dashboard);
  const conflictRef = useRef(false);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = useRef(0);
  const [spec, setSpec] = useState(initialDetail.dashboard.spec);
  const [results, setResults] = useState(initialDetail.results);
  const [filters, setFilters] = useState<
    Record<string, DataValue | DataValue[]>
  >(
    Object.fromEntries(
      initialDetail.dashboard.spec.filters
        .filter((filter) => filter.defaultValue !== undefined)
        .map((filter) => [filter.id, filter.defaultValue!]),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [editing, setEditing] = useState<Widget | null>(null);
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [metadataDraft, setMetadataDraft] = useState({
    title: initialDetail.dashboard.spec.title,
    description: initialDetail.dashboard.spec.description,
  });
  const [versions, setVersions] = useState<
    { version: number; reason: string; createdAt: string }[] | null
  >(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [context, setContext] = useState<DashboardContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [refinePrompt, setRefinePrompt] = useState("");
  const [refining, setRefining] = useState(false);
  const [refineStage, setRefineStage] = useState("");
  const [past, setPast] = useState<DashboardSpec[]>([]);
  const [future, setFuture] = useState<DashboardSpec[]>([]);
  const [interactionBase, setInteractionBase] = useState<DashboardSpec | null>(
    null,
  );
  const remember = useCallback((previous: DashboardSpec) => {
    setPast((items) => [...items.slice(-49), previous]);
    setFuture([]);
  }, []);
  const save = useCallback((next: DashboardSpec, reason = "save") => {
    setSpec(next);
    pendingSaves.current += 1;
    setSaving(true);
    setError("");
    const request = saveQueue.current.then(async () => {
      if (conflictRef.current)
        throw new ApiError(
          "This dashboard changed in another tab. Load the latest version before saving.",
          409,
        );
      const value = await api<{ dashboard: DashboardRecord }>(
        `/api/dashboards/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spec: next,
            expectedVersion: recordRef.current.version,
            reason,
          }),
        },
      );
      recordRef.current = value.dashboard;
      setRecord(value.dashboard);
      conflictRef.current = false;
      setConflict(false);
      await cache.invalidateQueries({ queryKey: ["dashboards"] });
      setNotice("Saved");
      setTimeout(() => setNotice(""), 1800);
    });
    void request
      .catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 409) {
          conflictRef.current = true;
          setConflict(true);
        }
        setError(
          cause instanceof Error ? cause.message : "Unable to save dashboard",
        );
      })
      .finally(() => {
        pendingSaves.current = Math.max(0, pendingSaves.current - 1);
        setSaving(pendingSaves.current > 0);
      });
    saveQueue.current = request.catch(() => undefined);
    return request;
  }, [cache, id]);
  const reloadLatest = async () => {
    setSaving(true);
    setError("");
    try {
      const latest = await api<Detail>(`/api/dashboards/${id}`);
      recordRef.current = latest.dashboard;
      setRecord(latest.dashboard);
      setSpec(latest.dashboard.spec);
      setResults(latest.results);
      setPast([]);
      setFuture([]);
      conflictRef.current = false;
      setConflict(false);
      setNotice("Latest version loaded");
      setTimeout(() => setNotice(""), 1800);
      await cache.invalidateQueries({ queryKey: ["dashboard", id] });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to reload dashboard",
      );
    } finally {
      setSaving(false);
    }
  };
  const metadataDirty =
    metadataDraft.title.trim() !== spec.title ||
    metadataDraft.description.trim() !== spec.description;
  const saveMetadata = useCallback(() => {
    const title = metadataDraft.title.trim();
    const description = metadataDraft.description.trim();
    if (!title || (!metadataDirty && description === spec.description)) return;
    const next = { ...spec, title, description };
    remember(spec);
    void save(next, "autosave");
  }, [metadataDraft, metadataDirty, remember, save, spec]);
  useEffect(() => {
    if (!editingMetadata || !metadataDirty || !metadataDraft.title.trim())
      return;
    const timer = setTimeout(saveMetadata, 800);
    return () => clearTimeout(timer);
  }, [
    editingMetadata,
    metadataDirty,
    metadataDraft.title,
    metadataDraft.description,
    saveMetadata,
  ]);
  const updateResults = async (
    next: Record<string, DataValue | DataValue[]>,
  ) => {
    setFilters(next);
    try {
      const response = await post<{ results: Record<string, QueryResult> }>(
        `/api/dashboards/${id}/query`,
        { filters: next },
      );
      setResults(response.results);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to apply filters",
      );
    }
  };
  const exportQuery = async (queryId: string) => {
    setError("");
    try {
      const response = await fetch(`/api/dashboards/${id}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queryId, filters }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new ApiError(
          payload?.error?.message ?? "Unable to export this table.",
          response.status,
        );
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${spec.title
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "genui-dashboard"}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to export CSV");
    }
  };
  const refine = async () => {
    const prompt = refinePrompt.trim();
    if (!prompt || refining) return;
    await saveQueue.current;
    setRefining(true);
    setRefineStage("Starting your refinement");
    setError("");
    try {
      const response = await fetch("/api/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dashboardId: id,
          prompt,
          expectedVersion: recordRef.current.version,
        }),
      });
      const value = await readGenerationStream<{
        type: "result";
        dashboard: DashboardRecord;
        results: QueryResult[];
      }>(response, setRefineStage);
      recordRef.current = value.dashboard;
      setRecord(value.dashboard);
      remember(spec);
      setSpec(value.dashboard.spec);
      setConflict(false);
      setResults(
        Object.fromEntries(
          value.results.map((result) => [result.queryId, result]),
        ),
      );
      setRefinePrompt("");
      setNotice("Saved");
      setTimeout(() => setNotice(""), 1800);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["dashboards"] }),
        cache.invalidateQueries({ queryKey: ["dashboard", id] }),
      ]);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) setConflict(true);
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to refine this dashboard.",
      );
    } finally {
      setRefining(false);
      setRefineStage("");
    }
  };
  const layouts = useMemo(
    () => ({ lg: (spec?.layouts.lg ?? []) as Layout[] }),
    [spec],
  );
  const remove = (widgetId: string) => {
    if (!spec) return;
    const used = spec.widgets.find((widget) => widget.id === widgetId)?.queryId;
    const widgets = spec.widgets.filter((widget) => widget.id !== widgetId);
    const queries =
      !used || widgets.some((widget) => widget.queryId === used)
        ? spec.queries
        : spec.queries.filter((query) => query.id !== used);
    const next = {
      ...spec,
      widgets,
      queries,
      layouts: { lg: spec.layouts.lg.filter((item) => item.i !== widgetId) },
    };
    remember(spec);
    void save(next, "remove_widget");
  };
  const addNote = () => {
    if (!spec) return;
    const newId = `note_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const y = Math.max(0, ...spec.layouts.lg.map((item) => item.y + item.h));
    const widget: Widget = {
      id: newId,
      type: "text",
      title: "Note",
      config: { content: "Add context for everyone who reads this dashboard." },
    };
    const next = {
      ...spec,
      widgets: [...spec.widgets, widget],
      layouts: {
        lg: [...spec.layouts.lg, { i: newId, x: 0, y, w: 6, h: 2 }],
      },
    };
    remember(spec);
    void save(next, "add_note");
  };
  const onLayoutChange = (layout: RglLayout) => {
    if (!spec) return;
    setSpec({
      ...spec,
      layouts: {
        lg: layout.map((item) => ({
          i: item.i,
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
          static: item.static || undefined,
        })),
      },
    });
  };
  const persistLayout = (layout: RglLayout) => {
    const next = {
      ...spec,
      layouts: {
        lg: layout.map((item) => ({
          i: item.i,
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
          static: item.static || undefined,
        })),
      },
    };
    if (
      interactionBase &&
      JSON.stringify(interactionBase.layouts.lg) !==
        JSON.stringify(next.layouts.lg)
    )
      remember(interactionBase);
    setInteractionBase(null);
    setSpec(next);
    void save(next, "layout");
  };
  const undo = () => {
    const previous = past.at(-1);
    if (!previous || saving) return;
    setPast((items) => items.slice(0, -1));
    setFuture((items) => [spec, ...items].slice(0, 50));
    void save(previous, "undo");
  };
  const redo = () => {
    const next = future[0];
    if (!next || saving) return;
    setFuture((items) => items.slice(1));
    setPast((items) => [...items.slice(-49), spec]);
    void save(next, "redo");
  };
  const fieldFor = (filter: DashboardSpec["filters"][number]) =>
    initialDetail.datasets
      .find((dataset) => dataset.id === filter.datasetId)
      ?.fields.find((field) => field.name === filter.field);
  return (
    <div className="page">
      <div className="print-only">
        GenUI · {spec.title} · Generated {new Date().toLocaleDateString()}
      </div>
      <header className="dashboard-header">
        <div>
          <div className="row" style={{ gap: 6 }}>
            <h1>{spec.title}</h1>
            <button
              className="icon-button no-print"
              aria-label="Edit dashboard title and description"
              onClick={() => {
                setMetadataDraft({
                  title: spec.title,
                  description: spec.description,
                });
                setEditingMetadata(true);
              }}
            >
              <Pencil size={14} />
            </button>
          </div>
          <p className="dashboard-subtitle">{spec.description}</p>
        </div>
        <span className="spacer" />
        <span className="save-status">
          {saving ? (
            <>
              <Loader2 className="spin" size={12} />
              Saving
            </>
          ) : metadataDirty ? (
            "Unsaved changes"
          ) : notice ? (
            <>
              <Check size={12} />
              Saved
            </>
          ) : (
            "All changes saved"
          )}
        </span>
        <button
          className="icon-button no-print"
          aria-label="Undo"
          disabled={!past.length || saving}
          onClick={undo}
        >
          <Undo2 size={16} />
        </button>
        <button
          className="icon-button no-print"
          aria-label="Redo"
          disabled={!future.length || saving}
          onClick={redo}
        >
          <Redo2 size={16} />
        </button>
        <button
          className="button small no-print"
          disabled={saving}
          onClick={() => void save(spec, "explicit_save")}
        >
          <Save size={14} />
          Save
        </button>
        <button className="button small no-print" onClick={addNote}>
          <Plus size={14} />
          Add note
        </button>
        <button
          className="button small no-print"
          disabled={!spec.queries.length}
          onClick={() => {
            const queryId =
              spec.widgets.find(
                (widget) => widget.type === "table" && widget.queryId,
              )?.queryId ?? spec.queries[0]?.id;
            if (queryId) void exportQuery(queryId);
          }}
        >
          <Download size={14} />
          Export table CSV
        </button>
        <button
          className="button small no-print"
          onClick={() => window.print()}
        >
          <Printer size={14} />
          Print
        </button>
        <button
          className="icon-button no-print"
          aria-label="View history"
          onClick={async () => {
            try {
              const value = await api<{
                versions: {
                  version: number;
                  reason: string;
                  createdAt: string;
                }[];
              }>(`/api/dashboards/${id}/versions`);
              setVersions(value.versions);
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Unable to load history",
              );
            }
          }}
        >
          <History size={17} />
        </button>
        {session.data?.workspace?.role === "admin" && (
          <button
            className="icon-button no-print"
            aria-label="Open Context Inspector"
            onClick={async () => {
              setInspectorOpen(true);
              setContextLoading(true);
              setError("");
              try {
                const value = await api<{ context: DashboardContext }>(
                  `/api/dashboards/${id}/context`,
                );
                setContext(value.context);
              } catch (cause) {
                setInspectorOpen(false);
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Unable to load generation context",
                );
              } finally {
                setContextLoading(false);
              }
            }}
          >
            <ScanSearch size={17} />
          </button>
        )}
      </header>
      <div className="card filter-bar">
        {spec.filters.map((filter) => {
          const field = fieldFor(filter);
          const value = filters[filter.id] ?? "";
          return (
            <label key={filter.id}>
              {filter.label}
              {filter.type === "date" ? (
                <input
                  type="date"
                  value={
                    Array.isArray(value)
                      ? String(value[0] ?? "")
                      : String(value)
                  }
                  onChange={(event) =>
                    void updateResults({
                      ...filters,
                      [filter.id]: [event.target.value, event.target.value],
                    })
                  }
                />
              ) : filter.type === "search" ? (
                <input
                  value={String(value)}
                  placeholder={`Search ${filter.field}`}
                  onChange={(event) =>
                    void updateResults({
                      ...filters,
                      [filter.id]: event.target.value,
                    })
                  }
                />
              ) : (
                <select
                  value={String(value)}
                  onChange={(event) =>
                    void updateResults({
                      ...filters,
                      [filter.id]: event.target.value,
                    })
                  }
                >
                  <option value="">All</option>
                  {field?.stats.examples.map((item) => (
                    <option key={String(item)} value={String(item)}>
                      {String(item)}
                    </option>
                  ))}
                </select>
              )}
            </label>
          );
        })}
        {spec.filters.length > 0 && (
          <button
            className="button quiet small no-print"
            onClick={() => void updateResults({})}
          >
            <X size={13} />
            Clear filters
          </button>
        )}
      </div>
      <div className="editor-hint no-print">
        <WandSparkles size={15} />
        Drag or resize a card to arrange your story. Changes are saved when you
        finish.
      </div>
      <ErrorNote message={error} />
      {conflict && (
        <div className="editor-hint no-print" role="alert">
          <RefreshCw size={15} />
          Another tab saved a newer version. Load it before making more edits.
          <span className="spacer" />
          <button
            className="button small"
            disabled={saving}
            onClick={() => void reloadLatest()}
          >
            Load latest
          </button>
        </div>
      )}
      <Grid
        className="dashboard-grid"
        layouts={layouts}
        breakpoints={{ lg: 900, md: 680, sm: 480, xs: 0 }}
        cols={{ lg: 12, md: 6, sm: 2, xs: 1 }}
        rowHeight={68}
        margin={[8, 8]}
        containerPadding={[8, 8]}
        draggableHandle=".drag-handle"
        onLayoutChange={onLayoutChange}
        onDragStart={() => setInteractionBase(spec)}
        onResizeStart={() => setInteractionBase(spec)}
        onDragStop={persistLayout}
        onResizeStop={persistLayout}
      >
        {spec.widgets.map((widget) => (
          <div key={widget.id}>
            <WidgetCard
              widget={widget}
              result={widget.queryId ? results[widget.queryId] : undefined}
              onRemove={() => remove(widget.id)}
              onEdit={setEditing}
              onExport={
                widget.queryId
                  ? () => void exportQuery(widget.queryId!)
                  : undefined
              }
            />
          </div>
        ))}
      </Grid>
      <div className="refine-bar no-print">
        {refining ? (
          <Loader2 className="spin" size={16} />
        ) : (
          <WandSparkles size={16} style={{ color: "var(--primary)" }} />
        )}
        <textarea
          placeholder={
            refining ? refineStage : "Describe a focused dashboard change…"
          }
          aria-label="Refine dashboard"
          value={refinePrompt}
          disabled={refining}
          onChange={(event) => setRefinePrompt(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void refine();
            }
          }}
        />
        <button
          className="button primary small"
          aria-label="Send refinement"
          disabled={refining || !refinePrompt.trim()}
          onClick={() => void refine()}
        >
          <WandSparkles size={14} />
        </button>
      </div>
      <details className="conversation no-print">
        <summary>How this dashboard was made</summary>
        <div className="conversation-message">
          <strong>Grounded dashboard</strong>Widgets use approved components and
          deterministic queries. Configure a local model or Gemini to generate
          and refine dashboards from conversational requests.
        </div>
      </details>
      <Modal
        title="Dashboard details"
        description="Title and description save automatically after you stop typing."
        open={editingMetadata}
        onOpenChange={(open) => {
          if (!open && metadataDirty) saveMetadata();
          setEditingMetadata(open);
        }}
      >
        <div className="stack">
          <label>
            Title
            <input
              value={metadataDraft.title}
              maxLength={300}
              onChange={(event) =>
                setMetadataDraft((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Description
            <textarea
              value={metadataDraft.description}
              maxLength={10000}
              rows={4}
              onChange={(event) =>
                setMetadataDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </label>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <small>{saving ? "Saving…" : metadataDirty ? "Waiting to save…" : "Saved"}</small>
            <button
              className="button"
              disabled={!metadataDraft.title.trim()}
              onClick={() => {
                if (metadataDirty) saveMetadata();
                setEditingMetadata(false);
              }}
            >
              Done
            </button>
          </div>
        </div>
      </Modal>
      <Modal
        title="Edit widget"
        description="Only the title and explanatory text are editable here. Data bindings remain validated."
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        {editing && (
          <WidgetEditor
            widget={editing}
            layout={spec.layouts.lg.find((item) => item.i === editing.id)!}
            onCancel={() => setEditing(null)}
            onSave={({ widget, layout }) => {
              const next = {
                ...spec,
                widgets: spec.widgets.map((item) =>
                  item.id === widget.id ? widget : item,
                ),
                layouts: {
                  lg: spec.layouts.lg.map((item) =>
                    item.i === widget.id ? layout : item,
                  ),
                },
              };
              setEditing(null);
              remember(spec);
              void save(next, "edit_widget");
            }}
          />
        )}
      </Modal>
      <Modal
        title="Version history"
        description="Restore a saved dashboard arrangement."
        open={!!versions}
        onOpenChange={(open) => {
          if (!open) setVersions(null);
        }}
      >
        <div>
          {versions?.map((version) => (
            <div className="version-row" key={version.version}>
              <div className="spacer">
                <strong>Version {version.version}</strong>
                <br />
                <small>
                  {version.reason} ·{" "}
                  {new Date(version.createdAt).toLocaleString()}
                </small>
              </div>
              <button
                className="button small"
                disabled={version.version === record.version}
                onClick={async () => {
                  try {
                    await saveQueue.current;
                    const value = await post<{ dashboard: DashboardRecord }>(
                      `/api/dashboards/${id}/restore`,
                      {
                        version: version.version,
                        expectedVersion: recordRef.current.version,
                      },
                    );
                    remember(spec);
                    recordRef.current = value.dashboard;
                    setRecord(value.dashboard);
                    setSpec(value.dashboard.spec);
                    setVersions(null);
                    cache.invalidateQueries({ queryKey: ["dashboard", id] });
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "Unable to restore version",
                    );
                  }
                }}
              >
                <RotateCcw size={13} />
                Restore
              </button>
            </div>
          ))}
        </div>
      </Modal>
      <Modal
        title="Context Inspector"
        description="Administrator view of the data, retrieval, queries, model usage, validation, and final dashboard schema."
        open={inspectorOpen}
        onOpenChange={(open) => {
          setInspectorOpen(open);
          if (!open) setContext(null);
        }}
        wide
      >
        {contextLoading ? (
          <Loading label="Loading context…" />
        ) : context ? (
          <pre className="inspector-pre">{JSON.stringify(context, null, 2)}</pre>
        ) : (
          <p>No generation context is available for this dashboard.</p>
        )}
      </Modal>
    </div>
  );
}
