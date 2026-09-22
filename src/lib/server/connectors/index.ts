import "server-only";
import type { SessionContext } from "../auth";
import { withTenant } from "../db";
import { HttpError } from "../security";
import {
  discoverGoogleSheets,
  importGoogleWorksheet,
  previewGoogleWorksheet,
  refreshGoogleSheetsDataset,
} from "./google-sheets";
import {
  importPostgresTable,
  previewPostgresTable,
  refreshPostgresDataset,
} from "./postgres";

async function sourceKind(ctx: SessionContext, sourceId: string) {
  return withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    const [source] =
      await sql`select kind from data_sources where id=${sourceId} and workspace_id=${ctx.workspace.id} and status<>'disconnected'`;
    if (!source)
      throw new HttpError(
        404,
        "This connection is unavailable in your workspace.",
        "not_found",
      );
    return String(source.kind);
  });
}

export async function discoverConnectedSource(
  ctx: SessionContext,
  sourceId: string,
) {
  const kind = await sourceKind(ctx, sourceId);
  if (kind === "google_sheets")
    return { kind, tables: await discoverGoogleSheets(ctx, sourceId) };
  throw new HttpError(
    422,
    "This source does not support separate discovery.",
    "discovery_unsupported",
  );
}

export async function importConnectedSource(
  ctx: SessionContext,
  sourceId: string,
  selection: string,
) {
  const kind = await sourceKind(ctx, sourceId);
  if (kind === "postgresql")
    return importPostgresTable(ctx, sourceId, selection);
  if (kind === "google_sheets")
    return importGoogleWorksheet(ctx, sourceId, selection);
  throw new HttpError(
    422,
    "This source cannot be imported through the connector flow.",
    "import_unsupported",
  );
}

export async function previewConnectedSource(
  ctx: SessionContext,
  sourceId: string,
  selection: string,
) {
  const kind = await sourceKind(ctx, sourceId);
  const dataset =
    kind === "postgresql"
      ? await previewPostgresTable(ctx, sourceId, selection)
      : kind === "google_sheets"
        ? await previewGoogleWorksheet(ctx, sourceId, selection)
        : undefined;
  if (!dataset)
    throw new HttpError(
      422,
      "This source cannot be previewed through the connector flow.",
      "preview_unsupported",
    );
  return {
    fields: dataset.fields,
    rows: dataset.rows.slice(0, 10),
    rowCount: dataset.rowCount,
    warnings: dataset.warnings,
  };
}

export async function refreshConnectedDataset(
  ctx: SessionContext,
  datasetId: string,
) {
  const [dataset] = await withTenant(
    ctx.user.id,
    ctx.workspace.id,
    (sql) =>
      sql`select source_kind from datasets where id=${datasetId} and workspace_id=${ctx.workspace.id}`,
  );
  if (!dataset)
    throw new HttpError(
      404,
      "This dataset is unavailable in your workspace.",
      "not_found",
    );
  if (dataset.source_kind === "postgresql")
    return refreshPostgresDataset(ctx, datasetId);
  if (dataset.source_kind === "google_sheets")
    return refreshGoogleSheetsDataset(ctx, datasetId);
  throw new HttpError(
    422,
    "This snapshot source does not support refresh.",
    "refresh_unsupported",
  );
}
