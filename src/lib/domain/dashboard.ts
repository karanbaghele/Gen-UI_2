import {
  dashboardPatchSchema,
  dashboardSchema,
  type DashboardFilter,
  type DashboardSpec,
  type Dataset,
  type Widget,
} from "./schema";
import {
  authorizedDataset,
  dashboardFilterToQueryFilter,
  validateFilter,
  validateQuery,
} from "./query";
import { autoPlace, validateLayout } from "./layout";
import { componentRegistry } from "./registry";
import { DomainError } from "./profiling";

const unique = (items: string[], what: string) => {
  if (new Set(items).size !== items.length)
    throw new DomainError(`${what} IDs must be unique.`);
};
export function validateDashboard(
  input: unknown,
  authorizedDatasets: Dataset[],
  workspaceId: string,
): DashboardSpec {
  const spec = dashboardSchema.parse(input);
  unique(spec.datasetIds, "Dataset");
  unique(
    spec.queries.map((query) => query.id),
    "Query",
  );
  unique(
    spec.widgets.map((widget) => widget.id),
    "Widget",
  );
  unique(
    spec.filters.map((filter) => filter.id),
    "Filter",
  );
  for (const datasetId of spec.datasetIds)
    authorizedDataset(datasetId, authorizedDatasets, workspaceId);
  for (const query of spec.queries) {
    if (!spec.datasetIds.includes(query.datasetId))
      throw new DomainError("Query dataset must be declared by the dashboard.");
    validateQuery(query, authorizedDatasets, workspaceId);
  }
  for (const filter of spec.filters)
    validateDashboardFilter(filter, spec, authorizedDatasets, workspaceId);
  for (const widget of spec.widgets)
    validateWidget(widget, spec, authorizedDatasets, workspaceId);
  validateLayout(spec.layouts.lg, spec.widgets);
  return spec;
}

function validateDashboardFilter(
  filter: DashboardFilter,
  spec: DashboardSpec,
  datasets: Dataset[],
  workspaceId: string,
) {
  if (!spec.datasetIds.includes(filter.datasetId))
    throw new DomainError("Filter dataset must be declared by the dashboard.");
  const dataset = authorizedDataset(filter.datasetId, datasets, workspaceId);
  const field = dataset.fields.find((field) => field.name === filter.field);
  if (!field)
    throw new DomainError("Dashboard filter references an unavailable field.");
  if (
    (filter.type === "date" && field.type !== "date") ||
    (filter.type === "search" && field.type !== "string")
  )
    throw new DomainError(
      "Dashboard filter type is incompatible with its field.",
    );
  unique(filter.queryIds, "Linked query");
  for (const queryId of filter.queryIds) {
    const query = spec.queries.find((query) => query.id === queryId);
    if (!query || query.datasetId !== filter.datasetId)
      throw new DomainError(
        "Filters may link only to queries on the same dataset.",
      );
  }
  if (filter.defaultValue !== undefined) {
    const queryFilter = dashboardFilterToQueryFilter(
      filter,
      filter.defaultValue,
    );
    if (queryFilter) validateFilter(queryFilter, dataset);
  }
}

function validateWidget(
  widget: Widget,
  spec: DashboardSpec,
  datasets: Dataset[],
  workspaceId: string,
): void {
  const definition = componentRegistry[widget.type];
  const query = widget.queryId
    ? spec.queries.find((query) => query.id === widget.queryId)
    : undefined;
  if ((definition.requiresQuery && !query) || (widget.queryId && !query))
    throw new DomainError(
      `Widget “${widget.title}” references an unavailable query.`,
    );
  if (
    widget.type === "dateFilter" ||
    widget.type === "selectFilter" ||
    widget.type === "searchFilter"
  ) {
    const filter = spec.filters.find(
      (filter) => filter.id === widget.config.filterId,
    );
    if (!filter || `${filter.type}Filter` !== widget.type)
      throw new DomainError(
        "Filter widget references an incompatible dashboard filter.",
      );
  }
  if (!query) return;
  const dataset = authorizedDataset(query.datasetId, datasets, workspaceId);
  const dimensions = query.groupBy.map((group) => group.field),
    metrics = query.metrics.map((metric) => metric.id);
  const columns = [...dimensions, ...metrics];
  const output = (key: string) => {
    if (!columns.includes(key))
      throw new DomainError(
        `Widget references unavailable query output “${key}”.`,
      );
  };
  const numeric = (key: string) => {
    output(key);
    const metric = query.metrics.find((metric) => metric.id === key);
    if (!metric || metric.op === "min" || metric.op === "max") {
      const fieldName = metric?.field ?? key;
      if (
        dataset.fields.find((field) => field.name === fieldName)?.type !==
        "number"
      )
        throw new DomainError(`Widget requires a numeric output for “${key}”.`);
    }
  };
  switch (widget.type) {
    case "kpi":
      numeric(widget.config.metric);
      if (query.groupBy.length)
        throw new DomainError(
          "KPI queries must return an ungrouped aggregate.",
        );
      break;
    case "bar":
    case "line":
    case "area":
      output(widget.config.xKey);
      if (!dimensions.includes(widget.config.xKey))
        throw new DomainError("Chart xKey must be a grouped dimension.");
      widget.config.yKeys.forEach(numeric);
      break;
    case "donut":
    case "pie":
      output(widget.config.nameKey);
      numeric(widget.config.valueKey);
      if (!dimensions.includes(widget.config.nameKey))
        throw new DomainError(
          "Part-to-whole chart labels require a grouped dimension.",
        );
      break;
    case "scatter":
      numeric(widget.config.xKey);
      numeric(widget.config.yKey);
      if (widget.config.nameKey) output(widget.config.nameKey);
      break;
    case "table":
      widget.config.columns.forEach(output);
      break;
    case "insight":
      numeric(widget.config.metric);
      if (widget.config.template === "comparison" && !query.comparison)
        throw new DomainError(
          "Comparison insights require explicit comparison periods.",
        );
      break;
    case "progress":
      numeric(widget.config.metric);
      numeric(widget.config.targetField);
      if (query.groupBy.length)
        throw new DomainError("Progress queries require ungrouped metrics.");
      break;
  }
}

