-- Apply after 006. Personal preferences never update shared tasks.
alter table public.tasks add column submission_url text not null default '' check(length(submission_url)<=2048 and (submission_url='' or submission_url ~* '^https?://'));
create table public.task_reminder_preferences (
 task_id uuid not null references public.tasks(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 reminder_offsets integer[], repeat_rule text, repeat_time time,
 evening_before boolean not null default false, snooze_until timestamptz,
 primary key(task_id,user_id),
 check(reminder_offsets is null or (cardinality(reminder_offsets)<=5 and reminder_offsets <@ array[0,10,60,180,1440,4320,10080])),
 check(repeat_rule is null or repeat_rule in ('none','daily','weekdays','weekly')),
 check((reminder_offsets is null and repeat_rule is null and repeat_time is null and not evening_before) or
 (reminder_offsets is not null and repeat_rule is not null and ((repeat_rule='none')=(repeat_time is null))))
);
alter table public.task_reminder_preferences enable row level security;
create policy "Own accessible preferences" on public.task_reminder_preferences for all to authenticated
 using(user_id=auth.uid() and exists(select 1 from public.tasks t where t.id=task_id))
 with check(user_id=auth.uid() and exists(select 1 from public.tasks t where t.id=task_id));
create function public.personal_reminder_slots(task public.tasks, pref public.task_reminder_preferences)
returns setof timestamptz language sql stable set search_path=public as $$
 select s from public.reminder_slots(task.due_at,coalesce(pref.reminder_offsets,task.reminder_offsets),coalesce(pref.repeat_rule,task.repeat_rule),
 case when pref.repeat_rule is null then task.repeat_time else pref.repeat_time end) s
 where (pref.snooze_until is null or s>pref.snooze_until) and s<=task.due_at
 union
 select (((task.due_at at time zone 'Europe/Moscow')::date-1)+time '19:00') at time zone 'Europe/Moscow'
 where pref.evening_before and (pref.snooze_until is null or (((task.due_at at time zone 'Europe/Moscow')::date-1)+time '19:00') at time zone 'Europe/Moscow'>pref.snooze_until)
 union select pref.snooze_until where pref.snooze_until is not null;
$$;
create or replace function public.claim_reminders() returns table(task_id uuid,user_id uuid,title text,subject text,due_at timestamptz,slot timestamptz,claimed_at timestamptz)
language plpgsql security definer set search_path=public as $$
begin
 delete from public.reminder_deliveries d where d.slot<now()-interval '7 days';
 insert into public.reminder_deliveries(task_id,user_id,slot)
 select t.id,r.user_id,s.slot from public.tasks t
 cross join lateral (select t.user_id where t.group_id is null and t.user_id is not null
 union all select m.user_id from public.group_members m where m.group_id=t.group_id) r
 left join public.task_reminder_preferences pref on pref.task_id=t.id and pref.user_id=r.user_id
 cross join lateral public.personal_reminder_slots(t,pref) s(slot)
 where not t.completed and s.slot<=now() and s.slot>now()-interval '1 day'
 and exists(select 1 from public.push_subscriptions p where p.user_id=r.user_id and not(t.id=any(p.hidden_task_ids)))
 on conflict do nothing;
 return query with pending as (
 select d.task_id,d.user_id,d.slot from public.reminder_deliveries d join public.tasks t on t.id=d.task_id
 left join public.task_reminder_preferences pref on pref.task_id=t.id and pref.user_id=d.user_id
 where d.sent_at is null and (d.claimed_at is null or d.claimed_at<now()-interval '5 minutes')
 and not t.completed and d.slot<=now() and d.slot>now()-interval '1 day'
 and d.slot in(select public.personal_reminder_slots(t,pref))
 and ((t.group_id is null and t.user_id=d.user_id) or exists(select 1 from public.group_members m where m.group_id=t.group_id and m.user_id=d.user_id))
 and exists(select 1 from public.push_subscriptions p where p.user_id=d.user_id and not(t.id=any(p.hidden_task_ids)))
 order by d.slot limit 20 for update of d skip locked
 ), claimed as (
 update public.reminder_deliveries d set claimed_at=now() from pending p
 where d.task_id=p.task_id and d.user_id=p.user_id and d.slot=p.slot returning d.*
 ) select c.task_id,c.user_id,t.title,t.subject,t.due_at,c.slot,c.claimed_at from claimed c join public.tasks t on t.id=c.task_id;
end; $$;
revoke all on function public.personal_reminder_slots(public.tasks,public.task_reminder_preferences),public.claim_reminders() from public,anon,authenticated;
grant execute on function public.claim_reminders() to service_role;

-- Metadata only. Objects stay private in S3. Client writes only via reservation RPC.
create table public.task_attachments (
 id uuid primary key default gen_random_uuid(),
 task_id uuid references public.tasks(id) on delete set null,
 user_id uuid references auth.users(id) on delete set null,
 object_key text not null unique, name text not null check(length(name) between 1 and 180),
 content_type text not null, size_bytes integer not null check(size_bytes between 1 and 10485760),
 status text not null default 'pending' check(status in ('pending','ready','deleting')),
 created_at timestamptz not null default now()
);
alter table public.task_attachments enable row level security;
create index attachment_task on public.task_attachments(task_id,status);
create policy "Read ready attachments" on public.task_attachments for select to authenticated using(status='ready' and exists(select 1 from public.tasks t where t.id=task_id));
create function public.reserve_attachment(target uuid,file_name text,mime text,bytes integer) returns public.task_attachments
language plpgsql security definer set search_path=public as $$
declare result public.task_attachments; identifier uuid:=gen_random_uuid();
begin
 if auth.uid() is null or not exists(select 1 from public.tasks where id=target and user_id=auth.uid()) then raise exception 'Forbidden';end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 if (select count(*) from public.task_attachments where task_id=target and status<>'deleting')>=6 then raise exception 'Не больше 6 файлов на задание';end if;
 if (select coalesce(sum(size_bytes),0) from public.task_attachments where user_id=auth.uid())+bytes>209715200 then raise exception 'Лимит вложений: 200 МБ на пользователя';end if;
 if mime not in ('image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','text/plain','application/zip') then raise exception 'Unsupported file type';end if;
 insert into public.task_attachments(id,task_id,user_id,object_key,name,content_type,size_bytes)
 values(identifier,target,auth.uid(),'attachments/'||auth.uid()||'/'||identifier, file_name,mime,bytes) returning * into result;
 return result;
end; $$;
revoke all on function public.reserve_attachment(uuid,text,text,integer) from public,anon;
grant execute on function public.reserve_attachment(uuid,text,text,integer) to authenticated;
