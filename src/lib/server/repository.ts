import "server-only";
import { createHash, randomUUID } from "node:crypto";
import {
  datasetSchema,
  dashboardSchema,
  type DashboardSpec,
  type Dataset,
} from "@/lib/domain/schema";
import { validateDashboard } from "@/lib/domain/dashboard";
import { profileCsv } from "@/lib/domain/profiling";
import { createSampleDataset } from "@/lib/domain/sample";
import type { SessionContext } from "./auth";
import { withTenant, type TenantSql } from "./db";
import { assertCanWrite, HttpError } from "./security";

export type StoredDataset = Dataset & {
  version: number;
  indexingStatus: string;
  sourceStatus: string;
  sourceError: string | null;
  refreshIntervalSeconds: number;
  lastSyncedAt: string | null;
};
export type DashboardRecord = {
  id: string;
  workspaceId: string;
  title: string;
  spec: DashboardSpec;
  version: number;
  pinned: boolean;
  disconnected: boolean;
  createdAt: string;
  updatedAt: string;
};
const timestamp = (value: unknown) =>
  value instanceof Date
    ? value.toISOString()
    : new Date(String(value)).toISOString();
function datasetRow(row: Record<string, unknown>): StoredDataset {
  return {
    ...datasetSchema.parse({
      id: row.id,
      workspaceId: row.workspace_id,
      sourceId: row.source_id,
      name: row.name,
      sourceType: row.source_kind,
      fields: row.fields,
      rows: row.rows,
      rowCount: row.row_count,
      warnings: row.warnings,
      createdAt: timestamp(row.created_at),
      updatedAt: timestamp(row.updated_at),
    }),
    version: Number(row.version),
    indexingStatus: String(row.indexing_status),
    sourceStatus: String(row.source_status ?? "ready"),
    sourceError: row.source_error ? String(row.source_error) : null,
    refreshIntervalSeconds: Number(row.refresh_interval_seconds ?? 60),
    lastSyncedAt: row.last_synced_at ? timestamp(row.last_synced_at) : null,
  };
}
function dashboardRow(row: Record<string, unknown>): DashboardRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    title: String(row.title),
    spec: dashboardSchema.parse(row.spec),
    version: Number(row.version),
    pinned: Boolean(row.pinned),
    disconnected: Boolean(row.disconnected),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}
export async function audit(
  sql: TenantSql,
  ctx: SessionContext,
  action: string,
  resourceType: string,
  resourceId: string,
) {
  await sql`insert into audit_logs(workspace_id,user_id,action,resource_type,resource_id) values(${ctx.workspace.id},${ctx.user.id},${action},${resourceType},${resourceId})`;
}
async function getDatasetIn(sql: TenantSql, ctx: SessionContext, id: string) {
  const [row] =
    await sql`select d.*,s.status as source_status,s.error as source_error,s.refresh_interval_seconds,s.last_synced_at from datasets d join data_sources s on s.id=d.source_id and s.workspace_id=d.workspace_id
    where d.id=${id} and d.workspace_id=${ctx.workspace.id}`;
  if (!row)
    throw new HttpError(
      404,
      "This dataset is unavailable in your workspace.",
      "not_found",
    );
  return datasetRow(row);
}
export const getDataset = (ctx: SessionContext, id: string) =>
  withTenant(ctx.user.id, ctx.workspace.id, (sql) =>
    getDatasetIn(sql, ctx, id),
  );
