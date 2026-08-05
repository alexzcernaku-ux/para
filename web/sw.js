// Minimální service worker - splňuje podmínku prohlížečů pro nabídku
// "Přidat na plochu" (potřebuje registrovaný SW s fetch handlerem).
// Vědomě bez cachování: appka běží nad živými daty ze Supabase, takže
// offline cache by mohla ukázat zastaralý/nesprávný stav účtu.
self.addEventListener("fetch", () => {});
