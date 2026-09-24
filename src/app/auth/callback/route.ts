import { supabaseServer } from "@/lib/server/auth";
import { serviceUrl } from "@/lib/server/security";
export async function GET(request: Request) {
  const app = serviceUrl(
    process.env.APP_URL ?? "http://127.0.0.1:3000",
    "Application URL",
  );
  const code = new URL(request.url).searchParams.get("code");
  if (code) {
    try {
      const client = await supabaseServer();
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (!error) return Response.redirect(`${app.origin}/`, 303);
    } catch {
      /* A safe fixed message is shown by the login page. */
    }
  }
  return Response.redirect(
    `${app.origin}/login?error=oauth_callback_failed`,
    303,
  );
}
