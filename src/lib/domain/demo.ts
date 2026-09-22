import type {
  AnalyticalQuery,
  DashboardPatch,
  DashboardSpec,
  Dataset,
  Widget,
} from "./schema";
import { applyDashboardPatch, validateDashboard } from "./dashboard";
import { autoPlace } from "./layout";
import { DomainError } from "./profiling";

function query(
  id: string,
  datasetId: string,
  values: Partial<AnalyticalQuery>,
): AnalyticalQuery {
  return {
    id,
    datasetId,
    metrics: [{ id: "value", op: "count" }],
    groupBy: [],
    filters: [],
    orderBy: [],
    limit: 200,
    ...values,
  };
}

/** Explicit deterministic onboarding, separate from AI generation and never described as a provider response. */
export function createDemoDashboard(dataset: Dataset): DashboardSpec {
  const fields = new Set(dataset.fields.map((field) => field.name));
  const sales = [
    "revenue",
    "cost",
    "order_date",
    "region",
    "product",
    "customer_id",
  ].every((field) => fields.has(field));
  const queries: AnalyticalQuery[] = [];
  const widgets: Widget[] = [];
  if (sales) {
    queries.push(
      query("totals", dataset.id, {
        metrics: [
          { id: "revenue", op: "sum", field: "revenue" },
          { id: "profit", op: "sum", derived: "profit" },
          { id: "orders", op: "count" },
        ],
      }),
      query("monthly", dataset.id, {
        metrics: [
          { id: "revenue", op: "sum", field: "revenue" },
          { id: "profit", op: "sum", derived: "profit" },
        ],
        groupBy: [{ field: "order_date", bucket: "month" }],
        orderBy: [{ field: "order_date", direction: "asc" }],
      }),
      query("regions", dataset.id, {
        metrics: [
          { id: "revenue", op: "sum", field: "revenue" },
          { id: "profit", op: "sum", derived: "profit" },
        ],
        groupBy: [{ field: "region" }],
        orderBy: [{ field: "revenue", direction: "desc" }],
      }),
      query("products", dataset.id, {
        metrics: [{ id: "revenue", op: "sum", field: "revenue" }],
        groupBy: [{ field: "product" }],
        orderBy: [{ field: "revenue", direction: "desc" }],
        limit: 8,
      }),
    );
    widgets.push(
      {
        id: "revenue-kpi",
        type: "kpi",
        title: "Total revenue",
        queryId: "totals",
        config: { metric: "revenue", format: "currency" },
      },
      {
        id: "profit-kpi",
        type: "kpi",
        title: "Total profit",
        queryId: "totals",
        config: { metric: "profit", format: "currency" },
      },
      {
        id: "orders-kpi",
        type: "kpi",
        title: "Orders",
        queryId: "totals",
        config: { metric: "orders", format: "number" },
      },
    );
    const dates = dataset.rows
      .map((row) => row.order_date)
      .filter((value): value is string => typeof value === "string")
      .sort();
    if (dates.length) {
      const latest = new Date(`${dates.at(-1)!.slice(0, 10)}T00:00:00Z`);
      const monthStart = new Date(
        Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth(), 1),
      );
      const priorStart = new Date(
        Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth() - 1, 1),
      );
      const priorEnd = new Date(monthStart.getTime() - 86_400_000);
      queries.push(
        query("latest-month", dataset.id, {
          metrics: [{ id: "revenue", op: "sum", field: "revenue" }],
          comparison: {
            dateField: "order_date",
            current: {
              start: monthStart.toISOString().slice(0, 10),
              end: dates.at(-1)!.slice(0, 10),
            },
            previous: {
              start: priorStart.toISOString().slice(0, 10),
              end: priorEnd.toISOString().slice(0, 10),
            },
          },
        }),
      );
      widgets.push({
        id: "latest-month-kpi",
        type: "kpi",
        title: "Latest month revenue",
        queryId: "latest-month",
        description:
          "Compared with the previous calendar month. No comparison is shown when prior data is unavailable.",
        config: { metric: "revenue", format: "currency" },
      });
    }
    widgets.push(
      {
        id: "monthly-chart",
        type: "area",
        title: "Revenue & profit over time",
        queryId: "monthly",
        config: {
          xKey: "order_date",
          yKeys: ["revenue", "profit"],
          format: "currency",
        },
      },
      {
        id: "regional-chart",
        type: "bar",
        title: "Regional performance",
        queryId: "regions",
        config: {
          xKey: "region",
          yKeys: ["revenue"],
          orientation: "horizontal",
          format: "currency",
        },
      },
      {
        id: "product-chart",
        type: "bar",
        title: "Strongest products",
        queryId: "products",
        config: {
          xKey: "product",
          yKeys: ["revenue"],
          orientation: "horizontal",
          format: "currency",
        },
      },
      {
        id: "regional-table",
        type: "table",
        title: "Regional detail",
        queryId: "regions",
        config: { columns: ["region", "revenue", "profit"], pageSize: 10 },
      },
    );
  } else {
    const measure = dataset.fields.find(
      (field) =>
        field.type === "number" && field.allowedAggregations.includes("sum"),
    );
    const category = dataset.fields.find(
      (field) => field.type === "string" && field.semantic === "dimension",
    );
    queries.push(
      query("overview", dataset.id, {
        metrics: [
          { id: "rows", op: "count" },
          ...(measure
            ? [{ id: "total", op: "sum" as const, field: measure.name }]
            : []),
        ],
      }),
    );
    widgets.push({
      id: "row-count",
      type: "kpi",
      title: "Total records",
      queryId: "overview",
      config: { metric: "rows", format: "number" },
    });
    if (measure)
      widgets.push({
        id: "measure-total",
        type: "kpi",
        title: `Total ${measure.name}`,
        queryId: "overview",
        config: {
          metric: "total",
          format: measure.semantic === "currency" ? "currency" : "number",
        },
      });
    if (category) {
      queries.push(
        query("breakdown", dataset.id, {
          groupBy: [{ field: category.name }],
          metrics: measure
            ? [{ id: "value", op: "sum", field: measure.name }]
            : [{ id: "value", op: "count" }],
          orderBy: [{ field: "value", direction: "desc" }],
          limit: 20,
        }),
      );
      widgets.push({
        id: "breakdown-chart",
        type: "bar",
        title: `By ${category.name}`,
        queryId: "breakdown",
        config: {
          xKey: category.name,
          yKeys: ["value"],
          orientation: "horizontal",
        },
      });
      widgets.push({
        id: "breakdown-table",
        type: "table",
        title: "Detailed breakdown",
        queryId: "breakdown",
        config: { columns: [category.name, "value"], pageSize: 10 },
      });
    }
  }
  const layout: DashboardSpec["layouts"]["lg"] = [];
  for (const widget of widgets) layout.push(autoPlace(layout, widget));
  const spec: DashboardSpec = {
    schemaVersion: 1,
    title: sales ? "Executive sales overview" : `${dataset.name} overview`,
    description:
      "Sample dashboard — created by the deterministic onboarding template. Values are computed from the selected dataset.",
    datasetIds: [dataset.id],
    queries,
    widgets,
    layouts: { lg: layout },
    filters: sales
      ? [
          {
            id: "region-filter",
            type: "select",
            label: "Region",
            datasetId: dataset.id,
            field: "region",
            queryIds: queries.map((query) => query.id),
          },
          {
            id: "date-filter",
            type: "date",
            label: "Order date",
            datasetId: dataset.id,
            field: "order_date",
            queryIds: queries.map((query) => query.id),
          },
        ]
      : [],
  };
  return validateDashboard(spec, [dataset], dataset.workspaceId);
}