/** Applies a patch on a clone and validates the whole result. Failure cannot mutate the original. */
export function applyDashboardPatch(
  spec: DashboardSpec,
  input: unknown,
  authorizedDatasets: Dataset[],
  workspaceId: string,
): DashboardSpec {
  const patch = dashboardPatchSchema.parse(input);
  const next = structuredClone(
    validateDashboard(spec, authorizedDatasets, workspaceId),
  );
  for (const operation of patch) {
    switch (operation.op) {
      case "addWidget": {
        if (next.widgets.some((widget) => widget.id === operation.widget.id))
          throw new DomainError("Cannot add a widget with an existing ID.");
        next.widgets.push(operation.widget);
        if (operation.layout && operation.layout.i !== operation.widget.id)
          throw new DomainError("New widget layout ID must match its widget.");
        next.layouts.lg.push(
          operation.layout ?? autoPlace(next.layouts.lg, operation.widget),
        );
        break;
      }
      case "removeWidget":
        if (!next.widgets.some((widget) => widget.id === operation.widgetId))
          throw new DomainError("Cannot remove an unavailable widget.");
        next.widgets = next.widgets.filter(
          (widget) => widget.id !== operation.widgetId,
        );
        next.layouts.lg = next.layouts.lg.filter(
          (item) => item.i !== operation.widgetId,
        );
        break;
      case "updateWidget": {
        const index = next.widgets.findIndex(
          (widget) => widget.id === operation.widget.id,
        );
        if (index < 0)
          throw new DomainError("Cannot update an unavailable widget.");
        next.widgets[index] = operation.widget;
        break;
      }
      case "moveWidget":
      case "resizeWidget": {
        const item = next.layouts.lg.find(
          (item) => item.i === operation.widgetId,
        );
        if (!item)
          throw new DomainError("Cannot change an unavailable widget layout.");
        if (item.static)
          throw new DomainError(
            "Unlock this widget before moving or resizing it.",
          );
        if (operation.op === "moveWidget") {
          item.x = operation.x;
          item.y = operation.y;
        } else {
          item.w = operation.w;
          item.h = operation.h;
        }
        break;
      }
      case "updateQuery": {
        const index = next.queries.findIndex(
          (query) => query.id === operation.query.id,
        );
        if (index < 0) next.queries.push(operation.query);
        else next.queries[index] = operation.query;
        break;
      }
      case "removeQuery":
        if (!next.queries.some((query) => query.id === operation.queryId))
          throw new DomainError("Cannot remove an unavailable query.");
        next.queries = next.queries.filter(
          (query) => query.id !== operation.queryId,
        );
        break;
      case "updateFilter": {
        const index = next.filters.findIndex(
          (filter) => filter.id === operation.filter.id,
        );
        if (index < 0) next.filters.push(operation.filter);
        else next.filters[index] = operation.filter;
        break;
      }
      case "removeFilter":
        if (!next.filters.some((filter) => filter.id === operation.filterId))
          throw new DomainError("Cannot remove an unavailable filter.");
        next.filters = next.filters.filter(
          (filter) => filter.id !== operation.filterId,
        );
        break;
      case "updateMetadata":
        if (operation.title !== undefined) next.title = operation.title;
        if (operation.description !== undefined)
          next.description = operation.description;
    }
  }
  return validateDashboard(next, authorizedDatasets, workspaceId);
}
