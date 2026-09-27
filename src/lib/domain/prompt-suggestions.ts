import type { Dataset, DatasetField } from "./schema";

export type PromptSuggestion = {
  id: "overview" | "trend" | "breakdown";
  label: string;
  preview: string;
  prompt: string;
};

const safeName = (field: DatasetField) =>
  field.name.length <= 64 &&
  /^[\p{L}\p{N}][\p{L}\p{N}_ .()/&%-]*$/u.test(field.name) &&
  !/\b(ignore|override|system|developer|assistant|instructions?|prompts?|secrets?|passwords?|tokens?|execute)\b/i.test(field.name);
const quoted = (field: DatasetField) => `"${field.name}"`;
const list = (fields: DatasetField[]) => fields.map(quoted).join(", ");
const matches = (field: DatasetField, pattern: RegExp) =>
  pattern.test(field.name.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " "));
const dimensionPriority = (field: DatasetField) => {
  if (matches(field, /product|item/i)) return 6;
  if (matches(field, /category/i)) return 5;
  if (matches(field, /service/i)) return 4;
  if (matches(field, /region|country|state|city/i)) return 3;
  if (matches(field, /segment|channel|customer|department/i)) return 2;
  return 1;
};

/** Suggestions use scoped dataset metadata only; no row values or AI call is needed. */
export function suggestDashboardPrompts(
  dataset: Pick<Dataset, "fields">,
): PromptSuggestion[] {
  const fields = dataset.fields.filter(safeName);
  const measures = fields
    .filter(
      (field) =>
        field.type === "number" &&
        field.semantic !== "identifier" &&
        field.allowedAggregations.some((op) => op === "sum" || op === "avg"),
    )
    .sort(
      (a, b) =>
        Number(matches(b, /revenue|sales|profit|cost|amount|quantity|total/i)) -
        Number(matches(a, /revenue|sales|profit|cost|amount|quantity|total/i)),
    )
    .slice(0, 4);
  const dimensions = fields
    .filter(
      (field) =>
        field.semantic === "dimension" &&
        (field.type === "string" || field.type === "boolean"),
    )
    .sort((a, b) => dimensionPriority(b) - dimensionPriority(a))
    .slice(0, 6);
  const date = fields.find((field) => field.type === "date");
  const primary = measures[0];
  const entity = dimensions.find((field) =>
    matches(field, /product|item|service|category/i),
  );
  const businessBreakdowns = dimensions.filter((field) =>
    matches(field, /product|item|category|service|region|country|state|city/i),
  );
  const other = dimensions.find((field) => field.name !== entity?.name);
  const metric = primary ? quoted(primary) : "record count";
  const overviewParts = [
    "Build a complete, well-arranged dashboard for this dataset.",
    measures.length
      ? `Show record count and useful KPIs for ${list(measures)}.`
      : "Show total records and useful counts from the available fields.",
    date ? `Show how ${metric} changes over ${quoted(date)}.` : "",
    dimensions.length
      ? `Compare ${metric} across ${list(dimensions)}.`
      : "",
    businessBreakdowns.length
      ? `Include top-ranked views for ${list(businessBreakdowns)} and a detailed comparison table.`
      : "Include a detailed table of the underlying records.",
    date || dimensions.length
      ? `Add filters for ${list([...(date ? [date] : []), ...dimensions.slice(0, 3)])}.`
      : "",
    "Use only fields in this dataset, calculate every number from the data, and omit sections that the data cannot support.",
  ];
  const suggestions: PromptSuggestion[] = [
    {
      id: "overview",
      label: "Build a complete overview",
      preview: [date, ...measures.slice(0, 2), ...dimensions.slice(0, 2)]
        .filter((field): field is DatasetField => !!field)
        .map((field) => field.name)
        .join(" · ") || "Counts and available fields",
      prompt: overviewParts.filter(Boolean).join(" "),
    },
  ];

  if (date) {
    suggestions.push({
      id: "trend",
      label: "See how things change",
      preview: `${date.name} · ${primary?.name ?? "record count"}`,
      prompt: `Create a time-based dashboard using ${quoted(date)}. Chart ${metric} over the available dates, show overall totals, and${other ? ` compare the trend by ${quoted(other)}` : " summarize the busiest periods"}. Only compare periods that exist in this dataset; do not invent growth or missing history.`,
    });
  } else if (dimensions.length) {
    suggestions.push({
      id: "trend",
      label: "Compare groups",
      preview: dimensions.slice(0, 2).map((field) => field.name).join(" · "),
      prompt: `Compare ${metric} across ${list(dimensions.slice(0, 2))}. Show a ranked chart, totals, and a table of the groups. Use only these available fields and calculate values from the dataset.`,
    });
  }

  if (entity) {
    suggestions.push({
      id: "breakdown",
      label: "Find the leaders",
      preview: `${entity.name} · ${primary?.name ?? "record count"}`,
      prompt: `Focus on ${quoted(entity)}. Rank it by ${metric}, show the strongest and weakest groups, and include a detailed comparison table${other ? ` with a breakdown by ${quoted(other)}` : ""}. Add only filters supported by this dataset.`,
    });
  } else if (dimensions.length > 1) {
    suggestions.push({
      id: "breakdown",
      label: "Explore the detail",
      preview: dimensions.slice(0, 2).map((field) => field.name).join(" · "),
      prompt: `Build a detailed comparison of ${list(dimensions.slice(0, 2))} using ${metric}. Show a clear chart, a ranked table, and filters for those fields. Use only actual records and available columns.`,
    });
  } else if (measures.length) {
    suggestions.push({
      id: "breakdown",
      label: "Inspect the numbers",
      preview: measures.map((field) => field.name).join(" · "),
      prompt: `Summarize ${list(measures)} with supported totals, averages, minimums, and maximums. Include record count and a detailed table. Do not add breakdowns for fields that are absent.`,
    });
  }

  return suggestions;
}
