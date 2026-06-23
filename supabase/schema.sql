-- Recipes schema. Run once in the Supabase SQL editor of the recipes project.
--
-- Access model: there is no app server. The browser talks to Supabase directly
-- with the anon key. Recipes are publicly readable (RLS select policy); writes
-- are allowed only for authenticated users whose email is in allowed_emails,
-- enforced by RLS write policies via is_editor(). The allowed_emails table is
-- itself unreadable from the client (RLS, no policies) and is consulted only
-- through the SECURITY DEFINER is_editor() function.

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
    image_url         text,                                 -- photo of the recipe/card (Supabase Storage)
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

-- Public read for anon + authenticated.
drop policy if exists recipes_public_read on public.recipes;
create policy recipes_public_read on public.recipes
    for select to anon, authenticated using (true);

-- Editor allowlist. RLS on with no policies => unreachable by anon/authenticated;
-- only the service role and SECURITY DEFINER functions can read it.
create table if not exists public.allowed_emails (
    email text primary key
);
alter table public.allowed_emails enable row level security;

-- Add the editors here (or via the Supabase dashboard).
insert into public.allowed_emails (email) values ('cgividen20@gmail.com')
    on conflict (email) do nothing;

-- is_editor(): true when the logged-in user's email is allowlisted. SECURITY
-- DEFINER so it can read allowed_emails despite RLS. Called by the frontend to
-- decide whether to show edit controls, and by the write policies below.
create or replace function public.is_editor()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.allowed_emails
    where lower(email) = lower(coalesce(auth.email(), ''))
  );
$$;

revoke all on function public.is_editor() from public;
grant execute on function public.is_editor() to anon, authenticated;

-- Write policies: only allowlisted, authenticated editors may modify recipes.
drop policy if exists recipes_editor_insert on public.recipes;
create policy recipes_editor_insert on public.recipes
    for insert to authenticated with check (public.is_editor());

drop policy if exists recipes_editor_update on public.recipes;
create policy recipes_editor_update on public.recipes
    for update to authenticated using (public.is_editor()) with check (public.is_editor());

drop policy if exists recipes_editor_delete on public.recipes;
create policy recipes_editor_delete on public.recipes
    for delete to authenticated using (public.is_editor());

-- ── Image storage ──────────────────────────────────────────────────────────
-- Public bucket for recipe/card photos. Anyone can view; only allowlisted
-- editors can upload/replace/remove (same is_editor() gate as recipes).
insert into storage.buckets (id, name, public)
values ('recipe-images', 'recipe-images', true)
on conflict (id) do nothing;

drop policy if exists "recipe images public read" on storage.objects;
create policy "recipe images public read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'recipe-images');

drop policy if exists "recipe images editor insert" on storage.objects;
create policy "recipe images editor insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'recipe-images' and public.is_editor());

drop policy if exists "recipe images editor update" on storage.objects;
create policy "recipe images editor update" on storage.objects
  for update to authenticated using (bucket_id = 'recipe-images' and public.is_editor());

drop policy if exists "recipe images editor delete" on storage.objects;
create policy "recipe images editor delete" on storage.objects
  for delete to authenticated using (bucket_id = 'recipe-images' and public.is_editor());
