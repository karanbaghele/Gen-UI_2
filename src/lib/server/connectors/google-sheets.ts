import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import Papa from "papaparse";
import { profileCsv } from "@/lib/domain/profiling";
import type { SessionContext } from "../auth";
import { withCredentials, withTenant } from "../db";
import { getDataset, persistDataset, replaceDataset } from "../repository";
import { scheduleSourceRefresh } from "../sync-jobs";
import { decryptSecret, encryptSecret, HttpError, localUrl } from "../security";

type SheetConfig = {
  spreadsheetId: string;
  selection?: string;
  oauthStateHash?: string;
};
type SheetTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};
type SheetMetadata = {
  properties?: { title?: string };
  sheets?: {
    properties?: {
      sheetId?: number;
      title?: string;
      index?: number;
      gridProperties?: { rowCount?: number; columnCount?: number };
    };
  }[];
};
type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

const scope = "https://www.googleapis.com/auth/spreadsheets.readonly";
const spreadsheetIdPattern = /^[A-Za-z0-9_-]{20,200}$/;

function settings() {
  const clientId = process.env.GOOGLE_SHEETS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_SHEETS_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    throw new HttpError(
      503,
      "Google Sheets access is not configured. Set GOOGLE_SHEETS_CLIENT_ID and GOOGLE_SHEETS_CLIENT_SECRET in .env.local, then restart GenUI.",
      "sheets_unconfigured",
    );
  const app = localUrl(
    process.env.APP_URL ?? "http://127.0.0.1:3000",
    "Application URL",
  );
  const redirectUri =
    process.env.GOOGLE_SHEETS_REDIRECT_URI ??
    new URL("/auth/google-sheets/callback", app).toString();
  const redirect = new URL(redirectUri);
  if (redirect.origin !== app.origin)
    throw new HttpError(
      503,
      "The Google Sheets callback must use this local application's origin.",
      "sheets_callback_invalid",
    );
  return { clientId, clientSecret, redirectUri };
}

function spreadsheetId(value: string): string {
  const trimmed = value.trim();
  let id = trimmed;
  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
    if (!match) throw new Error("missing id");
    id = match[1];
  } catch {
    if (trimmed.includes("://"))
      throw new HttpError(
        422,
        "Enter a Google Sheets URL or spreadsheet ID.",
        "invalid_spreadsheet",
      );
  }
  if (!spreadsheetIdPattern.test(id))
    throw new HttpError(
      422,
      "Enter a valid Google Sheets URL or spreadsheet ID.",
      "invalid_spreadsheet",
    );
  return id;
}

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export async function beginGoogleSheetsConnection(
  ctx: SessionContext,
  input: string,
  refreshIntervalSeconds: number,
) {
  const { clientId, redirectUri } = settings();
  const id = spreadsheetId(input);
  const sourceId = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const state = `${sourceId}.${secret}`;
  const config: SheetConfig = {
    spreadsheetId: id,
    oauthStateHash: hash(state),
  };
  await withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    await sql`insert into data_sources(id,workspace_id,kind,name,config,status,refresh_interval_seconds)
      values(${sourceId},${ctx.workspace.id},'google_sheets','Google Sheets',${sql.json(config)},'syncing',${refreshIntervalSeconds})`;
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();
  return { connectionId: sourceId, authorizationUrl: url.toString() };
}

async function tokenRequest(parameters: Record<string, string>) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(parameters),
    signal: AbortSignal.timeout(10_000),
  });
  const value = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || !value.access_token)
    throw new HttpError(
      401,
      "Google Sheets authorization could not be completed.",
      "sheets_authorization_failed",
    );
  return value;
}

async function storedSource(ctx: SessionContext, sourceId: string) {
  return withCredentials(ctx.user.id, ctx.workspace.id, async (sql) => {
    const [row] =
      await sql`select id,name,config,encrypted_credentials,status from data_sources
        where id=${sourceId} and workspace_id=${ctx.workspace.id} and kind='google_sheets' and status<>'disconnected'`;
    if (!row)
      throw new HttpError(
        404,
        "This Google Sheets connection is unavailable in your workspace.",
        "not_found",
      );
    return {
      id: String(row.id),
      name: String(row.name),
      config: row.config as SheetConfig,
      status: String(row.status),
      encryptedCredentials: row.encrypted_credentials
        ? String(row.encrypted_credentials)
        : undefined,
    };
  });
}

