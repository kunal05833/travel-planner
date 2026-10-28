-- Run this in Supabase Dashboard > SQL Editor
create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  destination text not null,
  start_date date not null,
  end_date date not null,
  budget numeric not null,
  currency text not null default 'INR',
  travel_style text default 'balanced',
  group_size int not null default 1,
  interests text[] default '{}',
  pace text default 'moderate',
  stay_type text default 'mid-range',
  created_at timestamptz default now()
);

create table if not exists itinerary_days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day_number int not null,
  title text default '',
  activities jsonb not null default '[]',
  estimated_cost numeric default 0,
  unique (trip_id, day_number)
);

alter table trips enable row level security;
alter table itinerary_days enable row level security;

create policy "own trips" on trips for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own days" on itinerary_days for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
