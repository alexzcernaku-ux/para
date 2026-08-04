// supabase/functions/gopay-checkout/index.ts
//
// Založí GoPay platbu (ON_DEMAND opakovaná) pro přihlášeného uživatele a
// vrátí gw_url, kam ho prohlížeč přesměruje k platbě. Volá se z
// predplatne.html po vyplnění fakturačních údajů.
//
// Uživatele NIKDY neber z těla požadavku — ověřuje se výhradně z JWT v
// Authorization hlavičce (přes GoTrue), jinak by šlo založit platbu na
// cizí user_id. Samotné potvrzení předplatného (subscription_status =
// 'active') dělá až gopay-webhook po PAID stavu, tahle funkce jen zakládá
// platbu a ukládá "created" event pro dohledatelnost.
//
// Nasazení: supabase functions deploy gopay-checkout
// Secrets: supabase secrets set GOPAY_GOID=... GOPAY_CLIENT_ID=... GOPAY_CLIENT_SECRET=... GOPAY_ENV=sandbox
// (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY jsou dostupné automaticky)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createSubscriptionPayment } from "../_shared/gopay.ts";

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

// Ceník — jediný "Pro" tarif, měsíční nebo roční platba (viz predplatne.html).
const PLAN_PRICES: Record<string, { amountKc: number; label: string }> = {
  monthly: { amountKc: 299, label: "Para Pro — měsíční předplatné" },
  yearly: { amountKc: 2990, label: "Para Pro — roční předplatné" },
};

const REQUIRED_PAYER_FIELDS = ["firstName", "lastName", "phoneNumber", "city", "street", "postalCode"] as const;

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
    if (!user.email) return json({ error: "Účet nemá ověřený e-mail." }, 400);

    const body = await req.json().catch(() => ({}));
    const planInfo = PLAN_PRICES[body.plan];
    if (!planInfo) return json({ error: "Neplatný tarif — očekávám 'monthly' nebo 'yearly'." }, 400);

    const payer = body.payer || {};
    for (const field of REQUIRED_PAYER_FIELDS) {
      if (!payer[field] || typeof payer[field] !== "string" || !payer[field].trim()) {
        return json({ error: `Chybí fakturační údaj: ${field}` }, 400);
      }
    }

    const origin = req.headers.get("origin") || "https://para.app";
    const orderNumber = `para-${user.id.slice(0, 8)}-${Date.now()}`;

    const payment = await createSubscriptionPayment({
      amountKc: planInfo.amountKc,
      orderNumber,
      orderDescription: planInfo.label,
      itemName: planInfo.label,
      payer: {
        firstName: payer.firstName.trim(),
        lastName: payer.lastName.trim(),
        email: user.email,
        phoneNumber: payer.phoneNumber.trim(),
        city: payer.city.trim(),
        street: payer.street.trim(),
        postalCode: payer.postalCode.trim(),
      },
      userId: user.id,
      returnUrl: `${origin}/predplatne.html?platba=vysledek`,
      notificationUrl: `${SUPABASE_URL}/functions/v1/gopay-webhook`,
    });

    // Uloženo PŘED potvrzením platby — gopay-webhook podle tohohle řádku
    // (gopay_payment_id) dohledá, čí platba to je a jaký tarif se platí.
    const { error: insertError } = await adminSupabase.from("payment_events").insert({
      user_id: user.id,
      gopay_payment_id: String(payment.id),
      gopay_parent_payment_id: String(payment.id),
      event_type: "created",
      amount: planInfo.amountKc,
      raw_state: payment.state,
    });
    if (insertError) throw insertError;

    // subscription_plan si uložit hned (potřebuje ho webhook pro výpočet
    // délky období) — subscription_status ale zůstává 'none', dokud GoPay
    // nepotvrdí PAID, takže tohle samo o sobě přístup neodemyká.
    const { error: profileError } = await adminSupabase
      .from("profiles")
      .update({ subscription_plan: body.plan })
      .eq("id", user.id);
    if (profileError) throw profileError;

    return json({ gwUrl: payment.gw_url, paymentId: payment.id });
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
  }
});
