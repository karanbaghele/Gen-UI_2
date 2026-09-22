import "server-only";
import postgres from "postgres";
import { localUrl } from "./security";

let connection: ReturnType<typeof postgres> | undefined;
export type TenantSql = postgres.TransactionSql;

/** The pool never leaves loopback. All request work must use withTenant/withUser. */
export function getDb() {
  if (!connection) {
    const url = localUrl(process.env.DATABASE_URL, "Local database");
    if (!["postgres:", "postgresql:"].includes(url.protocol))
      throw new Error("DATABASE_URL must use PostgreSQL");
    connection = postgres(url.toString(), {
      max: 8,
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
