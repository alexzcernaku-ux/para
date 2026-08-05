// supabase/functions/recurring-invoices-run/index.ts
//
// Denní cron (viz 28_schema_cron_recurring_invoices.sql) - pro každou
// aktivní šablonu z recurring_invoices, jejíž next_run_date už nastal,
// vytvoří evidenční záznam ve Sledování faktur (invoices) a pošle
// uživateli e-mail připomínku, ať doklad reálně vygeneruje a odešle přes
// Generátor dokumentů. Neposílá a negeneruje PDF samo - viz komentář v
// 27_schema_recurring_invoices.sql, proč je to vědomý scope.
//
// Nasazení: supabase functions deploy recurring-invoices-run

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const RESEND_FROM = Deno.env.get("RESEND_FROM") || "Para <onboarding@resend.dev>";

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: RESEND_FROM, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend API error: ${res.status} ${await res.text()}`);
}

function emailHtml(counterpartyName: string, amountKc: number, dueDate: string) {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
      <p style="color:#6366F1; font-weight:700; font-size:12px; letter-spacing:0.05em; text-transform:uppercase;">§ Para - opakující se faktura</p>
      <h2 style="color:#0F172A; margin: 8px 0 4px;">Je čas vystavit fakturu pro ${counterpartyName}</h2>
      <p style="color:#334155; font-size:14px;">Do Sledování faktur jsme rovnou přidali záznam na <strong>${amountKc.toLocaleString("cs-CZ")} Kč</strong> se splatností <strong>${dueDate}</strong>.</p>
      <p style="color:#334155; font-size:14px;">Samotný doklad si prosím vygenerujte v Generátoru dokumentů - PDF appka negeneruje automaticky, ať si údaje před odesláním můžete zkontrolovat.</p>
      <p style="color:#94a3b8; font-size:12px; margin-top:20px;">Opakování si můžete upravit nebo zrušit ve Sledování faktur.</p>
    </div>`;
}

// next_run_date se počítá vždy od PŮVODNÍHO next_run_date, ne od dneška -
// když cron jeden den vynechá, datum se neposune, jen se ta faktura založí
// o den později, což je bezpečnější než při dlouhém výpadku poskočit o víc
// období najednou.
function advanceDate(dateStr: string, unit: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  if (unit === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else if (unit === "quarterly") d.setUTCMonth(d.getUTCMonth() + 3);
  else if (unit === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const { data: due, error } = await supabase
      .from("recurring_invoices")
      .select("*")
      .eq("active", true)
      .lte("next_run_date", today);
    if (error) throw error;

    let created = 0;
    const errors: string[] = [];

    for (const template of due || []) {
      try {
        const issueDate = today;
        const dueDate = new Date(Date.now() + template.due_days * 86400000).toISOString().slice(0, 10);

        const { error: insertError } = await supabase.from("invoices").insert({
          user_id: template.user_id,
          direction: "vystavena",
          number: null,
          counterparty_name: template.counterparty_name,
          counterparty_ico: template.counterparty_ico,
          issue_date: issueDate,
          due_date: dueDate,
          amount: template.amount,
          vat_amount: template.vat_amount || 0,
          note: template.note,
        });
        if (insertError) throw insertError;

        const nextRunDate = advanceDate(template.next_run_date, template.interval_unit);
        const { error: updateError } = await supabase
          .from("recurring_invoices")
          .update({ next_run_date: nextRunDate })
          .eq("id", template.id);
        if (updateError) throw updateError;

        created++;

        try {
          const { data: userData } = await supabase.auth.admin.getUserById(template.user_id);
          if (userData?.user?.email) {
            await sendEmail(
              userData.user.email,
              `Opakující se faktura: ${template.counterparty_name}`,
              emailHtml(template.counterparty_name, Number(template.amount), new Date(dueDate).toLocaleDateString("cs-CZ"))
            );
          }
        } catch (mailErr) {
          errors.push(`e-mail ${template.id}: ${mailErr.message}`);
        }
      } catch (err) {
        errors.push(`${template.id}: ${err.message}`);
      }
    }

    return new Response(JSON.stringify({ ok: true, created, errors }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
