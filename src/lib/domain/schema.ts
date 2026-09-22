import { z } from "zod";

/** Browser-safe, versioned analytical contract. Missing cells are absent keys; null is explicit. */
export const scalarSchema = z.union([
  z.string().max(20_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export type DataValue = z.infer<typeof scalarSchema>;
export type DataRow = Record<string, DataValue>;
const id = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9_-]+$/);
const fieldName = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) => !["__proto__", "constructor", "prototype"].includes(value),
    "Reserved field name",
  );
const label = z
  .string()
  .min(1)
  .max(300)
  .refine((value) => !/<\/?[a-z][^>]*>/i.test(value), "HTML is not allowed");
const prose = z
  .string()
  .max(10_000)
  .refine(
    (value) =>
      !/<\/?[a-z][^>]*>/i.test(value) &&
      !/\]\(\s*(?:javascript|data|vbscript):/i.test(value),
    "Unsafe markup is not allowed",
  );

export const fieldSchema = z.strictObject({
  name: fieldName,
  type: z.enum(["string", "number", "boolean", "date"]),
  semantic: z.enum([
    "measure",
    "dimension",
    "identifier",
    "currency",
    "percentage",
  ]),
  nullable: z.boolean(),
  unit: z.string().max(30).optional(),
  allowedAggregations: z.array(
    z.enum(["sum", "count", "distinctCount", "avg", "min", "max"]),
  ),
  stats: z.strictObject({
    nullCount: z.number().int().nonnegative(),
    missingCount: z.number().int().nonnegative(),
    distinctCount: z.number().int().nonnegative(),
    min: scalarSchema.optional(),
    max: scalarSchema.optional(),
    examples: z.array(scalarSchema).max(8),
  }),
});
export type DatasetField = z.infer<typeof fieldSchema>;
export const datasetSchema = z.strictObject({
  id,
  workspaceId: id,
  sourceId: id,
  name: label,
  sourceType: z.enum(["csv", "sample", "google_sheets", "postgresql"]),
  fields: z.array(fieldSchema).min(1).max(200),
  rows: z.array(z.record(fieldName, scalarSchema)).max(100_000),
  rowCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  warnings: z.array(z.string()).default([]),
});
export type Dataset = z.infer<typeof datasetSchema>;

export const queryFilterSchema = z.strictObject({
  field: fieldName,
  op: z.enum([
    "eq",
    "neq",
    "in",
    "notIn",
    "gt",
    "gte",
    "lt",
    "lte",
    "between",
    "contains",
    "isNull",
    "isMissing",
  ]),
  value: z.union([scalarSchema, z.array(scalarSchema).max(200)]).optional(),
});
export type QueryFilter = z.infer<typeof queryFilterSchema>;
export const metricSchema = z
  .strictObject({
    id,
    op: z.enum(["sum", "count", "distinctCount", "avg", "min", "max"]),
    field: fieldName.optional(),
    derived: z.literal("profit").optional(),
  })
  .superRefine((value, ctx) => {
    if (value.field && value.derived)
      ctx.addIssue({
        code: "custom",
        message: "Choose field or approved derived metric, not both",
      });
    if (value.op !== "count" && !value.field && !value.derived)
      ctx.addIssue({
        code: "custom",
        message: "Metric needs a field or approved derivation",
      });
  });
export type Metric = z.infer<typeof metricSchema>;
const dateRangeSchema = z
  .strictObject({ start: z.iso.date(), end: z.iso.date() })
  .refine(
    (value) => value.start <= value.end,
    "Period start must not follow end",
  );
export const querySchema = z.strictObject({
  id,
  datasetId: id,
  metrics: z.array(metricSchema).min(1).max(20),
  groupBy: z
    .array(
      z.strictObject({
        field: fieldName,
        bucket: z.enum(["day", "week", "month", "quarter", "year"]).optional(),
      }),
    )
    .max(6)
    .default([]),
  filters: z.array(queryFilterSchema).max(30).default([]),
  orderBy: z
    .array(
      z.strictObject({ field: fieldName, direction: z.enum(["asc", "desc"]) }),
    )
    .max(6)
    .default([]),
  limit: z.number().int().min(1).max(1000).default(200),
  comparison: z
    .strictObject({
      dateField: fieldName,
      current: dateRangeSchema,
      previous: dateRangeSchema,
    })
    .optional(),
});
export type AnalyticalQuery = z.infer<typeof querySchema>;

