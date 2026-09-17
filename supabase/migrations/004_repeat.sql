-- Apply after 003. Повторяющиеся напоминания: срок сам переезжает на следующий раз.
alter table public.tasks add column repeat_rule text not null default 'none'
 check(repeat_rule in ('none','daily','weekdays','weekly','monthly'));
-- Будни считаются по московскому времени — так же, как подписан текст push.
create function public.next_due(due timestamptz, rule text) returns timestamptz
language plpgsql stable set search_path=public as $$
declare result timestamptz := due;
begin
 if rule is null or rule='none' then return due; end if;
 for guard in 1..500 loop
 result := result + case rule when 'weekly' then interval '7 days' when 'monthly' then interval '1 month' else interval '1 day' end;
 if rule='weekdays' then
 while extract(isodow from result at time zone 'Europe/Moscow')>5 loop result := result + interval '1 day'; end loop;
 end if;
 exit when result>now();
 end loop;
 return result;
end; $$;
-- Запас в 10 минут: сначала уходит напоминание текущего повтора, потом сдвигается срок.
create function public.roll_repeating_tasks() returns integer
language plpgsql security definer set search_path=public as $$
declare moved integer;
begin
 update public.tasks set due_at=public.next_due(due_at,repeat_rule)
 where repeat_rule<>'none' and not completed and due_at<now()-interval '10 minutes';
 get diagnostics moved = row_count;
 return moved;
end; $$;
revoke all on function public.next_due(timestamptz,text),public.roll_repeating_tasks() from public,anon,authenticated;
grant execute on function public.roll_repeating_tasks() to service_role;
