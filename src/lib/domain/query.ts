import {
  queryFilterSchema,
  querySchema,
  type AnalyticalQuery,
  type DashboardFilter,
  type Dataset,
  type DataRow,
  type DataValue,
  type Metric,
  type QueryFilter,
  type QueryResult,
} from "./schema";
import { DomainError } from "./profiling";

/** Scope is checked before schema metadata or rows are read. The caller supplies server-authorized datasets. */
export function authorizedDataset(
  datasetId: string,
  datasets: Dataset[],
  workspaceId: string,
): Dataset {
  const dataset = datasets.find(
    (item) => item.id === datasetId && item.workspaceId === workspaceId,
  );
  if (!dataset)
    throw new DomainError(
      "The requested dataset is unavailable in this workspace.",
    );
  return dataset;
}

export function validateQuery(
  input: unknown,
  datasets: Dataset[],
  workspaceId: string,
): AnalyticalQuery {
  const query = querySchema.parse(input);
  const dataset = authorizedDataset(query.datasetId, datasets, workspaceId);
  const field = (name: string) => {
    const found = dataset.fields.find((item) => item.name === name);
    if (!found)
      throw new DomainError(
        `Field “${name}” is unavailable in the selected dataset.`,
      );
    return found;
  };
  const keys = [
    ...query.metrics.map((metric) => metric.id),
    ...query.groupBy.map((group) => group.field),
  ];
  if (new Set(keys).size !== keys.length)
    throw new DomainError("Query output names must be unique.");
  for (const metric of query.metrics) {
    if (metric.derived === "profit") {
      const revenue = field("revenue"),
        cost = field("cost");
      if (
        revenue.type !== "number" ||
        cost.type !== "number" ||
        !revenue.allowedAggregations.includes("sum") ||
        !cost.allowedAggregations.includes("sum")
      )
        throw new DomainError(
          "Profit requires numeric additive revenue and cost fields.",
        );
      if (revenue.unit !== cost.unit)
        throw new DomainError(
          "Profit requires revenue and cost in the same unit.",
        );
    } else if (
      metric.field &&
      !field(metric.field).allowedAggregations.includes(metric.op)
    ) {
      throw new DomainError(
        `Aggregation ${metric.op} is not approved for “${metric.field}”.`,
      );
    }
  }
  for (const group of query.groupBy)
    if (group.bucket && field(group.field).type !== "date")
      throw new DomainError(
        "Date bucketing requires an unambiguous date field.",
      );
    else field(group.field);
  for (const filter of query.filters) validateFilter(filter, dataset);
  for (const sort of query.orderBy)
    if (!keys.includes(sort.field))
      throw new DomainError("Sorting must reference a query output column.");
  if (query.comparison) {
    if (field(query.comparison.dateField).type !== "date")
      throw new DomainError("Period comparison requires a date field.");
    if (query.groupBy.length)
      throw new DomainError(
        "Period comparisons currently support ungrouped metrics only.",
      );
    if (!(
      query.comparison.current.end < query.comparison.previous.start ||
      query.comparison.previous.end < query.comparison.current.start
    ))
      throw new DomainError("Comparison periods must not overlap.");
  }
  return query;
}

export function validateFilter(input: unknown, dataset: Dataset): QueryFilter {
  const filter = queryFilterSchema.parse(input);
  const field = dataset.fields.find((item) => item.name === filter.field);
  if (!field)
    throw new DomainError(`Filter field “${filter.field}” is unavailable.`);
  if (filter.op === "isNull" || filter.op === "isMissing") {
    if (filter.value !== undefined)
      throw new DomainError("Null/missing filters do not accept a value.");
    return filter;
  }
  if (filter.value === undefined)
    throw new DomainError("Filter requires a value.");
  const arrayOp = ["in", "notIn", "between"].includes(filter.op);
  if (arrayOp !== Array.isArray(filter.value))
    throw new DomainError("Filter value has the wrong shape.");
  const values = Array.isArray(filter.value) ? filter.value : [filter.value];
  if (filter.op === "between" && values.length !== 2)
    throw new DomainError("Range filters require two endpoints.");
  if (filter.op === "contains" && field.type !== "string")
    throw new DomainError("Search requires a text field.");
  for (const value of values) {
    if (value === null) {
      if (!["eq", "neq", "in", "notIn"].includes(filter.op))
        throw new DomainError("This filter does not accept null.");
      continue;
    }
    const valid =
      field.type === "date"
        ? typeof value === "string" &&
          /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) &&
          Number.isFinite(Date.parse(value))
        : typeof value === field.type;
    if (!valid)
      throw new DomainError(
        `Filter value must match the type of “${filter.field}”.`,
      );
  }
  if (
    ["gt", "gte", "lt", "lte", "between"].includes(filter.op) &&
    !["date", "number"].includes(field.type)
  )
    throw new DomainError("Range comparisons require a numeric or date field.");
  if (filter.op === "between" && compareValues(values[0], values[1]) > 0)
    throw new DomainError("Range start must not follow range end.");
  return filter;
}

