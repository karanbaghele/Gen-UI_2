import "server-only";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { profileRows } from "@/lib/domain/profiling";
import type { DataRow, Dataset } from "@/lib/domain/schema";
import type { SessionContext } from "../auth";
import { withCredentials, withTenant } from "../db";
import { getDataset, persistDataset, replaceDataset } from "../repository";
import { scheduleSourceRefresh } from "../sync-jobs";
import {
  encryptSecret,
  decryptSecret,
  HttpError,
  isLoopbackHost,
} from "../security";

type ConnectionInput = {
  host: string;
  port?: string;
  database: string;
  user: string;
  password: string;
  ssl?: string;
  refreshIntervalSeconds: number;
};
type StoredConnection = {
  host: string;
  port: number;
  database: string;
  user: string;
  ssl: "require" | "disable";
  selection?: string;
};
export type DiscoveredTable = { id: string; name: string };
export type DiscoveredRelationship = {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
};
const identifier = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;

function fail(message: string): never {
  throw new HttpError(422, message, "invalid_connector_configuration");
}
function assertIdentifier(value: string) {
  if (!identifier.test(value))
    fail("The selected schema or table name is invalid.");
  return value;
}
function parseInput(input: ConnectionInput): {
  config: StoredConnection;
  password: string;
} {
  const host = input.host.trim().toLowerCase();
  if (!isLoopbackHost(host))
    fail(
      "This local installation accepts PostgreSQL targets only on localhost, 127.0.0.1, or ::1.",
    );
  const port = Number(input.port || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    fail("PostgreSQL port must be between 1 and 65535.");
  const database = input.database.trim(),
    user = input.user.trim();
  if (!identifier.test(database) || !identifier.test(user))
    fail(
      "Database and user names must contain only safe identifier characters.",
    );
  if (!input.password || input.password.length > 2048)
    fail(
      "A PostgreSQL password is required and must be under 2,048 characters.",
    );
  return {
    config: {
      host,
      port,
      database,
      user,
      ssl: input.ssl === "disable" ? "disable" : "require",
    },
    password: input.password,
  };
}
function parseTable(id: string): { schema: string; table: string } {
  const [schema, table, extra] = id.split(".");
  if (!schema || !table || extra) fail("Choose a discovered PostgreSQL table.");
  return { schema: assertIdentifier(schema), table: assertIdentifier(table) };
}
function client(config: StoredConnection, password: string) {
  return postgres({
    host: config.host,
    port: config.port,
    database: config.database,
    username: config.user,
    password,
    ssl: config.ssl === "require" ? "require" : false,
    max: 1,
    idle_timeout: 2,
    connect_timeout: 5,
    prepare: false,
    connection: {
      application_name: "genui-connector",
      statement_timeout: 10_000,
      default_transaction_read_only: true,
    },
    onnotice: () => {},
  });
}
function normalizeRows(rows: Record<string, unknown>[]): DataRow[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([name, value]) => {
        if (
          value == null ||
          typeof value === "string" ||
          typeof value === "boolean"
        )
          return [name, value];
        if (typeof value === "number")
          return [name, Number.isFinite(value) ? value : String(value)];
        if (typeof value === "bigint")
          return [
            name,
            value <= BigInt(Number.MAX_SAFE_INTEGER) &&
            value >= BigInt(Number.MIN_SAFE_INTEGER)
              ? Number(value)
              : String(value),
          ];
        if (value instanceof Date) return [name, value.toISOString()];
        return [name, JSON.stringify(value)];
      }),
    ),
  );
}
async function inspect(
  config: StoredConnection,
  password: string,
): Promise<{
  tables: DiscoveredTable[];
  relationships: DiscoveredRelationship[];
}> {
  const sql = client(config, password);
  try {
    const tables = await sql<
      { table_schema: string; table_name: string }[]
    >`select table_schema,table_name from information_schema.tables where table_type='BASE TABLE' and table_schema not in ('pg_catalog','information_schema') order by table_schema,table_name limit 200`;
    if (!tables.length)
      fail(
        "No readable tables were found. Use a dedicated read-only user with access to a table.",
      );
    const relationships = await sql<
      {
        from_schema: string;
        from_table: string;
        from_column: string;
        to_schema: string;
        to_table: string;
        to_column: string;
      }[]
    >`select source_ns.nspname as from_schema,source_table.relname as from_table,source_column.attname as from_column,
      target_ns.nspname as to_schema,target_table.relname as to_table,target_column.attname as to_column
      from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_class source_table on source_table.oid=constraint_row.conrelid
      join pg_catalog.pg_namespace source_ns on source_ns.oid=source_table.relnamespace
      join pg_catalog.pg_class target_table on target_table.oid=constraint_row.confrelid
      join pg_catalog.pg_namespace target_ns on target_ns.oid=target_table.relnamespace
      join lateral unnest(constraint_row.conkey) with ordinality source_key(attnum,position) on true
      join lateral unnest(constraint_row.confkey) with ordinality target_key(attnum,position) on target_key.position=source_key.position
      join pg_catalog.pg_attribute source_column on source_column.attrelid=source_table.oid and source_column.attnum=source_key.attnum
      join pg_catalog.pg_attribute target_column on target_column.attrelid=target_table.oid and target_column.attnum=target_key.attnum
      where constraint_row.contype='f'
        and source_ns.nspname not in ('pg_catalog','information_schema')
        and target_ns.nspname not in ('pg_catalog','information_schema')
        and has_table_privilege(source_table.oid,'select')
        and has_table_privilege(target_table.oid,'select')
      order by source_ns.nspname,source_table.relname,source_key.position limit 500`;
    return {
      tables: tables.map((table) => ({
        id: `${table.table_schema}.${table.table_name}`,
        name: `${table.table_schema}.${table.table_name}`,
      })),
      relationships: relationships.map((relationship) => ({
        fromTable: `${relationship.from_schema}.${relationship.from_table}`,
        fromColumn: relationship.from_column,
        toTable: `${relationship.to_schema}.${relationship.to_table}`,
        toColumn: relationship.to_column,
      })),
    };
  } catch (cause) {
    if (cause instanceof HttpError) throw cause;
    throw new HttpError(
      503,
      "The local PostgreSQL connection could not be established. Confirm host, port, credentials, SSL, and read-only access.",
      "connector_unavailable",
    );
  } finally {
    await sql.end({ timeout: 2 }).catch(() => undefined);
  }
}
export async function connectPostgres(
  ctx: SessionContext,
  input: ConnectionInput,
) {
  const { config, password } = parseInput(input);
  const discovered = await inspect(config, password);
  const sourceId = randomUUID();
  await withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    await sql`insert into data_sources(id,workspace_id,kind,name,config,encrypted_credentials,status,refresh_interval_seconds,last_synced_at)
      values(${sourceId},${ctx.workspace.id},'postgresql',${`${config.database} on ${config.host}`},${sql.json(config)},${encryptSecret(password, `${ctx.workspace.id}:${sourceId}`)},'ready',${input.refreshIntervalSeconds},now())`;
  });
  return { connectionId: sourceId, ...discovered };
}
async function source(ctx: SessionContext, id: string) {
  return withCredentials(ctx.user.id, ctx.workspace.id, async (sql) => {
    const [row] =
      await sql`select id,config,encrypted_credentials from data_sources where id=${id} and workspace_id=${ctx.workspace.id} and kind='postgresql' and status<>'disconnected'`;
    if (!row?.encrypted_credentials)
      throw new HttpError(
        404,
        "This PostgreSQL connection is unavailable in your workspace.",
        "not_found",
      );
    const config = row.config as StoredConnection;
    if (
      !config ||
      !isLoopbackHost(String(config.host)) ||
      !Number.isInteger(config.port)
    )
      throw new HttpError(
        503,
        "The stored PostgreSQL connection is invalid.",
        "credentials_invalid",
      );
    return {
      config,
      password: decryptSecret(
        String(row.encrypted_credentials),
        `${ctx.workspace.id}:${id}`,
      ),
    };
  });
}
async function readTable(
  ctx: SessionContext,
  connectionId: string,
  selection: string,
  datasetId: string,
  createdAt?: string,
): Promise<Dataset> {
  const { config, password } = await source(ctx, connectionId);
  const { schema, table } = parseTable(selection);
  const sql = client(config, password);
  try {
    const columns = await sql<
      { column_name: string }[]
    >`select column_name from information_schema.columns where table_schema=${schema} and table_name=${table} order by ordinal_position limit 200`;
    if (!columns.length)
      throw new HttpError(
        404,
        "The selected table is no longer available.",
        "not_found",
      );
    const fields = columns.map((column) =>
      assertIdentifier(column.column_name),
    );
    const rawRows = await sql.begin("read only", (transaction) =>
      transaction.unsafe(
        `select ${fields.map((name) => `"${name}"`).join(",")} from "${schema}"."${table}" limit 100000`,
      ),
    );
    return profileRows(normalizeRows(rawRows as Record<string, unknown>[]), {
      id: datasetId,
      workspaceId: ctx.workspace.id,
      sourceId: connectionId,
      name: `${schema}.${table}`,
      sourceType: "postgresql",
      now: createdAt,
    });
  } finally {
    await sql.end({ timeout: 2 }).catch(() => undefined);
  }
}
export function previewPostgresTable(
  ctx: SessionContext,
  connectionId: string,
  selection: string,
) {
  return readTable(ctx, connectionId, selection, randomUUID());
}
export async function importPostgresTable(
  ctx: SessionContext,
  connectionId: string,
  selection: string,
): Promise<Dataset> {
  try {
    const dataset = await readTable(ctx, connectionId, selection, randomUUID());
    const stored = await persistDataset(ctx, dataset);
    await withTenant(ctx.user.id, ctx.workspace.id, async (db) => {
      await db`update data_sources set config=config || ${db.json({ selection })},last_synced_at=now(),status='ready',error=null,updated_at=now() where id=${connectionId} and workspace_id=${ctx.workspace.id}`;
    });
    await scheduleSourceRefresh(ctx, stored.id, connectionId);
    return stored;
  } catch (cause) {
    if (cause instanceof HttpError) throw cause;
    throw new HttpError(
      503,
      "The selected PostgreSQL table could not be imported. The database may be unavailable or the read-only user lacks access.",
      "connector_unavailable",
    );
  }
}

