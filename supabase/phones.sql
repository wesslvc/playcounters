-- newphoneprediction: per-phone research dossiers, their history, followed phones, and search jobs.
create table if not exists phone_dossiers (
  id text primary key,
  brand text not null,
  name text not null,
  data jsonb not null,
  image jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists phone_snapshots (
  id bigserial primary key,
  phone_id text not null references phone_dossiers(id) on delete cascade,
  taken_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists phone_snapshots_phone_idx on phone_snapshots (phone_id, taken_at);
create table if not exists phone_watch (
  phone_id text primary key references phone_dossiers(id) on delete cascade,
  last_requested_at timestamptz not null default now()
);
create table if not exists phone_jobs (
  id text primary key,
  status text not null default 'running',
  request jsonb not null,
  progress jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  ip_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table phone_dossiers enable row level security;   -- the app uses the service role only
alter table phone_snapshots enable row level security;
alter table phone_watch enable row level security;
alter table phone_jobs enable row level security;