export async function finishGoogleSheetsConnection(
  ctx: SessionContext,
  state: string,
  code: string,
) {
  const [sourceId] = state.split(".");
  if (!sourceId || !code)
    throw new HttpError(
      400,
      "Google Sheets returned an incomplete authorization response.",
      "sheets_authorization_failed",
    );
  const source = await storedSource(ctx, sourceId);
  if (
    !source.config.oauthStateHash &&
    source.status === "ready" &&
    source.encryptedCredentials
  )
    return { connectionId: sourceId, worksheets: [] };
  if (
    !source.config.oauthStateHash ||
    source.config.oauthStateHash !== hash(state)
  )
    throw new HttpError(
      403,
      "Google Sheets authorization state did not match.",
      "oauth_state_mismatch",
    );
  const { clientId, clientSecret, redirectUri } = settings();
  const token = await tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  if (!token.refresh_token)
    throw new HttpError(
      401,
      "Google did not return offline access. Reconnect and grant access again.",
      "sheets_refresh_token_missing",
    );
  const tokens: SheetTokens = {
    accessToken: token.access_token!,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + Number(token.expires_in ?? 3600) * 1000,
  };
  const metadata = await fetchMetadata(
    source.config.spreadsheetId,
    tokens.accessToken,
  );
  await withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    await sql`update data_sources
      set name=${metadata.properties?.title ?? "Google Sheets"},
          config=(config - 'oauthStateHash'),
          encrypted_credentials=${encryptSecret(JSON.stringify(tokens), `${ctx.workspace.id}:${sourceId}`)},
          status='ready',error=null,updated_at=now()
      where id=${sourceId} and workspace_id=${ctx.workspace.id}`;
  });
  return { connectionId: sourceId, worksheets: worksheets(metadata) };
}

async function accessToken(ctx: SessionContext, sourceId: string) {
  const source = await storedSource(ctx, sourceId);
  if (!source.encryptedCredentials)
    throw new HttpError(
      401,
      "Reconnect Google Sheets to authorize spreadsheet access.",
      "sheets_authorization_expired",
    );
  let tokens: SheetTokens;
  try {
    tokens = JSON.parse(
      decryptSecret(
        source.encryptedCredentials,
        `${ctx.workspace.id}:${sourceId}`,
      ),
    ) as SheetTokens;
  } catch (cause) {
    if (cause instanceof HttpError) throw cause;
    throw new HttpError(
      503,
      "Stored Google Sheets credentials are invalid.",
      "credentials_invalid",
    );
  }
  if (tokens.expiresAt > Date.now() + 60_000)
    return { source, token: tokens.accessToken };
  const { clientId, clientSecret } = settings();
  const refreshed = await tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: tokens.refreshToken,
    grant_type: "refresh_token",
  });
  tokens = {
    accessToken: refreshed.access_token!,
    refreshToken: refreshed.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + Number(refreshed.expires_in ?? 3600) * 1000,
  };
  await withCredentials(ctx.user.id, ctx.workspace.id, async (sql) => {
    await sql`update data_sources set encrypted_credentials=${encryptSecret(JSON.stringify(tokens), `${ctx.workspace.id}:${sourceId}`)},updated_at=now()
      where id=${sourceId} and workspace_id=${ctx.workspace.id}`;
  });
  return { source, token: tokens.accessToken };
}

async function googleJson<T>(url: URL, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403)
    throw new HttpError(
      401,
      "Google Sheets access expired or was revoked. Reconnect this source.",
      "sheets_authorization_expired",
    );
  if (!response.ok)
    throw new HttpError(
      503,
      "Google Sheets could not be read. Confirm that the spreadsheet still exists and is accessible.",
      "sheets_unavailable",
    );
  return (await response.json()) as T;
}

