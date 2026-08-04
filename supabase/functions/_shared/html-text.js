// Zjednodušený HTML → čistý text převod, čistě pro účely hashování obsahu
// stránky (check-form-updates). Nemusí být dokonalý — jen stabilní (stejný
// vstup → stejný výstup) a necitlivý na věci, co se mění při KAŽDÉM
// requestu bez ohledu na obsah (CSRF token, cache-busting timestamp v
// <script> bloku apod.), jinak by to hlásilo "změnu" každý den nanovo.
export function htmlToStableText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export async function sha256Hex(data) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
