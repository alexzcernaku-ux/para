// supabase/functions/gopay-webhook/index.ts
//
// GoPay notification_url - voláno GoPay serverem (ne prohlížečem uživatele)
// po každé změně stavu platby (založení i pozdější opakovaná platba).
//
// DŮLEŽITÉ (ověřeno v GoPay dokumentaci): notifikace nese JEN
// ?id=<payment_id>&parent_id=<volitelně> v query stringu - ŽÁDNÉ tělo,
// ŽÁDNÝ podpis. Nedá se jí tedy věřit samotné o sobě (kdokoli by mohl
// uhodnout/zavolat tuhle URL s libovolným id). Zdroj pravdy je vždy
// GET /payments/payment/{id} (getPaymentStatus) - teprve podle TOHO se
// rozhoduje, ne podle query parametrů.
//
// Idempotentní: GoPay může stejnou notifikaci poslat vícekrát, a
// gopay-charge-renewals si status navíc ověřuje i sama rovnou po založení
// platby - tenhle handler proto může doběhnout na stejné id klidně
// vícekrát, jen přepisuje stav na aktuální (žádné "+= navýšení").
//
// Nasazení: supabase functions deploy gopay-webhook
// V GoPay administraci (nebo při zakládání platby v gopay-checkout) musí
// notification_url ukazovat sem: https://<projekt>.supabase.co/functions/v1/gopay-webhook

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getPaymentStatus } from "../_shared/gopay.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// GoPay nečeká na obsah odpovědi, jen na 2xx - cokoliv jiného zkusí poslat
// znovu. Vždy vracíme 200, i při "nenalezeno" (nedává smysl nechat GoPay
// bušit na endpoint, který nikdy neuspěje).
function ok(body: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ ok: true, ...body }), { headers: { "Content-Type": "application/json" } });
}

function periodEndFor(plan: string | null, from: Date): string {
  const end = new Date(from);
  if (plan === "yearly") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end.toISOString();
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const paymentId = url.searchParams.get("id");
    if (!paymentId) return ok({ skipped: "missing id" });

    // Zdroj pravdy - nikdy nevěřit tomu, co si notifikace "myslí", že se stalo.
    const status = await getPaymentStatus(paymentId);

    const { data: paymentEvent } = await supabase
      .from("payment_events")
      .select("user_id")
      .eq("gopay_payment_id", paymentId)
      .maybeSingle();

    if (!paymentEvent) {
      // Platba, o které nevíme (cizí id, nebo appka ji nikdy nezaložila) -
      // nic proti tomu se dá dělat, jen zalogovat a potvrdit příjem.
      console.warn(`gopay-webhook: neznámé payment id ${paymentId}, state=${status.state}`);
      return ok({ skipped: "unknown payment" });
    }

    const userId = paymentEvent.user_id;
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_plan, subscription_current_period_end")
      .eq("id", userId)
      .maybeSingle();

    if (status.state === "PAID") {
      // Nové období počítáme od TEĎ (ne od předchozího konce) - u
      // opožděného ruční obnovení by jinak vznikla mezera bez přístupu.
      const newPeriodEnd = periodEndFor(profile?.subscription_plan ?? null, new Date());
      await supabase
        .from("profiles")
        .update({
          subscription_status: "active",
          subscription_current_period_end: newPeriodEnd,
          gopay_parent_payment_id: url.searchParams.get("parent_id") || paymentId,
        })
        .eq("id", userId);
      await supabase
        .from("payment_events")
        .update({ event_type: "paid", raw_state: status.state })
        .eq("gopay_payment_id", paymentId);
    } else if (status.state === "CANCELED" || status.state === "TIMEOUTED") {
      // Neúspěšná platba: u obnovy (uživatel už dřív aktivní) dáme
      // 'past_due' - appku ještě chvíli používat jde (viz
      // isSubscriptionActive v supabase-client.js), než se to vyřeší nebo
      // appka to při dalším pokusu zkusí znovu. U první platby žádné
      // předplatné nikdy nebylo aktivní, takže není co degradovat.
      const isRenewalFailure = profile && profile.subscription_current_period_end;
      await supabase
        .from("payment_events")
        .update({ event_type: "failed", raw_state: status.state })
        .eq("gopay_payment_id", paymentId);
      if (isRenewalFailure) {
        await supabase.from("profiles").update({ subscription_status: "past_due" }).eq("id", userId);
      }
    } else {
      // Mezistav (CREATED, PAYMENT_METHOD_CHOSEN, AUTHORIZED...) - jen
      // dohledatelnost, bez dopadu na subscription_status.
      await supabase
        .from("payment_events")
        .update({ raw_state: status.state })
        .eq("gopay_payment_id", paymentId);
    }

    return ok({ state: status.state });
  } catch (err) {
    console.error(err);
    // I na chybu 200 - GoPay by jinak notifikaci opakovala do nekonečna a
    // chyba (typicky výpadek DB) se stejně dá zjistit jen z logů appky.
    return ok({ error: String(err) });
  }
});
