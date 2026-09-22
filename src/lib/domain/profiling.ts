import Papa from "papaparse";
import {
  datasetSchema,
  type Dataset,
  type DatasetField,
  type DataRow,
  type DataValue,
} from "./schema";

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export type DatasetMetadata = {
  id: string;
  workspaceId: string;
  sourceId: string;
  name: string;
  sourceType?: Dataset["sourceType"];
  now?: string;
};
const emptyTokens = new Set(["null", "NULL", ""]);
const isoDate =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/;
const identifier = /(?:^id$|(?:^|_)id$|postal|zip|phone|account_number)/i;
const currencySymbols = /[$€£₹¥]/g;

function numericValue(value: string): number | undefined {
  const trimmed = value.trim();
  if (!/^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(trimmed)) return;
  if (/^[-+]?0\d+/.test(trimmed)) return;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : undefined;
}
function currencyValue(value: string): number | undefined {
  let normalized = value.trim().replace(currencySymbols, "").trim();
  if (/^\(.*\)$/.test(normalized)) normalized = `-${normalized.slice(1, -1)}`;
  if (
    normalized.includes(",") &&
    !/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(normalized)
  )
    return;
  return numericValue(normalized.replaceAll(",", ""));
}
function validDate(value: string): boolean {
  if (!isoDate.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const day = value.slice(0, 10);
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}

/** CSV values are typed column-wise. Ambiguous mixed types remain strings instead of lossy coercion. */
export function profileCsv(text: string, metadata: DatasetMetadata): Dataset {
  if (new TextEncoder().encode(text).byteLength > 10 * 1024 * 1024)
    throw new DomainError("CSV exceeds the 10 MB upload limit.");
  if (text.includes("\u0000"))
    throw new DomainError(
      "CSV contains binary content. Upload a UTF-8 text file.",
    );
  if (text.includes("\ufffd"))
    throw new DomainError(
      "CSV has invalid text encoding. Save it as UTF-8 and try again.",
    );
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
    skipEmptyLines: "greedy",
    dynamicTyping: false,
  });
  const fatal = parsed.errors.filter(
    (error) => error.code !== "UndetectableDelimiter",
  );
  if (fatal.length)
    throw new DomainError(`CSV could not be parsed: ${fatal[0].message}`);
  const [rawHeaders, ...cells] = parsed.data;
  if (!rawHeaders?.length || !cells.length)
    throw new DomainError(
      "CSV must contain a header row and at least one data row.",
    );
  if (rawHeaders.length > 200)
    throw new DomainError("CSV is limited to 200 columns.");
  if (cells.length > 100_000)
    throw new DomainError("CSV is limited to 100,000 rows.");
  const headers = rawHeaders.map((value) => value.trim());
  if (
    headers.some(
      (value) =>
        !value ||
        value.length > 200 ||
        ["__proto__", "constructor", "prototype"].includes(value),
    )
  )
    throw new DomainError(
      "CSV has an empty, reserved, or oversized column name.",
    );
  if (new Set(headers).size !== headers.length)
    throw new DomainError("CSV column names must be unique.");
  const rows: DataRow[] = cells.map((row, index) => {
    if (row.length > headers.length)
      throw new DomainError(
        `CSV row ${index + 2} has more cells than the header.`,
      );
    const normalized: DataRow = {};
    row.forEach((value, column) => {
      normalized[headers[column]] = emptyTokens.has(value.trim())
        ? null
        : value.trim();
    });
    return normalized;
  });
  return profileRows(
    rows,
    { ...metadata, sourceType: metadata.sourceType ?? "csv" },
    headers,
  );
}

