-- Create the profiles table: one row per application user profile.
-- This is the first production table — nothing in the app reads or writes
-- it yet, and no other schema depends on it.

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null unique,
  role text not null,
  preferred_language text not null,
  avatar_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'Application user profiles.';

-- Row Level Security is enabled with no policies yet. Until policies are
-- added, this table is fully locked down for every client using the
-- publishable key — that's the safe default before it's wired to auth or
-- the UI, not an oversight.
alter table public.profiles enable row level security;
