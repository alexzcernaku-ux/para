# Zákoník — AI asistent na účetní/daňové zákony

Kompletní návod krok za krokem. Předpokládá, že už máš Supabase účet a projekt (podle tvého stacku).

## Co budeš potřebovat
- Supabase projekt (existující, nebo nový přes supabase.com — free tier stačí na start)
- OpenAI API klíč (na embeddings — https://platform.openai.com/api-keys, pár haléřů za tisíce paragrafů)
- Anthropic API klíč (na samotné odpovídání — https://console.anthropic.com)
- Node.js nainstalovaný lokálně (na spuštění ingest skriptu)
- Supabase CLI (`npm install -g supabase`) — na nasazení edge function

---

## Krok 1 — Databáze
1. Otevři svůj Supabase projekt → **SQL Editor** → New query
2. Vlož obsah `01_schema.sql` a spusť (Run)
3. Ověř v **Table Editor**, že vznikla tabulka `law_chunks`

## Krok 2 — Nasbírej texty zákonů
Ve složce `laws/` je vzorový soubor `563-1991-ucetnictvi.txt` s formátem, který ingest skript čeká:
```
ZÁKON: 563/1991 Sb.
NAZEV: Zákon o účetnictví
URL: https://www.zakonyprolidi.cz/cs/1991-563

§ 1
(text paragrafu)

§ 2
(text paragrafu)
```
Pro start doporučuju tyto 4 zákony (nejvíc pokryjí účetní/daňové dotazy):
- **563/1991 Sb.** — zákon o účetnictví
- **586/1992 Sb.** — zákon o daních z příjmů
- **235/2004 Sb.** — zákon o DPH
- **500/2002 Sb.** — vyhláška (prováděcí k účetnictví pro podnikatele)

Text zkopíruješ ručně z **zakonyprolidi.cz** (přehledné znění po paragrafech) do stejnojmenných `.txt` souborů ve `laws/`. Je to jediná ruční část celého procesu — zabere to tak hodinu na všechny 4 zákony, zbytek je automatický.

*(Pozn.: jakmile budeš chtít automatické stahování + hlídání novel, existuje registrace na e-Sbírka open data API — ale pro MVP se tomu radši vyhni, jejich datová struktura je nepříjemná na parsování.)*

## Krok 3 — Ingest (nahrání do databáze)
```bash
cd zakon-ai
export SUPABASE_URL="https://tvuj-projekt.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="tvůj service_role klíč (Project Settings → API)"
export OPENAI_API_KEY="tvůj OpenAI klíč"

node 02_ingest.mjs
```
Uvidíš postup paragraf po paragrafu. Pár desítek/stovek paragrafů = pár minut a pár centů na OpenAI účtu.

## Krok 4 — Edge function (mozek dotazování)
```bash
supabase login
supabase link --project-ref TVUJ_PROJECT_REF

mkdir -p supabase/functions/zakon-query
cp 03_edge_function/index.ts supabase/functions/zakon-query/index.ts

supabase secrets set OPENAI_API_KEY="tvůj OpenAI klíč"
supabase secrets set ANTHROPIC_API_KEY="tvůj Anthropic klíč"

supabase functions deploy zakon-query
```
Po nasazení dostaneš URL typu:
`https://tvuj-projekt.supabase.co/functions/v1/zakon-query`

## Krok 5 — Frontend
1. Otevři `04_frontend/index.html`
2. Uprav na začátku `<script>`:
   - `ENDPOINT` → URL edge function z kroku 4
   - `SUPABASE_ANON_KEY` → Project Settings → API → `anon public` klíč
3. Otevři soubor v prohlížeči nebo ho nahraj kamkoliv (Vercel, Netlify, i jen jako statický soubor v Supabase Storage)

Hotovo — máš funkční chat, který odpovídá na dotazy s citací konkrétního paragrafu.

---

## Co dodělat později (ne pro MVP)
- Víc zákonů (ČÚS, zákoník práce pro mzdové účetnictví, atd.)
- Automatické sledování novel (e-Sbírka API, nebo jen měsíční ruční re-ingest)
- Historie konverzace (teď se ptáš vždy nezávisle — bez kontextu předchozích zpráv)
- Login/rate limiting, pokud by to používal někdo mimo tebe

## Odhad nákladů
- Supabase: free tier stačí na tisíce paragrafů
- OpenAI embeddings: jednorázově pár desítek Kč za všechny 4 zákony
- Anthropic API (Claude Sonnet): řádově pár Kč za dotaz, podle délky kontextu — desítky dotazů denně budou v řádu stokorun/měsíc
