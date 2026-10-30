-- newphoneprediction: the latest collected phone report (one row, id = 'latest').
create table if not exists phone_reports (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table phone_reports enable row level security;  -- the app reads it with the service role only
