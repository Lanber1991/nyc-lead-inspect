-- Run this in Supabase SQL Editor (supabase.com → your project → SQL Editor)

create table if not exists inspections (
  id                  uuid primary key default gen_random_uuid(),
  report_number       text not null,
  inspector_name      text,
  property_address    text,
  property_city       text,
  property_state_zip  text,
  client_name         text,
  inspection_date     text,
  purpose             text,
  status              text not null default 'pending',
  form_data           jsonb,
  lab_data            jsonb,
  work_plan_data      jsonb,
  report_html         text,
  submitted_at        timestamptz default now(),
  updated_at          timestamptz default now()
);

-- Auto-update updated_at on changes
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger inspections_updated_at
  before update on inspections
  for each row execute function update_updated_at();

-- Allow public read/write via anon key (Row Level Security off for simplicity)
-- For production, enable RLS and add proper policies
alter table inspections enable row level security;

create policy "Allow all for anon" on inspections
  for all using (true) with check (true);
