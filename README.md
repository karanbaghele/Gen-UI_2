# GenUI

GenUI turns authorized structured data and a natural-language request into an editable dashboard. It uses a versioned JSON UI schema, deterministic analytical queries, and approved React widgets; models never provide executable frontend code or unrestricted SQL.

## Run locally

1. Install Docker Desktop or another local Docker-compatible runtime, then run `npm run db:start`.
2. Copy `.env.example` to `.env.local`. Use the local Supabase values printed by the start command, including the anonymous key and database URL.
3. Run `npm run db:reset`, then run `npm run dev` and `npm run worker` in separate terminals. Open `http://127.0.0.1:3000`.
4. For local model-backed RAG, install Ollama, then run `ollama pull nomic-embed-text` and a JSON-capable chat model such as `ollama pull qwen2.5:7b`. Start Ollama only on its default loopback address.

The application never deploys, provisions a hosted database, or creates a public tunnel. Google authentication and Google Sheets are external integrations; configured AI providers receive only the selected, authorized context for a request.

## PostgreSQL sources

The local connector tests a connection, discovers readable tables, previews and imports a selected table, and refreshes it through the local worker. It accepts loopback hosts only in this local build, uses read-only transactions and bounded reads, and never accepts model-provided SQL. Set `CREDENTIAL_ENCRYPTION_KEY` to a locally generated 32-byte hex key before connecting; passwords are encrypted server-side and never returned to the browser. Use a dedicated read-only user.

## Google Sheets

Create a separate Google OAuth web client for Sheets with `http://127.0.0.1:3000/auth/google-sheets/callback` as an authorized redirect URI. Set `GOOGLE_SHEETS_CLIENT_ID`, `GOOGLE_SHEETS_CLIENT_SECRET`, and `GOOGLE_SHEETS_REDIRECT_URI` in `.env.local`. This consent is separate from login and requests only `spreadsheets.readonly`. The connector accepts a spreadsheet URL or ID, discovers worksheets, previews before import, stores refresh tokens encrypted on the server, and polls through the local worker. OAuth, worksheet discovery, preview, import, and manual refresh were verified against Google Sheets on 2026-09-19. Background polling still requires verification with the local worker running.

## Google sign-in

Use a Google OAuth web client with `http://127.0.0.1:54321/auth/v1/callback` as an authorized redirect URI. Set `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET` only in ignored local environment files. The app uses a local Supabase Auth service, keeps its PKCE session in HTTP-only cookies, and creates a personal workspace through the database trigger. When using the standalone local Auth container with the preserved database, run `npm run auth:proxy` alongside `npm run dev`; this proxy binds only to `127.0.0.1:54321`.

## NVIDIA AI and RAG

Set `NVIDIA_API_KEY` only in `.env.local`, then set `AI_PROVIDER=nvidia` and `EMBEDDING_PROVIDER=nvidia`. The default chat model is `nvidia/nemotron-3-super-120b-a12b`; the default embedding model is `nvidia/nemotron-3-embed-1b`. Generation sends selected authorized context to NVIDIA, validates its JSON locally, and runs analytical queries in deterministic code. The indexing worker sends source metadata and definitions to NVIDIA for 2048-dimensional passage embeddings. Retrieval embeds the request as a query and filters vector search by tenant, selected datasets, and embedding model. Reindex datasets after switching embedding providers. Real NVIDIA passage/query embeddings, hybrid vector retrieval, dashboard generation, and conversational refinement were verified using the fictional built-in sample. App execution and storage remain local; inference runs on NVIDIA. Set `GENUI_WORKER_INDEX_ONLY=true` to process AI indexing without running the deferred source refresh jobs. Real Google sign-in and full acceptance testing remain unverified.

## Verification

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`. The tests cover CSV distinctions between zero, null and missing values; workspace-scoped deterministic queries; schema/patch safety; non-overlapping automatic layout; RAG and provider boundaries; streamed result handling; formula-protected CSV; and production rejection of the local authentication bypass. Runtime integration needs the local Supabase stack. See [docs/CONTINUATION.md](docs/CONTINUATION.md) for current verification status and outstanding local-service setup.
