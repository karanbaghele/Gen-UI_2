import "server-only";
import postgres from "postgres";
import { HttpError, isLoopbackHost } from "./security";

let connection: ReturnType<typeof postgres> | undefined;
export type TenantSql = postgres.TransactionSql;

/** All request work must use withTenant/withUser so RLS sees the signed-in user. */
export function getDb() {
  if (!connection) {
    if (!process.env.DATABASE_URL)
      throw new HttpError(503, "Database is not configured.", "configuration_missing");
    let url: URL;
    try {
      url = new URL(process.env.DATABASE_URL);
    } catch {
      throw new HttpError(503, "Database URL is invalid.", "configuration_invalid");
    }
    if (!["postgres:", "postgresql:"].includes(url.protocol))
      throw new Error("DATABASE_URL must use PostgreSQL");
    const local = isLoopbackHost(url.hostname);
    connection = postgres(url.toString(), {
      max: local ? 8 : 1,
      ssl: local ? false : "require",
      idle_timeout: 20,
      connect_timeout: 5,
      prepare: false,
      connection: { application_name: "genui", statement_timeout: 10_000 },
    });
  }
  return connection;
}

export async function withUser<T>(
  userId: string,
  fn: (sql: TenantSql) => Promise<T>,
): Promise<T> {
  const result = await getDb().begin(async (sql) => {
    await sql`set local role authenticated`;
    await sql`select set_config('request.jwt.claim.sub', ${userId}, true)`;
    await sql`select set_config('request.jwt.claim.role', 'authenticated', true)`;
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
    return fn(sql);
  });
  return result as T;
}

export async function withTenant<T>(
  userId: string,
  workspaceId: string,
  fn: (sql: TenantSql) => Promise<T>,
): Promise<T> {
  return withUser(userId, async (sql) => {
    await sql`select set_config('app.workspace_id', ${workspaceId}, true)`;
    return fn(sql);
  });
}

export async function withCredentials<T>(
  userId: string,
  workspaceId: string,
  fn: (sql: TenantSql) => Promise<T>,
): Promise<T> {
  return withTenant(userId, workspaceId, async (sql) => {
    await sql`set local role genui_credentials`;
    return fn(sql);
  });
}
