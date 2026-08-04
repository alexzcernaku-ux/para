// supabase/functions/gopay-charge-renewals/index.ts
//
// Denní cron (viz 20_schema_cron_gopay_renewals.sql) — strhává další
// období u profilů, kterým končí (nebo skončilo) subscription_current_period_end.
// GoPay v ON_DEMAND režimu NIC nestrhává sama automaticky (viz _shared/gopay.ts)
// — o každou další platbu si appka musí říct explicitně přes create-recurrence.
//
// Po založení platby si stav rovnou ověříme (getPaymentStatus) — u uložené
// karty GoPay obvykle vyřídí platbu synchronně, není důvod čekat celý den
// na webhook. gopay-webhook navíc dorazí stejně (asynchronně) a jen
// potvrdí totéž — idempotentní, žádná kolize.
//
// Nasazení: supabase functions deploy gopay-charge-renewals
// Secrets: stejné GOPAY_* jako gopay-checkout/gopay-webhook.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createRecurrenceCharge, getPaymentStatus } from "../_shared/gopay.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const PLAN_PRICES: Record<string, { amountKc: number; label: string }> = {
  monthly: { amountKc: 299, label: "Para Pro — měsíční předplatné" },
  yearly: { amountKc: 2990, label: "Para Pro — roční předplatné" },
};

function periodEndFor(plan: string, from: Date): string {
  const end = new Date(from);
  if (plan === "yearly") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end.toISOString();
}

Deno.serve(async (_req) => {
  try {
    // 'active' i 'past_due' — past_due dostal appku z minula (dočasně
    // pořád funkční, viz isSubscriptionActive), tak zkusíme strhnout znovu
    // při dalším běhu cronu místo čekání na ruční zásah uživatele.
    const { data: dueProfiles, error } = await supabase
      .from("profiles")
      .select("id, subscription_plan, subscription_status, gopay_parent_payment_id")
      .in("subscription_status", ["active", "past_due"])
      .not("gopay_parent_payment_id", "is", null)
      .lte("subscription_current_period_end", new Date().toISOString());
    if (error) throw error;

    const results: any[] = [];

    for (const profile of dueProfiles || []) {
      const planInfo = PLAN_PRICES[profile.subscription_plan as string];
      if (!planInfo) {
        // Neznámý/chybějící tarif — nedá se spočítat částka, přeskočit a
        // zalogovat, ať to nezůstane potichu viset navždy jako "due".
        console.error(`gopay-charge-renewals: profil ${profile.id} nemá platný subscription_plan`);
        results.push({ userId: profile.id, skipped: "missing plan" });
        continue;
      }

      const orderNumber = `para-renew-${profile.id.slice(0, 8)}-${Date.now()}`;

      try {
        const charge = await createRecurrenceCharge(profile.gopay_parent_payment_id as string, {
          amountKc: planInfo.amountKc,
          orderNumber,
          orderDescription: planInfo.label,
          itemName: planInfo.label,
        });

        await supabase.from("payment_events").insert({
          user_id: profile.id,
          gopay_payment_id: String(charge.id),
          gopay_parent_payment_id: profile.gopay_parent_payment_id,
          event_type: "created",
          amount: planInfo.amountKc,
          raw_state: charge.state,
        });

        // Rovnou ověřit stav (viz komentář nahoře) — nečekat na webhook.
        const status = await getPaymentStatus(String(charge.id));

        if (status.state === "PAID") {
          await supabase
            .from("profiles")
            .update({
              subscription_status: "active",
              subscription_current_period_end: periodEndFor(profile.subscription_plan as string, new Date()),
            })
            .eq("id", profile.id);
          await supabase.from("payment_events").update({ event_type: "paid", raw_state: status.state }).eq("gopay_payment_id", String(charge.id));
          results.push({ userId: profile.id, paid: true });
        } else if (status.state === "CANCELED" || status.state === "TIMEOUTED") {
          await supabase.from("profiles").update({ subscription_status: "past_due" }).eq("id", profile.id);
          await supabase.from("payment_events").update({ event_type: "failed", raw_state: status.state }).eq("gopay_payment_id", String(charge.id));
          results.push({ userId: profile.id, failed: true, state: status.state });
        } else {
          // Ještě se nerozhodlo (např. čeká na potvrzení banky) — webhook
          // dořeší, jakmile GoPay bude vědět víc.
          results.push({ userId: profile.id, pending: true, state: status.state });
        }
      } catch (chargeErr) {
        console.error(`gopay-charge-renewals: platba pro ${profile.id} selhala:`, chargeErr);
        await supabase.from("profiles").update({ subscription_status: "past_due" }).eq("id", profile.id);
        results.push({ userId: profile.id, error: String(chargeErr) });
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
