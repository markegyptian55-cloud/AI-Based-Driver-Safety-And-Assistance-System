create or replace function public.can_read_audit_row(_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.org_members m
    join public.org_members a
      on a.organization_id = m.organization_id
    where m.user_id = auth.uid()
      and m.role in ('manager','admin')
      and a.user_id = _actor
  );
$$;

revoke execute on function public.can_read_audit_row(uuid) from anon;
grant execute on function public.can_read_audit_row(uuid) to authenticated;

drop policy if exists "Reserved manager reads audit log" on public.audit_log;

create policy "Managers read own-org audit log"
on public.audit_log
for select
to authenticated
using (public.can_read_audit_row(actor_id));