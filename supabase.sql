-- Im Supabase Dashboard unter "SQL Editor" einmalig ausführen.
create table if not exists lists (
  id text primary key,
  data jsonb not null,
  created timestamptz not null default now()
);

create table if not exists claims (
  list_id text not null,
  gift_id text not null,
  name text not null,
  token text not null,
  created timestamptz not null default now(),
  primary key (list_id, gift_id)  -- verhindert doppelte Reservierung
);

-- Kein öffentlicher Zugriff: nur der Server (Service-Key) darf lesen/schreiben.
alter table lists enable row level security;
alter table claims enable row level security;
