// supabase/functions/review-form-update/index.ts
//
// Cíl odkazu "Označit jako vyřešeno" z e-mailu, který posílá
// check-form-updates. Na rozdíl od review-law-change tu není co "schválit"
// automaticky - přemapování PDF souřadnic nebo přepsání konstanty dělá
// člověk (nebo Claude v editoru), tahle funkce jen označí form_watch_events
// jako vyřízené, ať se appka nezacyklí v opakovaných e-mailech o té samé
// změně (last_known_hash se ale aktualizuje hned v check-form-updates,
// tenhle krok slouží čistě jako "viděl/a jsem to" checkbox pro váš přehled).
//
// Nasazení: supabase functions deploy review-form-update
// Secrets: žádné nové.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

function page(title: string, body: string) {
  return `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"><title>${title}</title>
  <style>body{font-family:-apple-system,sans-serif;max-width:560px;margin:60px auto;padding:0 20px;color:#0F172A}
  h1{font-size:20px}p{color:#334155;line-height:1.5}</style></head>
  <body><h1>${title}</h1>${body}</body></html>`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const token = url.searchParams.get("token");

  if (!id || !token) {
    return new Response(page("Chybí parametry", "<p>Odkaz je neúplný.</p>"), { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  const { data: eventRow, error } = await supabase
    .from("form_watch_events")
    .select("*")
    .eq("id", id)
    .eq("review_token", token)
    .maybeSingle();

  if (error || !eventRow) {
    return new Response(page("Odkaz už neplatí", "<p>Tenhle odkaz je neplatný nebo už byl použitý.</p>"), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (eventRow.status === "resolved") {
    return new Response(page("Už vyřešeno", `<p><strong>${eventRow.label}</strong> už bylo dřív označeno jako vyřešené.</p>`), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  await supabase.from("form_watch_events").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", id);

  return new Response(
    page("Označeno jako vyřešeno", `<p><strong>${eventRow.label}</strong> je teď označené jako vyřešené. Příští kontrola porovnává proti aktuálnímu obsahu, který appka právě viděla.</p>`),
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
});