function compareValues(
  a: DataValue | undefined,
  b: DataValue | undefined,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b));
}
function matches(row: DataRow, filter: QueryFilter, dataset: Dataset): boolean {
  if (filter.op === "isMissing") return !Object.hasOwn(row, filter.field);
  if (filter.op === "isNull")
    return Object.hasOwn(row, filter.field) && row[filter.field] === null;
  if (!Object.hasOwn(row, filter.field)) return false;
  let value = row[filter.field];
  let expected = filter.value!;
  const isDate =
    dataset.fields.find((field) => field.name === filter.field)?.type ===
    "date";
  if (isDate && typeof value === "string") {
    const shortDates = (Array.isArray(expected) ? expected : [expected]).every(
      (item) => typeof item !== "string" || item.length === 10,
    );
    if (shortDates) value = value.slice(0, 10);
    else {
      value = Date.parse(value);
      expected = Array.isArray(expected)
        ? expected.map((item) =>
            typeof item === "string" ? Date.parse(item) : item,
          )
        : typeof expected === "string"
          ? Date.parse(expected)
          : expected;
    }
  }
  switch (filter.op) {
    case "eq":
      return value === expected;
    case "neq":
      return value !== expected;
    case "in":
      return (expected as DataValue[]).includes(value);
    case "notIn":
      return !(expected as DataValue[]).includes(value);
    case "contains":
      return (
        typeof value === "string" &&
        value.toLocaleLowerCase().includes(String(expected).toLocaleLowerCase())
      );
    case "gt":
      return value !== null && compareValues(value, expected as DataValue) > 0;
    case "gte":
      return value !== null && compareValues(value, expected as DataValue) >= 0;
    case "lt":
      return value !== null && compareValues(value, expected as DataValue) < 0;
    case "lte":
      return value !== null && compareValues(value, expected as DataValue) <= 0;
    case "between":
      return (
        value !== null &&
        compareValues(value, (expected as DataValue[])[0]) >= 0 &&
        compareValues(value, (expected as DataValue[])[1]) <= 0
      );
  }
}
function bucketDate(
  value: string,
  bucket: NonNullable<AnalyticalQuery["groupBy"][number]["bucket"]>,
): string {
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (bucket === "year") return `${date.getUTCFullYear()}-01-01`;
  if (bucket === "quarter")
    return `${date.getUTCFullYear()}-${String(Math.floor(date.getUTCMonth() / 3) * 3 + 1).padStart(2, "0")}-01`;
  if (bucket === "month") return date.toISOString().slice(0, 7) + "-01";
  if (bucket === "week")
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
function metricValue(row: DataRow, metric: Metric): DataValue | undefined {
  if (metric.derived === "profit")
    return typeof row.revenue === "number" && typeof row.cost === "number"
      ? row.revenue - row.cost
      : null;
  return metric.field ? row[metric.field] : 1;
}
function aggregate(rows: DataRow[], metric: Metric): DataValue {
  const values = rows
    .map((row) => metricValue(row, metric))
    .filter(
      (value): value is Exclude<DataValue, null> =>
        value !== null && value !== undefined,
    );
  if (metric.op === "count") return values.length;
  if (metric.op === "distinctCount")
    return new Set(values.map((value) => JSON.stringify(value))).size;
  if (!values.length) return null;
  if (metric.op === "min" || metric.op === "max")
    return values.reduce((result, value) =>
      (
        metric.op === "min"
          ? compareValues(value, result) < 0
          : compareValues(value, result) > 0
      )
        ? value
        : result,
    );
  if (!values.every((value) => typeof value === "number"))
    throw new DomainError("This aggregate requires numeric values.");
  // Compensated summation avoids accumulating ordinary decimal rounding error.
  let sum = 0,
    correction = 0;
  for (const value of values) {
    const adjusted = value - correction;
    const next = sum + adjusted;
    correction = next - sum - adjusted;
    sum = next;
  }
  const result = metric.op === "avg" ? sum / values.length : sum;
  if (!Number.isFinite(result))
    throw new DomainError("The aggregate exceeds supported numeric precision.");
  return result;
}

export function executeQuery(
  input: unknown,
  authorizedDatasets: Dataset[],
  workspaceId: string,
  extraFilters: QueryFilter[] = [],
): QueryResult {
  const query = validateQuery(input, authorizedDatasets, workspaceId);
  const dataset = authorizedDataset(
    query.datasetId,
    authorizedDatasets,
    workspaceId,
  );
  if (extraFilters.length > 30)
    throw new DomainError("Too many active filters.");
  const filters = [
    ...query.filters,
    ...extraFilters.map((filter) => validateFilter(filter, dataset)),
  ];
  const filtered = dataset.rows.filter((row) =>
    filters.every((filter) => matches(row, filter, dataset)),
  );
  let selected = filtered;
  const inPeriod = (row: DataRow, period: { start: string; end: string }) => {
    const value = row[query.comparison!.dateField];
    return (
      typeof value === "string" &&
      value.slice(0, 10) >= period.start &&
      value.slice(0, 10) <= period.end
    );
  };
  if (query.comparison)
    selected = filtered.filter((row) =>
      inPeriod(row, query.comparison!.current),
    );
  const groups = new Map<string, { dimensions: DataRow; rows: DataRow[] }>();
  if (!query.groupBy.length)
    groups.set("total", { dimensions: {}, rows: selected });
  else
    for (const row of selected) {
      const dimensions: DataRow = {};
      for (const group of query.groupBy)
        if (Object.hasOwn(row, group.field)) {
          const value = row[group.field];
          dimensions[group.field] =
            group.bucket && typeof value === "string"
              ? bucketDate(value, group.bucket)
              : value;
        }
      const key = JSON.stringify(
        query.groupBy.map((group) =>
          Object.hasOwn(dimensions, group.field)
            ? ["value", dimensions[group.field]]
            : ["missing"],
        ),
      );
      const found = groups.get(key);
      if (found) found.rows.push(row);
      else groups.set(key, { dimensions, rows: [row] });
    }
  const rows = [...groups.values()].map((group) => {
    const row = { ...group.dimensions };
    for (const metric of query.metrics)
      row[metric.id] = aggregate(group.rows, metric);
    return row;
  });
  rows.sort((left, right) => {
    for (const sort of query.orderBy) {
      // Empty values always sort last, independent of direction.
      const a = left[sort.field],
        b = right[sort.field];
      const compared =
        a == null || b == null
          ? compareValues(a, b)
          : compareValues(a, b) * (sort.direction === "asc" ? 1 : -1);
      if (compared) return compared;
    }
    return 0;
  });
  const result: QueryResult = {
    queryId: query.id,
    columns: [
      ...query.groupBy.map((group) => group.field),
      ...query.metrics.map((metric) => metric.id),
    ],
    rows: rows.slice(0, query.limit),
    rowCount: rows.length,
  };
  if (query.comparison) {
    const previousRows = filtered.filter((row) =>
      inPeriod(row, query.comparison!.previous),
    );
    result.comparison = Object.fromEntries(
      query.metrics.map((metric) => {
        const currentValue = selected.length
          ? aggregate(selected, metric)
          : null;
        const previousValue = previousRows.length
          ? aggregate(previousRows, metric)
          : null;
        const current = typeof currentValue === "number" ? currentValue : null;
        const previous =
          typeof previousValue === "number" ? previousValue : null;
        return [
          metric.id,
          {
            current,
            previous,
            absoluteChange:
              current !== null && previous !== null ? current - previous : null,
            percentChange:
              current !== null && previous !== null && previous !== 0
                ? (current - previous) / Math.abs(previous)
                : null,
          },
        ];
      }),
    );
  }
  return result;
}

export function dashboardFilterToQueryFilter(
  filter: DashboardFilter,
  value: DataValue | DataValue[],
): QueryFilter | null {
  if (
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  )
    return null;
  if (filter.type === "date")
    return { field: filter.field, op: "between", value };
  if (filter.type === "search")
    return { field: filter.field, op: "contains", value };
  return { field: filter.field, op: Array.isArray(value) ? "in" : "eq", value };
}

/** Formula-like strings are escaped before quoting; numeric negatives remain numbers. */
export function exportRowsCsv(rows: DataRow[], columns: string[]): string {
  const cell = (value: DataValue | undefined) => {
    let output =
      value === undefined ? "" : value === null ? "NULL" : String(value);
    if (typeof value === "string" && /^[\s\u0000-\u001f]*[=+\-@]/.test(output))
      output = `'${output}`;
    return `"${output.replaceAll('"', '""')}"`;
  };
  return [
    columns.map(cell).join(","),
    ...rows.map((row) => columns.map((column) => cell(row[column])).join(",")),
  ].join("\r\n");
}
