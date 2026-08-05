-- Spusť v Supabase: Dashboard → SQL Editor → New query → vlož a Run

-- 1) Zapnout pgvector rozšíření (Supabase ho má předinstalované)
create extension if not exists vector;

-- 2) Tabulka na jednotlivé paragrafy zákonů
create table if not exists law_chunks (
  id bigint generated always as identity primary key,
  law_code text not null,          -- např. '563/1991 Sb.'
  law_name text not null,          -- např. 'Zákon o účetnictví'
  section_ref text,                -- např. '§ 4 odst. 2'
  content text not null,           -- samotný text paragrafu
  source_url text,                 -- odkaz na zakonyprolidi.cz / e-sbirka.cz
  embedding vector(1536),          -- embedding z OpenAI text-embedding-3-small
  created_at timestamptz default now()
);

-- 3) Index pro rychlé vektorové vyhledávání (cosine similarity)
-- POZOR: ivfflat index byl záměrně zrušen (drop index) - u pár tisíc řádků
-- dělá s výchozím probes=1 přibližné vyhledávání víc škody než užitku (mine
-- skutečně nejbližší shody). Sekvenční scan je při tomto objemu dat rychlejší
-- i přesnější. Index vracet zpět až při reálně velkém množství dat (statisíce+
-- řádků), a to s rozumným lists (~√počet řádků) a nastaveným probes.
-- create index if not exists law_chunks_embedding_idx
--   on law_chunks using ivfflat (embedding vector_cosine_ops)
--   with (lists = 100);

-- 4) Funkce pro similarity search (volá ji edge function)
create or replace function match_law_chunks (
  query_embedding vector(1536),
  match_count int default 8
)
returns table (
  id bigint,
  law_code text,
  law_name text,
  section_ref text,
  content text,
  source_url text,
  similarity float
)
language sql stable
as $$
  select
    id, law_code, law_name, section_ref, content, source_url,
    1 - (embedding <=> query_embedding) as similarity
  from law_chunks
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- 5) (Volitelné) Row Level Security - zákony jsou veřejná data, čtení pro všechny
alter table law_chunks enable row level security;
create policy "Public read access" on law_chunks
  for select using (true);
