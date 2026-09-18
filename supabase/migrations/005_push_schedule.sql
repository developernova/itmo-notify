-- Apply after 004. Срок больше не переносится: истёк — задание в архиве, push прекращаются.
drop function if exists public.roll_repeating_tasks();
drop function if exists public.next_due(timestamptz,text);
update public.tasks set repeat_rule='none' where repeat_rule not in ('none','daily','weekdays','weekly');
alter table public.tasks drop constraint if exists tasks_repeat_rule_check;
alter table public.tasks add constraint tasks_repeat_rule_check
 check(repeat_rule in ('none','daily','weekdays','weekly'));
-- Время повтора задаётся пользователем и считается по Москве, как и подпись в push.
alter table public.tasks add column if not exists repeat_time time;
-- Повторы из прошлой версии времени не знали: берём время срока по Москве.
update public.tasks set repeat_time=(due_at at time zone 'Europe/Moscow')::time
 where repeat_rule<>'none' and repeat_time is null;
update public.tasks set repeat_time=null where repeat_rule='none' and repeat_time is not null;
alter table public.tasks drop constraint if exists tasks_repeat_time_set;
alter table public.tasks add constraint tasks_repeat_time_set
 check((repeat_rule='none')=(repeat_time is null));
-- Момент, когда push должен уйти: ближайший прошедший слот по правилу повтора.
create or replace function public.reminder_slot(due timestamptz, mins integer, rule text, at_time time) returns timestamptz
language plpgsql stable set search_path=public as $$
declare day date; slot timestamptz; due_dow integer;
begin
 if rule is null or rule='none' or at_time is null then
 return due - make_interval(mins=>coalesce(mins,0));
 end if;
 due_dow := extract(isodow from (due at time zone 'Europe/Moscow'));
 day := (now() at time zone 'Europe/Moscow')::date;
 for i in 0..8 loop
 slot := (day + at_time) at time zone 'Europe/Moscow';
 if slot<=now() and (rule='daily'
 or (rule='weekdays' and extract(isodow from day)<=5)
 or (rule='weekly' and extract(isodow from day)=due_dow)) then
 return slot;
 end if;
 day := day - 1;
 end loop;
 return null;
end; $$;
-- Доставка учитывается по слоту: у повтора их много, у разового один.
drop function if exists public.claim_reminders();
drop table if exists public.reminder_deliveries;
create table public.reminder_deliveries (
 task_id uuid not null references public.tasks(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 slot timestamptz not null,
 claimed_at timestamptz,
 sent_at timestamptz,
 primary key(task_id,user_id,slot)
);
alter table public.reminder_deliveries enable row level security;
create function public.claim_reminders() returns table(task_id uuid,user_id uuid,title text,subject text,due_at timestamptz,slot timestamptz,claimed_at timestamptz)
language plpgsql security definer set search_path=public as $$
begin
 -- slot — ещё и имя выходной колонки функции, поэтому квалифицируем.
 delete from public.reminder_deliveries d where d.slot<now()-interval '7 days';
 insert into public.reminder_deliveries(task_id,user_id,slot)
 select t.id,recipients.user_id,s.slot from public.tasks t
 cross join lateral (select public.reminder_slot(t.due_at,t.reminder_minutes,t.repeat_rule,t.repeat_time) as slot) s
 cross join lateral (
  select t.user_id where t.group_id is null and t.user_id is not null
  union all select m.user_id from public.group_members m where m.group_id=t.group_id
 ) recipients
 where not t.completed and s.slot is not null and s.slot<=now() and s.slot>now()-interval '1 day'
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
revoke all on function public.reminder_slot(timestamptz,integer,text,time),public.claim_reminders() from public,anon,authenticated;
grant execute on function public.claim_reminders() to service_role;
