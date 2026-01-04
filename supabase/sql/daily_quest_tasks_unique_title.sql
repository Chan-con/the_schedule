-- Enforce unique daily quest titles per user+date
--
-- Notes:
-- - This uses title_key = lower(btrim(title)).
-- - The app also normalizes with NFKC + lowercase; Postgres core does not provide NFKC.
--   This DB rule is still effective for preventing simple duplicates.
--
-- Step 0) (Optional) Inspect duplicates that would violate the constraint
--
-- select
--   user_id,
--   date_str,
--   lower(btrim(title)) as title_key,
--   count(*)
-- from public.daily_quest_tasks
-- group by 1,2,3
-- having count(*) > 1
-- order by count(*) desc;
--
-- Step 1) Remove duplicates (keeps the first row per (user_id, date_str, title_key))
with ranked as (
  select
    ctid,
    row_number() over (
      partition by user_id, date_str, lower(btrim(title))
      order by created_at asc, id asc
    ) as rn
  from public.daily_quest_tasks
)
delete from public.daily_quest_tasks t
using ranked r
where t.ctid = r.ctid
  and r.rn > 1;

-- Step 2) Add generated key column
alter table public.daily_quest_tasks
  add column if not exists title_key text
  generated always as (lower(btrim(title))) stored;

-- Step 3) Add unique index
create unique index if not exists daily_quest_tasks_user_date_title_key_uniq
  on public.daily_quest_tasks (user_id, date_str, title_key);

-- Step 4) (Optional) Ensure Realtime publication includes the table
-- alter publication supabase_realtime add table public.daily_quest_tasks;