export function listDatasets(ctx: SessionContext) {
  return withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    const rows =
      await sql`select d.id,d.workspace_id,d.source_id,d.name,d.source_kind,d.fields,d.warnings,d.row_count,d.version,d.indexing_status,d.created_at,d.updated_at,
      '[]'::jsonb as rows,s.status as source_status,s.error as source_error,s.refresh_interval_seconds,s.last_synced_at from datasets d join data_sources s on s.id=d.source_id and s.workspace_id=d.workspace_id
      where d.workspace_id=${ctx.workspace.id} order by d.updated_at desc limit 100`;
    return rows.map(datasetRow);
  });
}
export async function persistDataset(ctx: SessionContext, dataset: Dataset) {
  assertCanWrite(ctx.workspace.role);
  if (dataset.workspaceId !== ctx.workspace.id)
    throw new HttpError(
      403,
      "Dataset scope does not match the current workspace.",
    );
  return withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    await sql`insert into data_sources(id,workspace_id,kind,name,last_synced_at) values(${dataset.sourceId},${ctx.workspace.id},${dataset.sourceType},${dataset.name},now()) on conflict(id) do nothing`;
    await sql`insert into datasets(id,workspace_id,source_id,name,source_kind,fields,rows,row_count,warnings,created_at,updated_at)
      values(${dataset.id},${ctx.workspace.id},${dataset.sourceId},${dataset.name},${dataset.sourceType},${sql.json(dataset.fields)},${sql.json(dataset.rows)},${dataset.rowCount},${sql.json(dataset.warnings)},${dataset.createdAt},${dataset.updatedAt})`;
    for (const field of dataset.fields)
      await sql`insert into dataset_fields(workspace_id,dataset_id,name,definition) values(${ctx.workspace.id},${dataset.id},${field.name},${sql.json(field)})`;
    await sql`insert into jobs(workspace_id,dataset_id,source_id,type,payload,idempotency_key)
      values(${ctx.workspace.id},${dataset.id},${dataset.sourceId},'index_dataset',${sql.json({ datasetId: dataset.id })},${`index:${dataset.id}:1`})`;
    await audit(sql, ctx, "dataset.created", "dataset", dataset.id);
    return getDatasetIn(sql, ctx, dataset.id);
  });
}
export async function replaceDataset(ctx: SessionContext, dataset: Dataset) {
  assertCanWrite(ctx.workspace.role);
  if (dataset.workspaceId !== ctx.workspace.id)
    throw new HttpError(
      403,
      "Dataset scope does not match the current workspace.",
    );
  return withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    const current = await getDatasetIn(sql, ctx, dataset.id);
    if (current.sourceId !== dataset.sourceId)
      throw new HttpError(
        409,
        "Dataset source does not match.",
        "source_mismatch",
      );
    const [updated] =
      await sql`update datasets set name=${dataset.name},fields=${sql.json(dataset.fields)},rows=${sql.json(dataset.rows)},row_count=${dataset.rowCount},warnings=${sql.json(dataset.warnings)},version=version+1,indexing_status='stale',updated_at=now()
        where id=${dataset.id} and workspace_id=${ctx.workspace.id} returning version`;
    await sql`delete from dataset_fields where dataset_id=${dataset.id} and workspace_id=${ctx.workspace.id}`;
    for (const field of dataset.fields)
      await sql`insert into dataset_fields(workspace_id,dataset_id,name,definition) values(${ctx.workspace.id},${dataset.id},${field.name},${sql.json(field)})`;
    await sql`insert into jobs(workspace_id,dataset_id,source_id,type,payload,idempotency_key)
      values(${ctx.workspace.id},${dataset.id},${dataset.sourceId},'index_dataset',${sql.json({ datasetId: dataset.id })},${`index:${dataset.id}:${Number(updated!.version)}`})
      on conflict(workspace_id,idempotency_key) do nothing`;
    await audit(sql, ctx, "dataset.refreshed", "dataset", dataset.id);
    return getDatasetIn(sql, ctx, dataset.id);
  });
}
export async function createDataset(
  ctx: SessionContext,
  input: { kind: "sample" | "csv"; name?: string; csv?: string },
) {
  const datasetId = randomUUID();
  const dataset =
    input.kind === "sample"
      ? createSampleDataset(ctx.workspace.id, datasetId)
      : profileCsv(input.csv ?? "", {
          id: datasetId,
          workspaceId: ctx.workspace.id,
          sourceId: randomUUID(),
          name: input.name ?? "Imported data",
        });
  // Domain samples can use readable IDs in tests; persistence always uses UUID source IDs.
  dataset.sourceId = randomUUID();
  return persistDataset(ctx, dataset);
}
export function deleteDataset(ctx: SessionContext, id: string) {
  assertCanWrite(ctx.workspace.role);
  return withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    const dataset = await getDatasetIn(sql, ctx, id);
    await sql`update dashboards set disconnected=true,updated_at=now() where workspace_id=${ctx.workspace.id} and spec->'datasetIds' ? ${id}`;
    await audit(sql, ctx, "dataset.deleted", "dataset", id);
    await sql`delete from datasets where id=${id} and workspace_id=${ctx.workspace.id}`;
    await sql`delete from data_sources where id=${dataset.sourceId} and workspace_id=${ctx.workspace.id} and not exists(select 1 from datasets where source_id=${dataset.sourceId})`;
  });
}
export function addDefinition(
  ctx: SessionContext,
  datasetId: string,
  input: { title: string; content: string },
) {
  assertCanWrite(ctx.workspace.role);
  return withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    const dataset = await getDatasetIn(sql, ctx, datasetId);
    const checksum = createHash("sha256").update(input.content).digest("hex");
    const [document] =
      await sql`insert into knowledge_documents(workspace_id,dataset_id,source_id,kind,title,content,checksum,status)
      values(${ctx.workspace.id},${datasetId},${dataset.sourceId},'business_definition',${input.title},${input.content},${checksum},'stale')
      on conflict(workspace_id,dataset_id,kind,title) do update set content=excluded.content,checksum=excluded.checksum,status='stale',updated_at=now() returning id,title,content,status`;
    await sql`update datasets set indexing_status='stale' where id=${datasetId} and workspace_id=${ctx.workspace.id}`;
    await sql`insert into jobs(workspace_id,dataset_id,type,payload,idempotency_key) values(${ctx.workspace.id},${datasetId},'index_dataset',${sql.json({ datasetId })},${`definition:${document!.id}:${checksum}`}) on conflict(workspace_id,idempotency_key) do update set status='queued',run_after=now(),attempts=0`;
    await audit(sql, ctx, "definition.saved", "dataset", datasetId);
    return document;
  });
}
async function validateSpec(
  sql: TenantSql,
  ctx: SessionContext,
  spec: DashboardSpec,
) {
  const datasets = await Promise.all(
    spec.datasetIds.map((id) => getDatasetIn(sql, ctx, id)),
  );
  if (datasets.some((dataset) => dataset.sourceStatus === "disconnected"))
    throw new HttpError(
      409,
      "Reconnect the source before updating this dashboard.",
      "source_disconnected",
    );
  return validateDashboard(spec, datasets, ctx.workspace.id);
}
export function createDashboard(
  ctx: SessionContext,
  input: { spec: DashboardSpec; generationRunId?: string },
) {
  assertCanWrite(ctx.workspace.role);
  return withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    const spec = await validateSpec(sql, ctx, input.spec);
    const [row] =
      await sql`insert into dashboards(workspace_id,title,spec,created_by) values(${ctx.workspace.id},${spec.title},${sql.json(spec)},${ctx.user.id}) returning *`;
    await sql`insert into dashboard_versions(workspace_id,dashboard_id,version,spec,created_by,reason) values(${ctx.workspace.id},${row!.id},1,${sql.json(spec)},${ctx.user.id},'create')`;
    if (input.generationRunId)
      await sql`update generation_runs set dashboard_id=${row!.id} where id=${input.generationRunId} and workspace_id=${ctx.workspace.id}`;
    await audit(sql, ctx, "dashboard.created", "dashboard", String(row!.id));
    return dashboardRow(row!);
  });
}
export function listDashboards(ctx: SessionContext) {
  return withTenant(ctx.user.id, ctx.workspace.id, async (sql) =>
    (
      await sql`select * from dashboards where workspace_id=${ctx.workspace.id} order by pinned desc,updated_at desc limit 200`
    ).map(dashboardRow),
  );
}
export async function duplicateDashboard(ctx: SessionContext, id: string) {
  assertCanWrite(ctx.workspace.role);
  return withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    const [current] =
      await sql`select * from dashboards where id=${id} and workspace_id=${ctx.workspace.id}`;
    if (!current)
      throw new HttpError(
        404,
        "This dashboard is unavailable in your workspace.",
        "not_found",
      );
    const original = dashboardRow(current);
    const spec = await validateSpec(sql, ctx, {
      ...original.spec,
      title: `${original.spec.title} copy`,
    });
    const [row] =
      await sql`insert into dashboards(workspace_id,title,spec,created_by,pinned)
      values(${ctx.workspace.id},${spec.title},${sql.json(spec)},${ctx.user.id},false) returning *`;
    await sql`insert into dashboard_versions(workspace_id,dashboard_id,version,spec,created_by,reason)
      values(${ctx.workspace.id},${row!.id},1,${sql.json(spec)},${ctx.user.id},'duplicate')`;
    await audit(sql, ctx, "dashboard.duplicated", "dashboard", String(row!.id));
    return dashboardRow(row!);
  });
}
export function getDashboard(ctx: SessionContext, id: string) {
  return withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    const [row] =
      await sql`select * from dashboards where id=${id} and workspace_id=${ctx.workspace.id}`;
    if (!row)
      throw new HttpError(
        404,
        "This dashboard is unavailable in your workspace.",
        "not_found",
      );
    return dashboardRow(row);
  });
}
export function updateDashboard(
  ctx: SessionContext,
  id: string,
  input: {
    spec: DashboardSpec;
    expectedVersion: number;
    pinned?: boolean;
    reason?: string;
  },
) {
  assertCanWrite(ctx.workspace.role);
  return withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    const [current] =
      await sql`select * from dashboards where id=${id} and workspace_id=${ctx.workspace.id} for update`;
    if (!current)
      throw new HttpError(
        404,
        "This dashboard is unavailable in your workspace.",
        "not_found",
      );
    if (Number(current.version) !== input.expectedVersion)
      throw new HttpError(
        409,
        "This dashboard changed in another tab. Reload before saving.",
        "version_conflict",
      );
    const spec = await validateSpec(sql, ctx, input.spec);
    const [row] =
      await sql`update dashboards set title=${spec.title},spec=${sql.json(spec)},version=version+1,pinned=${input.pinned ?? Boolean(current.pinned)},updated_at=now()
      where id=${id} and workspace_id=${ctx.workspace.id} and version=${input.expectedVersion} returning *`;
    if (!row)
      throw new HttpError(
        409,
        "This dashboard changed in another tab. Reload before saving.",
        "version_conflict",
      );
    await sql`insert into dashboard_versions(workspace_id,dashboard_id,version,spec,created_by,reason) values(${ctx.workspace.id},${id},${row.version},${sql.json(spec)},${ctx.user.id},${input.reason ?? "save"})`;
    await audit(sql, ctx, "dashboard.saved", "dashboard", id);
    return dashboardRow(row);
  });
}
export function dashboardVersions(ctx: SessionContext, id: string) {
  return withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    const rows =
      await sql`select version,reason,created_at from dashboard_versions where dashboard_id=${id} and workspace_id=${ctx.workspace.id} order by version desc limit 100`;
    return rows.map((row) => ({
      version: Number(row.version),
      reason: String(row.reason),
      createdAt: timestamp(row.created_at),
    }));
  });
}

