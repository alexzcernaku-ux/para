// Tenký klient nad GoPay REST API - jen operace, které appka potřebuje pro
// předplatné (opakovaná platba na vyžádání, ne jednorázové platby).
//
// Ověřeno přímo z github.com/gopaycommunity/gopay-api-documentation
// (primární zdroj GoPay, staženo 2026-08-04), NE z paměti:
//   - OAuth: POST /oauth2/token, Basic <clientId>:<clientSecret>,
//     grant_type=client_credentials, scope=payment-all (payment-create by šlo
//     jen na založení platby, ne na status/create-recurrence).
//   - Založení opakované platby: POST /payments/payment,
//     recurrence.recurrence_cycle="ON_DEMAND" - další platby pak jen na
//     vyžádání přes create-recurrence, ne automaticky.
//   - Další platba: POST /payments/payment/{parent_id}/create-recurrence.
//   - Stav platby: GET /payments/payment/{id}. Notifikace na notification_url
//     nese JEN ?id=&parent_id= - appka si musí stav domyslet/dotázat sama,
//     GoPay nic dalšího neposílá (žádný podpis, žádné tělo požadavku).
//   - amount je VŽDY v haléřích (Kč × 100).
//
// Secrets: GOPAY_GOID, GOPAY_CLIENT_ID, GOPAY_CLIENT_SECRET, GOPAY_ENV
// ("sandbox" nebo "production" - cokoliv jiného než "production" = sandbox).

const GOID = Deno.env.get("GOPAY_GOID")!;
const CLIENT_ID = Deno.env.get("GOPAY_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("GOPAY_CLIENT_SECRET")!;
const IS_PRODUCTION = Deno.env.get("GOPAY_ENV") === "production";

const API_BASE = IS_PRODUCTION ? "https://gate.gopay.cz/api" : "https://gw.sandbox.gopay.com/api";

export type GopayPayer = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  city: string;
  street: string;
  postalCode: string;
};

async function getToken(scope: "payment-create" | "payment-all" = "payment-all"): Promise<string> {
  const res = await fetch(`${API_BASE}/oauth2/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
    },
    body: `grant_type=client_credentials&scope=${scope}`,
  });
  if (!res.ok) throw new Error(`GoPay OAuth selhalo: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function gopayFetch(path: string, init: RequestInit, scope?: "payment-create" | "payment-all") {
  const token = await getToken(scope);
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`GoPay vrátil neplatný JSON (${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok) throw new Error(`GoPay API chyba ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

/**
 * Založí opakovanou platbu v režimu ON_DEMAND - první platba za první
 * období, další se strhávají voláním createRecurrenceCharge() (viz
 * gopay-charge-renewals). Vrací gw_url, kam přesměrovat prohlížeč k platbě.
 */
export async function createSubscriptionPayment({
  amountKc,
  orderNumber,
  orderDescription,
  itemName,
  payer,
  userId,
  returnUrl,
  notificationUrl,
}: {
  amountKc: number;
  orderNumber: string;
  orderDescription: string;
  itemName: string;
  payer: GopayPayer;
  userId: string;
  returnUrl: string;
  notificationUrl: string;
}) {
  return gopayFetch("/payments/payment", {
    method: "POST",
    body: JSON.stringify({
      payer: {
        contact: {
          first_name: payer.firstName,
          last_name: payer.lastName,
          email: payer.email,
          phone_number: payer.phoneNumber,
          city: payer.city,
          street: payer.street,
          postal_code: payer.postalCode,
          country_code: "CZE",
        },
      },
      target: { type: "ACCOUNT", goid: GOID },
      amount: Math.round(amountKc * 100),
      currency: "CZK",
      order_number: orderNumber,
      order_description: orderDescription,
      items: [{ type: "ITEM", name: itemName, amount: Math.round(amountKc * 100), count: 1 }],
      recurrence: { recurrence_cycle: "ON_DEMAND", recurrence_date_to: "2035-12-31" },
      additional_params: [{ name: "user_id", value: userId }],
      callback: { return_url: returnUrl, notification_url: notificationUrl },
    }),
  }, "payment-create");
}

/** Strhne další období u dřív založené ON_DEMAND opakované platby. */
export async function createRecurrenceCharge(
  parentPaymentId: string,
  { amountKc, orderNumber, orderDescription, itemName }: { amountKc: number; orderNumber: string; orderDescription: string; itemName: string }
) {
  return gopayFetch(`/payments/payment/${parentPaymentId}/create-recurrence`, {
    method: "POST",
    body: JSON.stringify({
      amount: Math.round(amountKc * 100),
      currency: "CZK",
      order_number: orderNumber,
      order_description: orderDescription,
      items: [{ name: itemName, amount: Math.round(amountKc * 100) }],
    }),
  });
}

export async function getPaymentStatus(paymentId: string) {
  return gopayFetch(`/payments/payment/${paymentId}`, { method: "GET" });
}

export async function voidRecurrence(paymentId: string) {
  return gopayFetch(`/payments/payment/${paymentId}/void-recurrence`, { method: "POST" });
}
