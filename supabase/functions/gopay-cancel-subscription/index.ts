// supabase/functions/gopay-cancel-subscription/index.ts
//
// Zrušení předplatného na žádost uživatele (ucet.html) — nastaví
// subscription_cancel_at_period_end = true, appka zůstává funkční do konce
// už zaplaceného období (viz Obchodní podmínky čl. 5). gopay-charge-renewals
// pak při dalším běhu cronu tohle políčko uvidí a NEBUDE se pokoušet o další
// platbu, místo toho rovnou nastaví subscription_status na 'canceled'.
//
// Navíc zkusíme rovnou zavolat GoPay voidRecurrence — zneplatní uloženou
// autorizaci karty na jejich straně (menší okno, kdy by šlo cokoliv strhnout
// mimo naši vlastní cron logiku). Není to ale nutná podmínka úspěchu: i
// kdyby volání selhalo (výpadek GoPay, karta už neplatná apod.), naše vlastní
// gopay-charge-renewals stejně žádnou další platbu nezaloží, takže
// subscription_cancel_at_period_end zůstává jediným zdrojem pravdy.
//
// Nasazení: supabase functions deploy gopay-cancel-subscription

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { voidRecurrence } from "../_shared/gopay.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const adminSupabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "Chybí přihlášení." }, 401);

    const userSupabase = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userSupabase.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Neplatné nebo vypršelé přihlášení." }, 401);
    const user = userData.user;

    const { data: profile, error: profileError } = await adminSupabase
      .from("profiles")
      .select("gopay_parent_payment_id, subscription_status")
      .eq("id", user.id)
      .single();
    if (profileError) throw profileError;

    if (profile.subscription_status !== "active" && profile.subscription_status !== "past_due") {
      return json({ error: "Žádné aktivní předplatné ke zrušení." }, 400);
    }

    if (profile.gopay_parent_payment_id) {
      await voidRecurrence(profile.gopay_parent_payment_id).catch((err) =>
        console.warn(`gopay-cancel-subscription: voidRecurrence selhalo pro ${user.id} (pokračujeme, viz komentář v souboru):`, err)
      );
    }

    const { error: updateError } = await adminSupabase
      .from("profiles")
      .update({ subscription_cancel_at_period_end: true })
      .eq("id", user.id);
    if (updateError) throw updateError;

    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
  }
});