export function dashboardContext(ctx: SessionContext, id: string) {
  if (ctx.workspace.role !== "admin")
    throw new HttpError(
      403,
      "The Context Inspector is available to workspace administrators.",
      "forbidden",
    );
  return withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    const [dashboard] =
      await sql`select id,spec from dashboards where id=${id} and workspace_id=${ctx.workspace.id}`;
    if (!dashboard)
      throw new HttpError(
        404,
        "This dashboard is unavailable in your workspace.",
        "not_found",
      );
    const spec = dashboardSchema.parse(dashboard.spec);
    const datasets = await sql`select id,name,source_kind,indexing_status,updated_at
      from datasets where workspace_id=${ctx.workspace.id} and id=any(${spec.datasetIds}::uuid[])
      order by name`;
    const [generation] = await sql`select id,provider,model,status,retrieval,usage,validation,duration_ms,error,created_at
      from generation_runs where dashboard_id=${id} and workspace_id=${ctx.workspace.id}
      order by created_at desc limit 1`;
    const queryRuns = generation
      ? await sql`select id,dataset_id,query,results_count,duration_ms,status,error,created_at
          from query_runs where generation_run_id=${generation.id} and workspace_id=${ctx.workspace.id}
          order by created_at,id limit 100`
      : [];
    return {
      selectedDatasets: datasets.map((dataset) => ({
        id: String(dataset.id),
        name: String(dataset.name),
        sourceType: String(dataset.source_kind),
        indexingStatus: String(dataset.indexing_status),
        updatedAt: timestamp(dataset.updated_at),
      })),
      generation: generation
        ? {
            id: String(generation.id),
            provider: String(generation.provider),
            model: String(generation.model),
            status: String(generation.status),
            durationMs:
              generation.duration_ms == null
                ? null
                : Number(generation.duration_ms),
            retrieval: generation.retrieval,
            usage: generation.usage,
            validation: generation.validation,
            error: generation.error ? String(generation.error) : null,
            createdAt: timestamp(generation.created_at),
          }
        : null,
      queryRuns: queryRuns.map((query) => ({
        id: String(query.id),
        datasetId: query.dataset_id ? String(query.dataset_id) : null,
        query: query.query,
        resultsCount: Number(query.results_count),
        durationMs: Number(query.duration_ms),
        status: String(query.status),
        error: query.error ? String(query.error) : null,
        createdAt: timestamp(query.created_at),
      })),
      finalSchema: spec,
    };
  });
}
export async function restoreDashboard(
  ctx: SessionContext,
  id: string,
  version: number,
  expectedVersion: number,
) {
  const spec = await withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    const [row] =
      await sql`select spec from dashboard_versions where dashboard_id=${id} and workspace_id=${ctx.workspace.id} and version=${version}`;
    if (!row)
      throw new HttpError(
        404,
        "This dashboard version is unavailable.",
        "not_found",
      );
    return dashboardSchema.parse(row.spec);
  });
  return updateDashboard(ctx, id, {
    spec,
    expectedVersion,
    reason: `restore:${version}`,
  });
}
export function deleteDashboard(ctx: SessionContext, id: string) {
  assertCanWrite(ctx.workspace.role);
  return withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    const rows =
      await sql`delete from dashboards where id=${id} and workspace_id=${ctx.workspace.id} returning id`;
    if (!rows.length)
      throw new HttpError(
        404,
        "This dashboard is unavailable in your workspace.",
        "not_found",
      );
    await audit(sql, ctx, "dashboard.deleted", "dashboard", id);
  });
}
