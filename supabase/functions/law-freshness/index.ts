// supabase/functions/law-freshness/index.ts
//
// Veřejný (bez přihlášení) endpoint pro landing page - vrátí souhrn nad
// law_versions (11_schema_law_updates.sql): kolik zákonů appka sleduje a
// kdy byl naposledy nějaký z nich reálně zkontrolován proti e-Sbírce
// (check-law-updates, týdenní cron). law_versions nemá RLS policy pro
// anon/authenticated roli (viz komentář v migraci), takže se čte přes
// service role - vrací se jen agregát (počet + datum), ne obsah zákonů.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { data, error } = await supabase.from("law_versions").select("last_checked_at");
    if (error) throw error;

    const trackedLaws = data.length;
    const lastCheckedAt = data.reduce((max: string | null, row: { last_checked_at: string | null }) => {
      if (!row.last_checked_at) return max;
      return !max || row.last_checked_at > max ? row.last_checked_at : max;
    }, null as string | null);

    return json({ trackedLaws, lastCheckedAt });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