const formatSchema = z.enum(["number", "currency", "percent", "compact"]);
const widgetBase = {
  id,
  title: label,
  queryId: id.optional(),
  description: prose.optional(),
};
const chartConfig = z.strictObject({
  xKey: fieldName,
  yKeys: z.array(fieldName).min(1).max(8),
  format: formatSchema.optional(),
  stacked: z.boolean().optional(),
  orientation: z.enum(["vertical", "horizontal"]).optional(),
});
export const widgetSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...widgetBase,
    type: z.literal("kpi"),
    config: z.strictObject({
      metric: fieldName,
      format: formatSchema.optional(),
      prefix: z.string().max(8).optional(),
      suffix: z.string().max(12).optional(),
    }),
  }),
  z.strictObject({
    ...widgetBase,
    type: z.literal("bar"),
    config: chartConfig,
  }),
  z.strictObject({
    ...widgetBase,
    type: z.literal("line"),
    config: chartConfig,
  }),
  z.strictObject({
    ...widgetBase,
    type: z.literal("area"),
    config: chartConfig,
  }),
  z.strictObject({
    ...widgetBase,
    type: z.literal("donut"),
    config: z.strictObject({
      nameKey: fieldName,
      valueKey: fieldName,
      format: formatSchema.optional(),
    }),
  }),
  z.strictObject({
    ...widgetBase,
    type: z.literal("pie"),
    config: z.strictObject({
      nameKey: fieldName,
      valueKey: fieldName,
      format: formatSchema.optional(),
    }),
  }),
  z.strictObject({
    ...widgetBase,
    type: z.literal("scatter"),
    config: z.strictObject({
      xKey: fieldName,
      yKey: fieldName,
      nameKey: fieldName.optional(),
    }),
  }),
  z.strictObject({
    ...widgetBase,
    type: z.literal("table"),
    config: z.strictObject({
      columns: z.array(fieldName).min(1).max(30),
      pageSize: z.number().int().min(5).max(100).default(10),
    }),
  }),
  z.strictObject({
    ...widgetBase,
    type: z.literal("text"),
    config: z.strictObject({ content: prose }),
  }),
  z.strictObject({
    ...widgetBase,
    type: z.literal("insight"),
    config: z.strictObject({
      metric: fieldName,
      template: z.enum(["total", "largest", "smallest", "comparison"]),
      format: formatSchema.optional(),
    }),
  }),
  z.strictObject({
    ...widgetBase,
    type: z.literal("progress"),
    config: z.strictObject({
      metric: fieldName,
      targetField: fieldName,
      format: formatSchema.optional(),
    }),
  }),
  z.strictObject({
    ...widgetBase,
    type: z.literal("dateFilter"),
    config: z.strictObject({ filterId: id }),
  }),
  z.strictObject({
    ...widgetBase,
    type: z.literal("selectFilter"),
    config: z.strictObject({ filterId: id }),
  }),
  z.strictObject({
    ...widgetBase,
    type: z.literal("searchFilter"),
    config: z.strictObject({ filterId: id }),
  }),
  z.strictObject({
    ...widgetBase,
    type: z.literal("export"),
    config: z.strictObject({ label: label.optional() }),
  }),
]);
export type Widget = z.infer<typeof widgetSchema>;
export const dashboardFilterSchema = z.strictObject({
  id,
  type: z.enum(["date", "select", "search"]),
  label,
  datasetId: id,
  field: fieldName,
  queryIds: z.array(id).min(1).max(100),
  defaultValue: z
    .union([scalarSchema, z.array(scalarSchema).max(200)])
    .optional(),
});
export type DashboardFilter = z.infer<typeof dashboardFilterSchema>;
export const layoutItemSchema = z.strictObject({
  i: id,
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(10_000),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(50),
  static: z.boolean().optional(),
});
export type LayoutItem = z.infer<typeof layoutItemSchema>;
export const dashboardSchema = z.strictObject({
  schemaVersion: z.literal(1),
  title: label,
  description: prose,
  datasetIds: z.array(id).min(1).max(10),
  queries: z.array(querySchema).min(1).max(100),
  widgets: z.array(widgetSchema).min(1).max(60),
  filters: z.array(dashboardFilterSchema).max(20),
  layouts: z.strictObject({ lg: z.array(layoutItemSchema).min(1).max(60) }),
});
export type DashboardSpec = z.infer<typeof dashboardSchema>;

export type QueryResult = {
  queryId: string;
  columns: string[];
  rows: DataRow[];
  rowCount: number;
  comparison?: Record<
    string,
    {
      current: number | null;
      previous: number | null;
      absoluteChange: number | null;
      percentChange: number | null;
    }
  >;
};

export const dashboardPatchSchema = z
  .array(
    z.discriminatedUnion("op", [
      z.strictObject({
        op: z.literal("addWidget"),
        widget: widgetSchema,
        layout: layoutItemSchema.optional(),
      }),
      z.strictObject({ op: z.literal("removeWidget"), widgetId: id }),
      z.strictObject({ op: z.literal("updateWidget"), widget: widgetSchema }),
      z.strictObject({
        op: z.literal("moveWidget"),
        widgetId: id,
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
      }),
      z.strictObject({
        op: z.literal("resizeWidget"),
        widgetId: id,
        w: z.number().int().positive(),
        h: z.number().int().positive(),
      }),
      z.strictObject({ op: z.literal("updateQuery"), query: querySchema }),
      z.strictObject({ op: z.literal("removeQuery"), queryId: id }),
      z.strictObject({
        op: z.literal("updateFilter"),
        filter: dashboardFilterSchema,
      }),
      z.strictObject({ op: z.literal("removeFilter"), filterId: id }),
      z.strictObject({
        op: z.literal("updateMetadata"),
        title: label.optional(),
        description: prose.optional(),
      }),
    ]),
  )
  .min(1)
  .max(40);
export type DashboardPatch = z.infer<typeof dashboardPatchSchema>;
