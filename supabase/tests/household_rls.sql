-- household_rls.sql — checks the recipe write policies against real RLS.
--
-- Run it in the SQL editor (or via the Supabase MCP execute_sql) as postgres.
-- Everything happens inside one transaction that is rolled back, with made-up
-- @test.invalid editors, so it leaves the live data untouched. The last SELECT
-- lists every case; a passing run is all ok = true.

begin;

insert into public.allowed_emails (email, is_admin, household) values
    ('t-ann@test.invalid',   false, 't-house'),
    ('t-ben@test.invalid',   false, 't-house'),
    ('t-cat@test.invalid',   false, null),
    ('t-admin@test.invalid', true,  null);

insert into public.recipes (title, created_by) values
    ('t-ann recipe', 't-ann@test.invalid'),
    ('t-ben recipe', 'T-Ben@Test.invalid'),
    ('t-cat recipe', 't-cat@test.invalid');

create temp table results (name text, ok boolean) on commit drop;
grant insert, select on results to authenticated;

-- Ben edits Ann's recipe: same household, so allowed.
select set_config('request.jwt.claims', '{"email":"t-ben@test.invalid","role":"authenticated"}', true);
set local role authenticated;
with u as (update public.recipes set notes = 'ben was here' where title = 't-ann recipe' returning 1)
insert into results select 'household member can update', count(*) = 1 from u;
insert into results select 'my_household lists both, lowercased',
    array(select public.my_household() order by 1) = array['t-ann@test.invalid', 't-ben@test.invalid'];
-- Ben cannot hand the recipe to someone outside the household: the WITH CHECK
-- rejects it with an error rather than matching no rows.
do $$
begin
    update public.recipes set created_by = 't-cat@test.invalid' where title = 't-ann recipe';
    insert into results values ('cannot move a recipe out of the household', false);
exception when insufficient_privilege then
    insert into results values ('cannot move a recipe out of the household', true);
end $$;
-- Ben cannot touch Cat's recipe.
with u as (update public.recipes set notes = 'nope' where title = 't-cat recipe' returning 1)
insert into results select 'non-member cannot update', count(*) = 0 from u;
with d as (delete from public.recipes where title = 't-cat recipe' returning 1)
insert into results select 'non-member cannot delete', count(*) = 0 from d;
reset role;

-- Ann deletes Ben's recipe (stored with mixed case): allowed.
select set_config('request.jwt.claims', '{"email":"t-ann@test.invalid","role":"authenticated"}', true);
set local role authenticated;
with d as (delete from public.recipes where title = 't-ben recipe' returning 1)
insert into results select 'household member can delete, any case', count(*) = 1 from d;
reset role;

-- Cat, with no household, cannot edit Ann's recipe but can edit her own.
select set_config('request.jwt.claims', '{"email":"t-cat@test.invalid","role":"authenticated"}', true);
set local role authenticated;
with u as (update public.recipes set notes = 'nope' where title = 't-ann recipe' returning 1)
insert into results select 'no household: cannot update others', count(*) = 0 from u;
with u as (update public.recipes set notes = 'mine' where title = 't-cat recipe' returning 1)
insert into results select 'no household: can update own', count(*) = 1 from u;
insert into results select 'no household: my_household is empty', not exists (select public.my_household());
reset role;

-- An admin can still edit anything.
select set_config('request.jwt.claims', '{"email":"t-admin@test.invalid","role":"authenticated"}', true);
set local role authenticated;
with u as (update public.recipes set notes = 'admin' where title = 't-cat recipe' returning 1)
insert into results select 'admin can update anything', count(*) = 1 from u;
reset role;

select name, ok from results;

rollback;
