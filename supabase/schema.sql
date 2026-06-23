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
    is_favorite       boolean not null default false,        -- shared "family favorites"
    notes             text,                                  -- family notes/tweaks
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

-- Editor/admin allowlist. Admins (is_admin) can also manage this list from the
-- in-app Admin page; everyone in the table is an editor.
create table if not exists public.allowed_emails (
    email    text primary key,
    is_admin boolean not null default false
);
alter table public.allowed_emails enable row level security;

-- Seed admins (also editors).
insert into public.allowed_emails (email, is_admin) values
    ('cgividen20@gmail.com', true),
    ('mgividen@gmail.com', true)
    on conflict (email) do update set is_admin = true;

-- is_editor() / is_admin(): true when the logged-in email is allowlisted (and, for
-- is_admin, flagged admin). SECURITY DEFINER so they read allowed_emails despite
-- RLS. The frontend calls them to decide what controls to show; the policies below
-- use them as the real boundary. Defined before the policies that reference them.
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
grant execute on function public.is_editor() to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.allowed_emails
    where lower(email) = lower(coalesce(auth.email(), '')) and is_admin
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Any editor can (un)favorite any recipe — favorites are a shared family list, so
-- this bypasses the owner-only update policy via SECURITY DEFINER.
create or replace function public.set_favorite(rid bigint, val boolean)
returns void language sql security definer set search_path = '' as $$
  update public.recipes set is_favorite = val
  where id = rid and public.is_editor();
$$;
revoke all on function public.set_favorite(bigint, boolean) from public;
grant execute on function public.set_favorite(bigint, boolean) to authenticated;

-- Admins manage the allowlist directly (RLS-gated). is_editor()/is_admin() are
-- SECURITY DEFINER so they bypass these policies and keep working.
drop policy if exists allowed_emails_admin_select on public.allowed_emails;
create policy allowed_emails_admin_select on public.allowed_emails
    for select to authenticated using (public.is_admin());
drop policy if exists allowed_emails_admin_insert on public.allowed_emails;
create policy allowed_emails_admin_insert on public.allowed_emails
    for insert to authenticated with check (public.is_admin());
drop policy if exists allowed_emails_admin_update on public.allowed_emails;
create policy allowed_emails_admin_update on public.allowed_emails
    for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists allowed_emails_admin_delete on public.allowed_emails;
create policy allowed_emails_admin_delete on public.allowed_emails
    for delete to authenticated using (public.is_admin());

-- Write policies: admins may modify any recipe; non-admin editors only ones they
-- created (created_by = their email). Inserts must stamp created_by as the
-- creator (admins exempt) so ownership can't be spoofed.
drop policy if exists recipes_editor_insert on public.recipes;
create policy recipes_editor_insert on public.recipes
    for insert to authenticated with check (
        public.is_admin()
        or (public.is_editor() and lower(coalesce(created_by, '')) = lower(coalesce(auth.email(), '')))
    );

drop policy if exists recipes_editor_update on public.recipes;
create policy recipes_editor_update on public.recipes
    for update to authenticated
    using (public.is_editor() and (public.is_admin() or lower(coalesce(created_by, '')) = lower(coalesce(auth.email(), ''))))
    with check (public.is_editor() and (public.is_admin() or lower(coalesce(created_by, '')) = lower(coalesce(auth.email(), ''))));

drop policy if exists recipes_editor_delete on public.recipes;
create policy recipes_editor_delete on public.recipes
    for delete to authenticated
    using (public.is_editor() and (public.is_admin() or lower(coalesce(created_by, '')) = lower(coalesce(auth.email(), ''))));

-- ── Image storage ──────────────────────────────────────────────────────────
-- Public bucket for recipe/card photos. Anyone can view; only allowlisted
-- editors can upload/replace/remove (same is_editor() gate as recipes).
insert into storage.buckets (id, name, public)
values ('recipe-images', 'recipe-images', true)
on conflict (id) do nothing;

-- No SELECT policy: a public bucket serves object URLs directly, and omitting
-- the policy prevents clients from listing every file in the bucket.

drop policy if exists "recipe images editor insert" on storage.objects;
create policy "recipe images editor insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'recipe-images' and public.is_editor());

drop policy if exists "recipe images editor update" on storage.objects;
create policy "recipe images editor update" on storage.objects
  for update to authenticated using (bucket_id = 'recipe-images' and public.is_editor());

drop policy if exists "recipe images editor delete" on storage.objects;
create policy "recipe images editor delete" on storage.objects
  for delete to authenticated using (bucket_id = 'recipe-images' and public.is_editor());
