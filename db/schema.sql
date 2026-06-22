-- Recipes schema. Run once in the Supabase SQL editor of the recipes project.
--
-- Access model: the backend mediates everything via the service-role key.
-- Recipes are publicly readable; writes go only through the service role.
-- RLS is enabled as defense-in-depth so a leaked anon key can read but not write.

create table if not exists public.recipes (
    id                bigint generated always as identity primary key,
    title             text not null,
    description       text,
    ingredients       jsonb not null default '[]'::jsonb,   -- array of strings
    instructions      jsonb not null default '[]'::jsonb,   -- array of strings (steps)
    prep_time_minutes integer,
    cook_time_minutes integer,
    servings          text,
    tags              text[] not null default '{}',
    source_url        text,
    created_by        text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

create index if not exists recipes_updated_at_idx on public.recipes (updated_at desc);

-- Keep updated_at current on every update.
create or replace function public.set_updated_at()
returns trigger language plpgsql
set search_path = '' as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists recipes_set_updated_at on public.recipes;
create trigger recipes_set_updated_at
    before update on public.recipes
    for each row execute function public.set_updated_at();

alter table public.recipes enable row level security;

-- Public read for anon + authenticated. No insert/update/delete policies exist,
-- so only the service-role key (which bypasses RLS) can write.
drop policy if exists recipes_public_read on public.recipes;
create policy recipes_public_read on public.recipes
    for select to anon, authenticated using (true);

-- Editor allowlist managed by the backend (service role only). RLS on with no
-- policies => unreachable by anon/authenticated; only the service role sees it.
create table if not exists public.allowed_emails (
    email text primary key
);
alter table public.allowed_emails enable row level security;
