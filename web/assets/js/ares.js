// Klient pro veřejné ARES REST API (ares.gov.cz) — žádný klíč, CORS povolené
// pro libovolný origin (ověřeno 2026-07-31), takže se volá přímo z prohlížeče.
//
// právníForma "112" = s.r.o., "101"-"108" = varianty fyzické osoby podnikající
// (standardní číselník ČSÚ, používaný napříč ARES/RÚIAN) — díky tomu jde
// při onboardingu rovnou napovědět OSVČ/s.r.o., i když paušál/skutečné
// výdaje si u OSVČ musí uživatel stejně zvolit sám (to ARES neví).

const PRAVNI_FORMA_SRO = "112";
const PRAVNI_FORMA_OSVC_RE = /^10[1-8]$/;

export async function lookupIco(ico) {
  const clean = (ico || "").replace(/\s/g, "");
  if (!/^\d{8}$/.test(clean)) throw new Error("IČO musí mít přesně 8 číslic.");

  const res = await fetch(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${clean}`, {
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) throw new Error("Tohle IČO se v ARES nenašlo — zkontrolujte prosím číslo.");
  if (!res.ok) throw new Error(`ARES odpověděl chybou (${res.status}).`);

  const data = await res.json();
  const pravniForma = data.pravniForma || "";

  return {
    ico: data.ico,
    dic: data.dic || null,
    companyName: data.obchodniJmeno || null,
    address: data.sidlo?.textovaAdresa || null,
    vatPayer: data.seznamRegistraci?.stavZdrojeDph === "AKTIVNI",
    isSro: pravniForma === PRAVNI_FORMA_SRO,
    isOsvc: PRAVNI_FORMA_OSVC_RE.test(pravniForma),
  };
}
