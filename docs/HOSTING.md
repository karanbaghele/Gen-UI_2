# GenUI hosting

GenUI's Next.js pages and API routes run together on Vercel. Supabase hosts Auth and PostgreSQL with pgvector. NVIDIA serves chat and embedding requests. The local Docker database, Auth proxy, and worker stay available for development and do not connect to the hosted project by default.

The public landing page is `/`. Its entry buttons open the protected workspace at `/app`; completed Google sign-in also returns to `/app`. Existing dashboard and data URLs stay under `/dashboards` and `/data`.

The hosted Supabase project is **GenUI** in **Karan Works**, Mumbai region, reference `srfcsvtunrfbdzruoqof`. All three checked-in schema migrations were applied to it on 2026-09-24. Its 19 public tables have row-level security. The Vercel project is `gen-ui-2`, with production address `https://gen-ui-2-two.vercel.app`, and is connected to the private GitHub repository. Its production build is live, and the production secrets and dedicated database login are configured. A real hosted Google sign-in and authenticated app database flow still need user verification.

## Deployment flow

The intended production source is `karanbaghele/Gen-UI_2` on `main`. Keep local changes uncommitted while developing. When a release is requested, commit and push to `main`; a Vercel project connected to that repository deploys the pushed revision. A local edit never deploys on its own. Supabase schema changes need their migration applied before the matching app revision goes live.

These values are set in Vercel's **Production** environment. Keep all credential values out of Git and logs:

- `APP_URL` and `NEXT_PUBLIC_APP_URL`: `https://gen-ui-2-two.vercel.app`.
- `SUPABASE_URL`: `https://srfcsvtunrfbdzruoqof.supabase.co`.
- `SUPABASE_ANON_KEY`: the project's publishable key.
- `DATABASE_URL`: the Supabase **transaction pooler** connection string on port 6543, using a dedicated GenUI login. The code uses one connection per function, disables prepared statements, and requires TLS for remote databases.
- `CREDENTIAL_ENCRYPTION_KEY`: a new random 32-byte hex value for hosted connector secrets. Keep it stable; changing it without re-encrypting stored credentials breaks connector refresh.
- `GOOGLE_SIGN_IN_ENABLED=true` once the hosted Supabase Google provider is enabled.
- `NVIDIA_API_KEY`, `AI_PROVIDER=nvidia`, `EMBEDDING_PROVIDER=nvidia`, `NVIDIA_CHAT_MODEL=nvidia/nemotron-3-super-120b-a12b`, `NVIDIA_EMBEDDING_MODEL=nvidia/nemotron-3-embed-1b`.
- `GENUI_ON_DEMAND_INDEXING=true` and `NEXT_PUBLIC_HOSTED=true`.
- `GOOGLE_SHEETS_CLIENT_ID`, `GOOGLE_SHEETS_CLIENT_SECRET`, and `GOOGLE_SHEETS_REDIRECT_URI` if hosted Google Sheets access is enabled. The redirect must be `https://<production-host>/auth/google-sheets/callback`.
- `CRON_SECRET`: a separate random secret of at least 16 characters, set only for Production. Vercel sends it as a Bearer token to the daily database health route.

Supabase Auth has its Site URL set to `https://gen-ui-2-two.vercel.app` and allows `https://gen-ui-2-two.vercel.app/auth/callback`. Its Google provider is enabled with the existing GenUI OAuth web client, whose Google Cloud authorized redirect URI now includes `https://srfcsvtunrfbdzruoqof.supabase.co/auth/v1/callback`. That client also allows `https://gen-ui-2-two.vercel.app/auth/google-sheets/callback` for the separate Sheets consent flow. Verify both flows with real consent after deployment.

Vercel has no continuously running GenUI worker in this setup. Dashboard generation indexes selected dataset metadata on demand for RAG. Manual connector refresh remains available; scheduled source polling does not run on Vercel. The PostgreSQL source connector remains limited to loopback hosts and is only usable in the local installation. Hosted CSV uploads are capped at 4 MB because Vercel Functions have a 4.5 MB request limit. Local CSV uploads remain capped at 10 MB.

Three production Vercel cron jobs call `/api/cron/database-health` daily at 01:00, 09:00, and 17:00 UTC (06:30, 14:30, and 22:30 Asia/Kolkata, each with up to an hour of timing variation on Hobby). The route requires `CRON_SECRET` and runs a read-only `SELECT 1` against the configured Supabase PostgreSQL database; it stores no rows and exposes no credentials. Check Vercel Cron Jobs logs for failures. Supabase decides inactivity from database activity over a rolling seven days; these checks reduce pause risk but cannot guarantee the Free project will never pause. If it is already paused, resume it in Supabase first.