async function fetchMetadata(id: string, token: string) {
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}`,
  );
  url.searchParams.set(
    "fields",
    "properties.title,sheets.properties(sheetId,title,index,gridProperties)",
  );
  return googleJson<SheetMetadata>(url, token);
}

function worksheets(metadata: SheetMetadata) {
  return (metadata.sheets ?? [])
    .map((sheet) => sheet.properties)
    .filter((value): value is NonNullable<typeof value> => !!value?.title)
    .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
    .map((sheet) => ({
      id: sheet.title!,
      name: sheet.title!,
      rows: Number(sheet.gridProperties?.rowCount ?? 0),
      columns: Number(sheet.gridProperties?.columnCount ?? 0),
    }));
}

export async function discoverGoogleSheets(
  ctx: SessionContext,
  sourceId: string,
) {
  const { source, token } = await accessToken(ctx, sourceId);
  const metadata = await fetchMetadata(source.config.spreadsheetId, token);
  return worksheets(metadata);
}

async function readWorksheet(
  ctx: SessionContext,
  sourceId: string,
  selection: string,
  datasetId: string,
) {
  if (!selection.trim() || selection.length > 200)
    throw new HttpError(422, "Choose a worksheet.", "invalid_worksheet");
  const { source, token } = await accessToken(ctx, sourceId);
  const escaped = selection.replaceAll("'", "''");
  const range = `'${escaped}'!1:100001`;
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(source.config.spreadsheetId)}/values/${encodeURIComponent(range)}`,
  );
  url.searchParams.set("majorDimension", "ROWS");
  url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
  const value = await googleJson<{ values?: unknown[][] }>(url, token);
  const rows = value.values ?? [];
  if (rows.length < 2)
    throw new HttpError(
      422,
      "The worksheet must contain a header row and at least one data row.",
      "empty_worksheet",
    );
  const csv = Papa.unparse(rows);
  return profileCsv(csv, {
    id: datasetId,
    workspaceId: ctx.workspace.id,
    sourceId,
    name: `${source.name} · ${selection}`,
    sourceType: "google_sheets",
  });
}
export function previewGoogleWorksheet(
  ctx: SessionContext,
  sourceId: string,
  selection: string,
) {
  return readWorksheet(ctx, sourceId, selection, randomUUID());
}

export async function importGoogleWorksheet(
  ctx: SessionContext,
  sourceId: string,
  selection: string,
) {
  const dataset = await readWorksheet(ctx, sourceId, selection, randomUUID());
  const stored = await persistDataset(ctx, dataset);
  await withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    await sql`update data_sources set config=config || ${sql.json({ selection })},status='ready',last_synced_at=now(),error=null,updated_at=now()
      where id=${sourceId} and workspace_id=${ctx.workspace.id}`;
  });
  await scheduleSourceRefresh(ctx, stored.id, sourceId);
  return stored;
}

export async function refreshGoogleSheetsDataset(
  ctx: SessionContext,
  datasetId: string,
) {
  const current = await getDataset(ctx, datasetId);
  if (current.sourceType !== "google_sheets")
    throw new HttpError(
      422,
      "Only connected Google Sheets datasets can use this refresh.",
      "refresh_unsupported",
    );
  const source = await storedSource(ctx, current.sourceId);
  if (!source.config.selection)
    throw new HttpError(
      409,
      "Choose and import a worksheet before refreshing this source.",
      "refresh_metadata_missing",
    );
  const syncId = randomUUID();
  await withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
    await sql`insert into source_syncs(id,workspace_id,source_id,status) values(${syncId},${ctx.workspace.id},${current.sourceId},'processing')`;
    await sql`update data_sources set status='syncing',error=null,updated_at=now() where id=${current.sourceId} and workspace_id=${ctx.workspace.id}`;
  });
  try {
    const next = await readWorksheet(
      ctx,
      current.sourceId,
      source.config.selection,
      current.id,
    );
    const stored = await replaceDataset(ctx, next);
    await withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
      await sql`update source_syncs set status='ready',rows_count=${stored.rowCount},completed_at=now() where id=${syncId} and workspace_id=${ctx.workspace.id}`;
      await sql`update data_sources set status='ready',last_synced_at=now(),error=null,updated_at=now() where id=${current.sourceId} and workspace_id=${ctx.workspace.id}`;
    });
    return stored;
  } catch (cause) {
    await withTenant(ctx.user.id, ctx.workspace.id, async (sql) => {
      await sql`update source_syncs set status='failed',error='Google Sheets refresh failed.',completed_at=now() where id=${syncId} and workspace_id=${ctx.workspace.id}`;
      await sql`update data_sources set status='error',error='Google Sheets refresh failed.',updated_at=now() where id=${current.sourceId} and workspace_id=${ctx.workspace.id}`;
    }).catch(() => undefined);
    if (cause instanceof HttpError) throw cause;
    throw new HttpError(
      503,
      "Google Sheets could not be refreshed. Check its access and availability.",
      "sheets_unavailable",
    );
  }
}
