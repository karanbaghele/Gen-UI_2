import { supabaseServer } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { HttpError, localUrl, rateLimit } from "@/lib/server/security";
export const GET = route(async () => {
  rateLimit("oauth:start", 30);
  const appUrl = localUrl(
    process.env.APP_URL ?? "http://127.0.0.1:3000",
    "Application URL",
  );
  const client = await supabaseServer();
  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${appUrl.origin}/auth/callback`,
      skipBrowserRedirect: true,
    },
  });
  if (error || !data.url)
    throw new HttpError(
      503,
      "Google sign-in is not configured or the local auth service is unavailable.",
      "oauth_unavailable",
    );
  return Response.redirect(data.url, 303);
});