export function createDemoRefinementPatch(
  spec: DashboardSpec,
  prompt: string,
  datasets: Dataset[],
  workspaceId: string,
): DashboardPatch {
  validateDashboard(spec, datasets, workspaceId);
  if (
    !/remove.*product/i.test(prompt) ||
    !/(?:top\s*20|customers)/i.test(prompt)
  )
    throw new DomainError(
      "The sample refinement supports: Remove the product chart and add a table of the top 20 customers by revenue below the regional chart. Use a configured AI provider for other requests.",
    );
  const product = spec.widgets.find((widget) => widget.id === "product-chart");
  const region = spec.widgets.find((widget) => widget.id === "regional-chart");
  const dataset = datasets.find(
    (dataset) =>
      spec.datasetIds.includes(dataset.id) &&
      dataset.workspaceId === workspaceId &&
      dataset.fields.some((field) => field.name === "customer_id") &&
      dataset.fields.some((field) => field.name === "revenue"),
  );
  if (!product || !region || !dataset)
    throw new DomainError(
      "This sample refinement requires the sales product and regional charts with customer and revenue data.",
    );
  const widget: Widget = {
    id: "top-customers-table",
    type: "table",
    title: "Top 20 customers by revenue",
    queryId: "top-customers",
    config: { columns: ["customer_id", "revenue", "orders"], pageSize: 10 },
  };
  const customerQuery = query("top-customers", dataset.id, {
    metrics: [
      { id: "revenue", op: "sum", field: "revenue" },
      { id: "orders", op: "count" },
    ],
    groupBy: [{ field: "customer_id" }],
    orderBy: [{ field: "revenue", direction: "desc" }],
    limit: 20,
  });
  const remaining = spec.layouts.lg.filter((item) => item.i !== product.id);
  return [
    { op: "removeWidget", widgetId: product.id },
    { op: "updateQuery", query: customerQuery },
    {
      op: "addWidget",
      widget,
      layout: autoPlace(remaining, widget, { belowWidgetId: region.id }),
    },
    ...spec.filters
      .filter((filter) => filter.datasetId === dataset.id)
      .map((filter) => ({
        op: "updateFilter" as const,
        filter: { ...filter, queryIds: [...filter.queryIds, customerQuery.id] },
      })),
  ];
}

export function refineDemoDashboard(
  spec: DashboardSpec,
  prompt: string,
  datasets: Dataset[],
  workspaceId: string,
): DashboardSpec {
  return applyDashboardPatch(
    spec,
    createDemoRefinementPatch(spec, prompt, datasets, workspaceId),
    datasets,
    workspaceId,
  );
}
