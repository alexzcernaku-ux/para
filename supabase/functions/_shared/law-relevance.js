// Jednoduché, natvrdo zapsané pravidlo, kterých profilů se změna daného
// zákona týká - ne obecný newsletter všem, jak chtělo zadání Fáze 7.
// Vědomé zjednodušení: mapování podle law_code, ne podle obsahu konkrétního
// paragrafu (na to by bylo potřeba sémantickou analýzu navíc za cenu dalšího
// LLM volání při každé novele - u téhle sady zákonů stačí tahle hrubší mapa).
export function isLawRelevantToProfile(lawCode, profile) {
  if (lawCode === "235/2004 Sb.") return profile.vat_payer === true; // DPH
  if (lawCode === "90/2012 Sb.") return profile.legal_form === "sro"; // obchodní korporace
  // Zákon o daních z příjmů, o účetnictví, pojistné, daňový řád apod. -
  // týká se OSVČ i s.r.o. obou, proto výchozí "ano".
  return true;
}