export function profileRows(
  input: DataRow[],
  metadata: DatasetMetadata,
  declaredHeaders?: string[],
): Dataset {
  if (!input.length)
    throw new DomainError("The dataset must contain at least one row.");
  if (input.length > 100_000)
    throw new DomainError("Datasets are limited to 100,000 rows.");
  const rows = input.map((row) => ({ ...row }));
  const names = declaredHeaders ?? [
    ...new Set(rows.flatMap((row) => Object.keys(row))),
  ];
  const warnings: string[] = [];
  const fields: DatasetField[] = names.map((name) => {
    if (["__proto__", "constructor", "prototype"].includes(name))
      throw new DomainError("Reserved column name.");
    const present = rows.filter((row) => Object.hasOwn(row, name));
    const values = present
      .map((row) => row[name])
      .filter((value): value is Exclude<DataValue, null> => value !== null);
    let type: DatasetField["type"] = "string";
    let semantic: DatasetField["semantic"] = identifier.test(name)
      ? "identifier"
      : "dimension";
    let unit: string | undefined;
    const strings = values.map(String);
    const symbols = [
      ...new Set(
        strings.flatMap((value) => value.match(currencySymbols) ?? []),
      ),
    ];
    let convert: (value: Exclude<DataValue, null>) => DataValue = (value) =>
      String(value);
    if (
      values.length &&
      values.every(
        (value) =>
          typeof value === "boolean" || /^(?:true|false)$/i.test(String(value)),
      )
    ) {
      type = "boolean";
      convert = (value) => String(value).toLowerCase() === "true";
    } else if (values.length && strings.every(validDate)) {
      type = "date";
      convert = (value) =>
        String(value).includes("T")
          ? new Date(String(value)).toISOString()
          : String(value);
    } else if (
      semantic !== "identifier" &&
      values.length &&
      symbols.length === 1 &&
      strings.every((value) => currencyValue(value) !== undefined)
    ) {
      type = "number";
      semantic = "currency";
      unit = symbols[0];
      convert = (value) => currencyValue(String(value))!;
    } else if (
      semantic !== "identifier" &&
      values.length &&
      strings.every(
        (value) =>
          /%$/.test(value) && numericValue(value.slice(0, -1)) !== undefined,
      )
    ) {
      type = "number";
      semantic = "percentage";
      unit = "%";
      convert = (value) => numericValue(String(value).slice(0, -1))! / 100;
    } else if (
      values.length &&
      values.every((value) =>
        typeof value === "number"
          ? Number.isFinite(value)
          : numericValue(String(value)) !== undefined,
      )
    ) {
      type = semantic === "identifier" ? "string" : "number";
      if (semantic !== "identifier") {
        semantic = /(?:rate|percent|percentage|margin|ratio)/i.test(name)
          ? "percentage"
          : /(?:revenue|cost|price|sales|amount|profit)/i.test(name)
            ? "currency"
            : "measure";
        convert = (value) => Number(value);
      }
    } else if (
      values.some((value) => typeof value === "number") ||
      strings.some(
        (value) => numericValue(value) !== undefined || /\d[/-]\d/.test(value),
      )
    ) {
      warnings.push(
        `Column “${name}” has ambiguous or mixed values and is preserved as text.`,
      );
    }
    if (symbols.length > 1)
      warnings.push(
        `Column “${name}” contains mixed currencies and is preserved as text.`,
      );
    for (const row of rows)
      if (Object.hasOwn(row, name) && row[name] !== null)
        row[name] = convert(row[name]);
    const normalized = rows
      .filter((row) => Object.hasOwn(row, name) && row[name] !== null)
      .map((row) => row[name]);
    const sorted = [...normalized].sort((a, b) =>
      typeof a === "number" && typeof b === "number"
        ? a - b
        : String(a).localeCompare(String(b)),
    );
    const allowedAggregations: DatasetField["allowedAggregations"] = [
      "count",
      "distinctCount",
    ];
    if (type === "number") allowedAggregations.push("avg", "min", "max");
    if (
      type === "number" &&
      semantic !== "percentage" &&
      !/(?:price|average|avg|unit_cost)/i.test(name)
    )
      allowedAggregations.push("sum");
    if (type === "date") allowedAggregations.push("min", "max");
    return {
      name,
      type,
      semantic,
      nullable:
        present.length < rows.length ||
        present.some((row) => row[name] === null),
      ...(unit ? { unit } : {}),
      allowedAggregations,
      stats: {
        nullCount: present.filter((row) => row[name] === null).length,
        missingCount: rows.length - present.length,
        distinctCount: new Set(normalized.map((value) => JSON.stringify(value)))
          .size,
        ...(sorted.length ? { min: sorted[0], max: sorted.at(-1) } : {}),
        examples: [...new Set(normalized)].slice(0, 5),
      },
    };
  });
  const now = metadata.now ?? new Date().toISOString();
  return datasetSchema.parse({
    id: metadata.id,
    workspaceId: metadata.workspaceId,
    sourceId: metadata.sourceId,
    name: metadata.name,
    sourceType: metadata.sourceType ?? "csv",
    fields,
    rows,
    rowCount: rows.length,
    createdAt: now,
    updatedAt: now,
    warnings,
  });
}