export async function refreshPostgresDataset(
  ctx: SessionContext,
  datasetId: string,
): Promise<Dataset> {
  const current = await getDataset(ctx, datasetId);
  if (current.sourceType !== "postgresql")
    throw new HttpError(
      422,
      "Only connected PostgreSQL datasets can be refreshed.",
      "refresh_unsupported",
    );
  const { config } = await source(ctx, current.sourceId);
  if (!config.selection)
    throw new HttpError(
      409,
      "This source was imported before refresh metadata was saved. Reconnect it once.",
      "refresh_metadata_missing",
    );
  const syncId = randomUUID();
  await withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    await sql`insert into source_syncs(id,workspace_id,source_id,status) values(${syncId},${ctx.workspace.id},${current.sourceId},'processing')`;
    await sql`update data_sources set status='syncing',error=null,updated_at=now() where id=${current.sourceId} and workspace_id=${ctx.workspace.id}`;
  });
  try {
    const next = await readTable(
      ctx,
      current.sourceId,
      config.selection,
      current.id,
      current.createdAt,
    );
    const stored = await replaceDataset(ctx, next);
    await withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
      await sql`update source_syncs set status='ready',rows_count=${stored.rowCount},completed_at=now() where id=${syncId} and workspace_id=${ctx.workspace.id}`;
      await sql`update data_sources set status='ready',last_synced_at=now(),error=null,updated_at=now() where id=${current.sourceId} and workspace_id=${ctx.workspace.id}`;
    });
    return stored;
  } catch (cause) {
    await withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
      await sql`update source_syncs set status='failed',error='PostgreSQL refresh failed.',completed_at=now() where id=${syncId} and workspace_id=${ctx.workspace.id}`;
      await sql`update data_sources set status='error',error='PostgreSQL refresh failed.',updated_at=now() where id=${current.sourceId} and workspace_id=${ctx.workspace.id}`;
    }).catch(() => undefined);
    if (cause instanceof HttpError) throw cause;
    throw new HttpError(
      503,
      "The PostgreSQL source could not be refreshed. Check the local database and its read-only credentials.",
      "connector_unavailable",
    );
  }
}
