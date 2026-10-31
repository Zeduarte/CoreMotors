-- Backoffice: oficina, horas e férias.
--
--  1. Registar na oficina uma viatura do tipo carro falhava: a 0019/0028
--     gravavam portas e lugares a NULL, e as colunas são NOT NULL. Só as motas
--     entravam. Agora o carro fica com os valores por defeito da tabela (os
--     mesmos que a ficha propõe e que a `create_workshop_intake` sempre usou);
--     quem completa a ficha corrige-os antes de publicar.
--  2. Férias: quem pede deixava de precisar de chefe — um pedido direto à API
--     punha o próprio dia como aprovado. O próprio só grava rascunho/pedido;
--     aprovar e recusar fica para quem pode decidir (`can_decide_leave_for`).
--     Um dia recusado pode voltar a ser pedido.
--  3. Horas da oficina: cada um mexe nos seus registos. Quem está acima na
--     hierarquia (o administrador; o chefe sobre vendedores e mecânicos) pode
--     corrigir os dos outros — a mesma regra das férias.
--  4. Totais de horas por viatura calculados na base de dados (vista), em vez
--     de ler todos os registos para o servidor — a API corta em 1000 linhas.
--  5. Apagar um utilizador já não apaga as horas dele: ficam sem dono, como
--     as da oficina, e com o nome guardado.
--
-- Pode ser corrida mais de uma vez.
begin;

-- ---------------------------------------------------------------------------
-- 1. Entrada na oficina
-- ---------------------------------------------------------------------------
create or replace function public.create_workshop_intake_for_type(vehicle_name text,plate text,selected_type text) returns uuid
language plpgsql security definer set search_path=public as $$
declare result uuid := gen_random_uuid();
begin
  if not public.has_section('oficina') then raise exception 'Sem permissão'; end if;
  if selected_type is null or selected_type not in ('car','motorcycle') then raise exception 'Tipo inválido'; end if;
  if vehicle_name is null or plate is null or length(trim(vehicle_name)) not between 1 and 120 or length(trim(plate)) not between 2 and 20 then raise exception 'Dados inválidos'; end if;
  if selected_type = 'motorcycle' then
    insert into public.cars(id,slug,make,model,year,license_plate,fuel,transmission,body,status,price_on_request,created_by,vehicle_type,doors,seats)
    values(result,'oficina-'||result,trim(vehicle_name),'—',null,upper(trim(plate)),null,null,null,'workshop',true,auth.uid(),selected_type,0,2);
  else
    -- Portas e lugares ficam com o valor por defeito da tabela.
    insert into public.cars(id,slug,make,model,year,license_plate,fuel,transmission,body,status,price_on_request,created_by,vehicle_type)
    values(result,'oficina-'||result,trim(vehicle_name),'—',null,upper(trim(plate)),null,null,null,'workshop',true,auth.uid(),selected_type);
  end if;
  return result;
end $$;
revoke all on function public.create_workshop_intake_for_type(text,text,text) from public;
grant execute on function public.create_workshop_intake_for_type(text,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Férias: o próprio pede, quem está acima decide
-- ---------------------------------------------------------------------------
drop policy if exists "leave_days: own update" on public.leave_days;
create policy "leave_days: own update"
  on public.leave_days for update to authenticated
  using (
    (profile_id = auth.uid() and status in ('draft', 'pending', 'rejected'))
    or public.can_decide_leave_for(profile_id)
  )
  with check (
    (profile_id = auth.uid() and status in ('draft', 'pending'))
    or public.can_decide_leave_for(profile_id)
  );

-- Um dia que volta a rascunho ou a pedido deixa de ter decisão: assim não se
-- herda "decidido por" de uma recusa anterior, nem se inventa um.
create or replace function public.leave_days_clear_decision() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status in ('draft', 'pending') then
    new.decided_by := null;
    new.decided_at := null;
  end if;
  return new;
end $$;
revoke all on function public.leave_days_clear_decision() from public, anon, authenticated;

drop trigger if exists leave_days_clear_decision on public.leave_days;
create trigger leave_days_clear_decision
  before insert or update on public.leave_days
  for each row execute function public.leave_days_clear_decision();

-- ---------------------------------------------------------------------------
-- 3. Horas da oficina: os próprios, ou de quem está abaixo
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_hours_of(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  -- A regra de quem está acima é a das férias (0041). Registos de quem já foi
  -- apagado (sem dono) ficam só para o administrador, que decide tudo.
  select auth.uid() is not null
     and (coalesce(target = auth.uid(), false)
          or coalesce(public.can_decide_leave_as(auth.uid(), target), false));
$$;
revoke all on function public.can_manage_hours_of(uuid) from public, anon;
grant execute on function public.can_manage_hours_of(uuid) to authenticated, service_role;

-- Quem regista é quem está autenticado, se o pedido não disser outra coisa.
alter table public.vehicle_tasks alter column created_by set default auth.uid();

drop policy if exists "tasks: workshop" on public.vehicle_tasks;
drop policy if exists "tasks: workshop read" on public.vehicle_tasks;
create policy "tasks: workshop read" on public.vehicle_tasks for select to authenticated
using (public.has_section('oficina'));

drop policy if exists "tasks: workshop insert" on public.vehicle_tasks;
create policy "tasks: workshop insert" on public.vehicle_tasks for insert to authenticated
with check (public.has_section('oficina') and public.can_manage_hours_of(created_by));

drop policy if exists "tasks: workshop update" on public.vehicle_tasks;
create policy "tasks: workshop update" on public.vehicle_tasks for update to authenticated
using (public.has_section('oficina') and public.can_manage_hours_of(created_by))
with check (public.has_section('oficina') and public.can_manage_hours_of(created_by));

drop policy if exists "tasks: workshop delete" on public.vehicle_tasks;
create policy "tasks: workshop delete" on public.vehicle_tasks for delete to authenticated
using (public.has_section('oficina') and public.can_manage_hours_of(created_by));

-- ---------------------------------------------------------------------------
-- 4. Totais de horas por viatura
-- ---------------------------------------------------------------------------
-- `security_invoker`: a vista obedece ao RLS de quem consulta, como a tabela.
create or replace view public.vehicle_task_totals
with (security_invoker = true) as
  select car_id, sum(hours)::numeric(10,2) as total_hours, count(*)::int as log_count
    from public.vehicle_tasks
   group by car_id;
revoke all on public.vehicle_task_totals from anon;
grant select on public.vehicle_task_totals to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Horas de quem foi apagado
-- ---------------------------------------------------------------------------
alter table public.vehicle_tasks add column if not exists created_by_name text;
alter table public.time_entries add column if not exists profile_name text;

alter table public.time_entries alter column profile_id drop not null;
alter table public.time_entries drop constraint if exists time_entries_profile_id_fkey;
alter table public.time_entries add constraint time_entries_profile_id_fkey
  foreign key (profile_id) references public.profiles(id) on delete set null;

-- Antes de o perfil desaparecer, o nome fica nos registos de horas.
create or replace function public.keep_hours_author_name() returns trigger
language plpgsql security definer set search_path = public as $$
declare nome text := coalesce(nullif(old.full_name, ''), old.email, 'Utilizador apagado');
begin
  update public.vehicle_tasks set created_by_name = nome where created_by = old.id;
  update public.time_entries set profile_name = nome where profile_id = old.id;
  return old;
end $$;
revoke all on function public.keep_hours_author_name() from public, anon, authenticated;

drop trigger if exists keep_hours_author_name on public.profiles;
create trigger keep_hours_author_name
  before delete on public.profiles
  for each row execute function public.keep_hours_author_name();

commit;
