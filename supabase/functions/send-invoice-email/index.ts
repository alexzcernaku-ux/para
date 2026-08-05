// supabase/functions/send-invoice-email/index.ts
//
// Odešle vygenerovanou fakturu (PDF) klientovi e-mailem přímo z appky -
// volá se z generator-dokumentu.html po kliknutí na "Odeslat e-mailem".
// Stejný Resend účet jako send-reminders, viz komentář tam k
// RESEND_API_KEY / RESEND_FROM (sandbox limit bez ověřené domény).
//
// Uživatele bereme výhradně z JWT (stejně jako gopay-checkout), ne z těla
// požadavku - "reply-to" tak vždy sedí na skutečně přihlášeného uživatele,
// ne na cokoliv, co by šlo podvrhnout v request body.
//
// Nasazení: supabase functions deploy send-invoice-email

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const RESEND_FROM = Deno.env.get("RESEND_FROM") || "Para <onboarding@resend.dev>";

const MAX_PDF_BASE64_LENGTH = 15_000_000; // ~11 MB souboru po dekódování, ať jde daleko pod 40MB limit Resendu

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function emailHtml(supplierName: string, docNumber: string, message: string) {
  const safeMessage = message?.trim()
    ? `<p style="color:#334155; font-size:14px; white-space:pre-wrap;">${message.trim().replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!))}</p>`
    : "";
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
      <p style="color:#6366F1; font-weight:700; font-size:12px; letter-spacing:0.05em; text-transform:uppercase;">§ Faktura ${docNumber || ""}</p>
      <h2 style="color:#0F172A; margin: 8px 0 4px;">${supplierName} Vám zasílá fakturu</h2>
      ${safeMessage}
      <p style="color:#334155; font-size:14px;">Faktura je přiložena jako PDF.</p>
      <p style="color:#94a3b8; font-size:12px; margin-top:20px;">Odesláno přes aplikaci Para.</p>
    </div>`;
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

    const body = await req.json().catch(() => ({}));
    const toEmail = String(body.toEmail || "").trim();
    const supplierName = String(body.supplierName || "").trim() || "Vaše firma";
    const docNumber = String(body.docNumber || "").trim();
    const message = String(body.message || "");
    const pdfBase64 = String(body.pdfBase64 || "");
    const pdfFilename = String(body.pdfFilename || "faktura.pdf");

    if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      return json({ error: "Chybí nebo je neplatný e-mail příjemce." }, 400);
    }
    if (!pdfBase64) return json({ error: "Chybí PDF příloha." }, 400);
    if (pdfBase64.length > MAX_PDF_BASE64_LENGTH) return json({ error: "Příloha je příliš velká." }, 400);

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: toEmail,
        reply_to: user.email,
        subject: `Faktura${docNumber ? ` č. ${docNumber}` : ""} od ${supplierName}`,
        html: emailHtml(supplierName, docNumber, message),
        attachments: [{ filename: pdfFilename, content: pdfBase64, content_type: "application/pdf" }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Resend API error:", res.status, errText);
      return json({ error: "Odeslání e-mailu se nepovedlo, zkuste to prosím znovu." }, 502);
    }

    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
  }
});
