-- Apply after 005. Несколько напоминаний на задание вместо одного.
alter table public.tasks add column if not exists reminder_offsets integer[];
update public.tasks set reminder_offsets=array[coalesce(reminder_minutes,1440)] where reminder_offsets is null;
alter table public.tasks alter column reminder_offsets set default '{1440}';
alter table public.tasks alter column reminder_offsets set not null;
alter table public.tasks drop constraint if exists tasks_reminder_offsets_valid;
alter table public.tasks add constraint tasks_reminder_offsets_valid check(
 reminder_offsets <@ array[0,10,60,180,1440,4320,10080] and coalesce(array_length(reminder_offsets,1),0)<=5
);
-- reminder_minutes остаётся ради старых клиентов и больше не читается.
-- Слотов теперь может быть несколько: по одному на каждое напоминание.
drop function if exists public.reminder_slot(timestamptz,integer,text,time);
create or replace function public.reminder_slots(due timestamptz, offsets integer[], rule text, at_time time)
returns setof timestamptz language plpgsql stable set search_path=public as $$
declare day date; slot timestamptz; due_dow integer;
begin
 if rule is null or rule='none' or at_time is null then
 return query select due - make_interval(mins=>o) from unnest(coalesce(offsets,'{}'::integer[])) o;
 return;
 end if;
 due_dow := extract(isodow from (due at time zone 'Europe/Moscow'));
 day := (now() at time zone 'Europe/Moscow')::date;
 for i in 0..8 loop
 slot := (day + at_time) at time zone 'Europe/Moscow';
 if slot<=now() and (rule='daily'
 or (rule='weekdays' and extract(isodow from day)<=5)
 or (rule='weekly' and extract(isodow from day)=due_dow)) then
 return next slot;
 return;
 end if;
 day := day - 1;
 end loop;
 return;
end; $$;
create or replace function public.claim_reminders() returns table(task_id uuid,user_id uuid,title text,subject text,due_at timestamptz,slot timestamptz,claimed_at timestamptz)
language plpgsql security definer set search_path=public as $$
begin
 -- slot — ещё и имя выходной колонки функции, поэтому квалифицируем.
 delete from public.reminder_deliveries d where d.slot<now()-interval '7 days';
 insert into public.reminder_deliveries(task_id,user_id,slot)
 select t.id,recipients.user_id,s.slot from public.tasks t
 cross join lateral public.reminder_slots(t.due_at,t.reminder_offsets,t.repeat_rule,t.repeat_time) as s(slot)
 cross join lateral (
  select t.user_id where t.group_id is null and t.user_id is not null
  union all select m.user_id from public.group_members m where m.group_id=t.group_id
 ) recipients
 where not t.completed and s.slot<=now() and s.slot>now()-interval '1 day'
 and s.slot<=t.due_at and t.due_at>now()-interval '1 day'
 and exists(select 1 from public.push_subscriptions p where p.user_id=recipients.user_id and not(t.id=any(p.hidden_task_ids)))
 on conflict do nothing;
 return query
 with pending as (
  select d.task_id,d.user_id,d.slot from public.reminder_deliveries d join public.tasks t on t.id=d.task_id
  where d.sent_at is null and (d.claimed_at is null or d.claimed_at<now()-interval '5 minutes')
  and not t.completed and d.slot<=now() and d.slot>now()-interval '1 day'
  and d.slot<=t.due_at and t.due_at>now()-interval '1 day'
  and ((t.group_id is null and t.user_id=d.user_id) or exists(select 1 from public.group_members m where m.group_id=t.group_id and m.user_id=d.user_id))
  and exists(select 1 from public.push_subscriptions p where p.user_id=d.user_id and not(t.id=any(p.hidden_task_ids)))
  order by d.slot limit 20 for update of d skip locked
 ), claimed as (
  update public.reminder_deliveries d set claimed_at=now() from pending p
  where d.task_id=p.task_id and d.user_id=p.user_id and d.slot=p.slot returning d.*
 ) select c.task_id,c.user_id,t.title,t.subject,t.due_at,c.slot,c.claimed_at from claimed c join public.tasks t on t.id=c.task_id;
end; $$;
revoke all on function public.reminder_slots(timestamptz,integer[],text,time),public.claim_reminders() from public,anon,authenticated;
grant execute on function public.claim_reminders() to service_role;
