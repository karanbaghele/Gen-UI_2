import { cookies } from "next/headers";
import { configuration, supabaseServer } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
export const POST = route(async () => {
  if (configuration().supabase)
    await (await supabaseServer()).auth.signOut({ scope: "local" });
  const jar = await cookies();
  for (const cookie of jar.getAll())
    if (cookie.name.startsWith("sb-") || cookie.name === "genui-local-test")
      jar.delete(cookie.name);
  return json({ signedOut: true });
});
