-- Apply after 002. Автор правит и удаляет своё задание; остальные участники — нет.
alter table public.tasks drop constraint tasks_reminder_minutes_check;
alter table public.tasks add constraint tasks_reminder_minutes_check
 check(reminder_minutes in (0,10,60,180,1440,4320,10080));
drop policy "Update personal only" on public.tasks;
drop policy "Delete personal only" on public.tasks;
create policy "Update own tasks" on public.tasks for update to authenticated
 using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "Delete own tasks" on public.tasks for delete to authenticated using(user_id=auth.uid());
-- Задание не переезжает в другую группу и не меняет автора.
create function public.keep_task_owner() returns trigger language plpgsql set search_path=public as $$
begin
 if new.group_id is distinct from old.group_id or new.user_id is distinct from old.user_id then
 raise exception 'Автор и группа задания не меняются';
 end if;
 return new;
end; $$;
create trigger task_owner_guard before update on public.tasks for each row execute function public.keep_task_owner();
