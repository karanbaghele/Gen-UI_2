import type { Widget } from "./schema";

export type WidgetDefinition = {
  type: Widget["type"];
  component: string;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  requiresQuery: boolean;
  interactions: string[];
  accessibility: string;
  documentation: string;
};
const entry = (
  type: Widget["type"],
  component: string,
  w: number,
  h: number,
  minW: number,
  minH: number,
  requiresQuery: boolean,
  documentation: string,
  interactions: string[] = [],
): WidgetDefinition => ({
  type,
  component,
  defaultSize: { w, h },
  minSize: { w: minW, h: minH },
  requiresQuery,
  interactions,
  accessibility:
    "Visible title; keyboard-accessible controls; chart data available as a table; colors supplemented by labels.",
  documentation,
});

/** Renderer resolves these approved component names; this contract never contains executable code. */
export const componentRegistry: Record<Widget["type"], WidgetDefinition> = {
  kpi: entry(
    "kpi",
    "KpiWidget",
    3,
    2,
    2,
    2,
    true,
    "One deterministic ungrouped numeric metric. config.metric references a query metric ID; comparison is optional query data.",
  ),
  bar: entry(
    "bar",
    "BarWidget",
    6,
    4,
    3,
    3,
    true,
    "Categorical comparison. xKey is a grouped dimension; yKeys are metric IDs. orientation vertical or horizontal.",
    ["series legend", "data table"],
  ),
  line: entry(
    "line",
    "LineWidget",
    12,
    4,
    3,
    3,
    true,
    "Ordered trend. xKey is a grouped dimension, usually a bucketed date; yKeys are metric IDs.",
    ["series legend", "data table"],
  ),
  area: entry(
    "area",
    "AreaWidget",
    12,
    4,
    3,
    3,
    true,
    "Ordered magnitude trend. xKey is a grouped dimension; yKeys are metric IDs.",
    ["series legend", "data table"],
  ),
  donut: entry(
    "donut",
    "DonutWidget",
    4,
    4,
    3,
    3,
    true,
    "Parts of a whole: one categorical nameKey and a numeric nonnegative valueKey. Prefer few categories.",
    ["data table"],
  ),
  pie: entry(
    "pie",
    "PieWidget",
    4,
    4,
    3,
    3,
    true,
    "Parts of a whole: one categorical nameKey and a numeric nonnegative valueKey. Prefer few categories.",
    ["data table"],
  ),
  scatter: entry(
    "scatter",
    "ScatterWidget",
    6,
    4,
    3,
    3,
    true,
    "Relationship between numeric query metrics xKey and yKey; optional nameKey.",
    ["data table"],
  ),
  table: entry(
    "table",
    "TableWidget",
    12,
    5,
    3,
    3,
    true,
    "Bounded analytical results. columns must reference query outputs; pageSize defaults to 10.",
    ["sort", "paginate", "export"],
  ),
  text: entry(
    "text",
    "TextWidget",
    6,
    2,
    2,
    2,
    false,
    "Plain text or safe Markdown context. No HTML, executable code, or ungrounded quantitative insight.",
  ),
  insight: entry(
    "insight",
    "InsightWidget",
    4,
    3,
    2,
    2,
    true,
    "Grounded deterministic explanation. Choose total, largest, smallest, or comparison template and a numeric metric.",
  ),
  progress: entry(
    "progress",
    "ProgressWidget",
    4,
    3,
    2,
    2,
    true,
    "Actual-versus-target comparison. metric and targetField must both be numeric query outputs from real fields.",
  ),
  dateFilter: entry(
    "dateFilter",
    "DateFilterWidget",
    4,
    2,
    2,
    2,
    false,
    "References a dashboard date filter by config.filterId.",
    ["date range"],
  ),
  selectFilter: entry(
    "selectFilter",
    "SelectFilterWidget",
    3,
    2,
    2,
    2,
    false,
    "References a dashboard select filter by config.filterId.",
    ["select"],
  ),
  searchFilter: entry(
    "searchFilter",
    "SearchFilterWidget",
    4,
    2,
    2,
    2,
    false,
    "References a dashboard search filter by config.filterId.",
    ["search"],
  ),
  export: entry(
    "export",
    "ExportWidget",
    3,
    2,
    2,
    2,
    true,
    "Exports the authorized deterministic query result as formula-protected CSV.",
    ["export"],
  ),
};

export const registryDocumentation = Object.values(componentRegistry)
  .map(
    (item) =>
      `${item.type}: ${item.documentation} Default ${item.defaultSize.w}x${item.defaultSize.h}; minimum ${item.minSize.w}x${item.minSize.h}.`,
  )
  .join("\n");
