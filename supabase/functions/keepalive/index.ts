// keepalive — a public endpoint for an uptime monitor (e.g. UptimeRobot) to hit
// on a schedule so the free Supabase project doesn't pause after ~7 days idle.
// It performs a trivial DB read so the project registers real activity.
// Deployed with verify_jwt = false so the monitor can call it without auth.
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    await supabase.from("recipes").select("id").limit(1);
  } catch (_) {
    // Even on error, return 200 so the monitor doesn't page; the request itself
    // is what keeps the project warm.
  }
  return new Response(JSON.stringify({ status: "ok" }), {
    headers: { "Content-Type": "application/json" },
  });
});
