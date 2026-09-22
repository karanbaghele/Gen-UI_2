import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { getDb, withUser } from "./db";
import {
  assertLocalTestAuth,
  HttpError,
  localUrl,
  rateLimit,
} from "./security";

export type SessionContext = {
  user: { id: string; email: string; name: string; avatarUrl: string | null };
  workspace: { id: string; name: string; role: "admin" | "analyst" | "viewer" };
};
export function configuration() {
  return {
    supabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
    database: !!process.env.DATABASE_URL,
    google: !!(
      process.env.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID &&
      process.env.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET
    ),
    sheets: !!(
      process.env.GOOGLE_SHEETS_CLIENT_ID &&
      process.env.GOOGLE_SHEETS_CLIENT_SECRET
    ),
    ollama: !!process.env.OLLAMA_BASE_URL,
    gemini: !!process.env.GEMINI_API_KEY,
    nvidia: !!process.env.NVIDIA_API_KEY,
    devAuth:
      process.env.NODE_ENV !== "production" &&
      process.env.GENUI_TEST_AUTH === "true",
  };
}
export async function supabaseServer() {
  const url = localUrl(process.env.SUPABASE_URL, "Local Supabase");
  const key = process.env.SUPABASE_ANON_KEY;
  if (!key)
    throw new HttpError(
      503,
      "The local Supabase anonymous key is not configured.",
      "configuration_missing",
    );
  const jar = await cookies();
  return createServerClient(url.toString(), key, {
    auth: { flowType: "pkce" },
    cookieOptions: {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) => {
        for (const { name, value, options } of values)
          jar.set(name, value, {
            ...options,
            httpOnly: true,
            sameSite: "lax",
            secure: false,
            path: "/",
          });
      },
    },
  });
}

const testUserId = "11111111-1111-4111-8111-111111111111";
let provisionedTestUser = false;
async function localTestUser(request?: Request) {
  const requestHeaders = request?.headers ?? (await headers());
  const token =
    requestHeaders.get("x-genui-test-auth") ??
    (await cookies()).get("genui-local-test")?.value;
  const url = request?.url ?? `http://${requestHeaders.get("host") ?? ""}`;
  if (!assertLocalTestAuth(url, token ?? undefined)) return null;
  if (!provisionedTestUser) {
    // Explicit local integration fixture only. No endpoint issues this cookie; tests install it themselves.
    await getDb()`insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values(${testUserId},'authenticated','authenticated','local-test@genui.invalid','{"provider":"test"}','{"full_name":"Local test user"}',now(),now())
      on conflict(id) do nothing`;
    provisionedTestUser = true;
  }
  return testUserId;
}

export async function getSession(
  request?: Request,
): Promise<SessionContext | null> {
  let userId = await localTestUser(request);
  if (!userId) {
    if (!configuration().supabase) return null;
    const client = await supabaseServer();
    const {
      data: { user },
      error,
    } = await client.auth.getUser();
    if (error || !user) return null;
    if (
      user.app_metadata.provider !== "google" ||
      !user.identities?.some((identity) => identity.provider === "google")
    )
      return null;
    userId = user.id;
  }
  return withUser(userId, async (sql) => {
    const [row] =
      await sql`select p.id,p.email,p.name,p.avatar_url,w.id as workspace_id,w.name as workspace_name,m.role
      from profiles p join memberships m on m.user_id=p.id join workspaces w on w.id=m.workspace_id
      where p.id=${userId!} order by m.created_at limit 1`;
    if (!row)
      throw new HttpError(
        503,
        "Your workspace is not available. Check the local migrations.",
        "workspace_missing",
      );
    return {
      user: {
        id: String(row.id),
        email: String(row.email),
        name: String(row.name),
        avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      },
      workspace: {
        id: String(row.workspace_id),
        name: String(row.workspace_name),
        role: row.role as SessionContext["workspace"]["role"],
      },
    };
  });
}
export async function requireSession(
  request?: Request,
): Promise<SessionContext> {
  const session = await getSession(request);
  if (!session)
    throw new HttpError(
      401,
      "Sign in with Google to continue.",
      "unauthenticated",
    );
  rateLimit(`request:${session.user.id}`, 180);
  return session;
}
