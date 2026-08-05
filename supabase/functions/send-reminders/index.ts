// supabase/functions/send-reminders/index.ts
//
// Denní cron (viz 10_schema_cron_reminders.sql) - projde všechny profily,
// spočítá termíny (_shared/deadlines.js) a pošle e-mail, pokud termín
// vychází za 1–3 dny a ještě jsme na něj neupozornili (reminder_log).
//
// Secrets: supabase secrets set RESEND_API_KEY=... [RESEND_FROM=...]
// RESEND_FROM je volitelný - bez ověřené domény v Resendu se dá posílat
// jen z "onboarding@resend.dev" a jen na e-mail vlastníka Resend účtu
// (sandbox limit), ne reálným uživatelům. Až bude doména ověřená, nastav
// RESEND_FROM na vlastní adresu (např. "Para <pripominky@para.cz>").

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeDeadlines } from "../_shared/deadlines.js";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const RESEND_FROM = Deno.env.get("RESEND_FROM") || "Para <onboarding@resend.dev>";

const REMINDER_WINDOW_MIN_DAYS = 1;
const REMINDER_WINDOW_MAX_DAYS = 3;

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: RESEND_FROM, to, subject, html }),
  });
  if (!res.ok) {
    throw new Error(`Resend API error: ${res.status} ${await res.text()}`);
  }
}

function emailHtml(title: string, popis: string, datum: string, zdroj: string) {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
      <p style="color:#6366F1; font-weight:700; font-size:12px; letter-spacing:0.05em; text-transform:uppercase;">§ Para - připomínka termínu</p>
      <h2 style="color:#0F172A; margin: 8px 0 4px;">${title}</h2>
      <p style="color:#334155; font-size:15px;">Termín: <strong>${datum}</strong></p>
      <p style="color:#334155; font-size:14px;">${popis}</p>
      <p style="color:#94a3b8; font-size:12px; margin-top:20px;">Zdroj: ${zdroj}</p>
      <p style="color:#94a3b8; font-size:12px;">Para není daňové poradenství - u důležitých rozhodnutí konzultujte s odborníkem.</p>
    </div>`;
}

Deno.serve(async (req) => {
  try {
    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("id, legal_form, vat_payer")
      .not("onboarded_at", "is", null);
    if (error) throw error;

    const now = new Date();
    let sent = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const profile of profiles) {
      const deadlines = computeDeadlines(profile, now, { horizonDays: 10, maxItems: 20 });
      const due = deadlines.filter(
        (d: any) => d.zbyvaDni >= REMINDER_WINDOW_MIN_DAYS && d.zbyvaDni <= REMINDER_WINDOW_MAX_DAYS
      );
      if (!due.length) continue;

      for (const deadline of due) {
        // reminder_log má unique(user_id, deadline_key) - insert selže na
        // duplikátu, což použijeme přesně jako "už bylo odesláno" zámek.
        const { error: logError } = await supabase
          .from("reminder_log")
          .insert({ user_id: profile.id, deadline_key: deadline.key });
        if (logError) {
          skipped++;
          continue; // duplicate key = už odesláno dřív
        }

        try {
          const { data: userData, error: userError } = await supabase.auth.admin.getUserById(profile.id);
          if (userError || !userData?.user?.email) throw userError || new Error("Chybí e-mail uživatele.");

          await sendEmail(
            userData.user.email,
            `Za ${deadline.zbyvaDni} ${deadline.zbyvaDni === 1 ? "den" : "dny"}: ${deadline.title}`,
            emailHtml(
              deadline.title,
              deadline.popis,
              deadline.date.toLocaleDateString("cs-CZ", { day: "numeric", month: "long", year: "numeric" }),
              deadline.zdroj
            )
          );
          sent++;
        } catch (err) {
          errors.push(`${profile.id}/${deadline.key}: ${err.message}`);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, sent, skipped, errors }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
