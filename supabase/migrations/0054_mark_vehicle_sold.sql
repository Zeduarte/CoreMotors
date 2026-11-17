-- 0054 · Marcar uma viatura como vendida diretamente (sem contacto)
--
-- Para vendas ao balcão, sem contacto no backoffice: na lista de Viaturas (ou
-- na ficha) escolhe-se «Vendida» e indica-se o preço e a data. Fica registado
-- como no «Concluir venda» do contacto — a viatura passa a vendida e o preço
-- e a data vão para os Custos (vehicle_financials), para a margem ficar certa.
--
-- Regras (as mesmas do contacto, menos o próprio contacto):
--  - é preciso acesso a Viaturas e a Custos, e ao tipo de viatura;
--  - preço maior que zero e data não futura;
--  - não serve para uma viatura com reserva ativa (essa conclui-se no
--    contacto da reserva) nem para uma já vendida ou na oficina.
--
-- Idempotente: pode correr-se mais de uma vez. Aplicar no Supabase → SQL Editor.
-- Antes de a aplicar, o backoffice faz o mesmo em dois passos (sem a garantia
-- de ser tudo ou nada).

begin;

create or replace function public.mark_vehicle_sold(vehicle uuid, amount numeric, sale_date date) returns void
language plpgsql security definer set search_path = public as $$
declare current_status public.car_status; vtype text;
begin
  if not public.has_section('carros') or not public.has_section('financeiro') then
    raise exception 'É necessário acesso a viaturas e a custos';
  end if;
  if amount is null or amount <= 0 or sale_date is null or sale_date > (now() at time zone 'Europe/Lisbon')::date then
    raise exception 'Valor ou data inválida';
  end if;
  select status, vehicle_type into current_status, vtype from public.cars where id = vehicle for update;
  if current_status is null then raise exception 'Viatura não encontrada'; end if;
  if not public.has_vehicle_type_for(auth.uid(), vtype) then raise exception 'Sem permissão'; end if;
  if current_status not in ('draft', 'prepared', 'published', 'reserved') then
    raise exception 'Viatura indisponível';
  end if;
  if exists (select 1 from public.reservations where car_id = vehicle and status = 'active') then
    raise exception 'Viatura com reserva ativa: conclua a venda no contacto do cliente';
  end if;
  update public.cars set status = 'sold', sold_at = sale_date::timestamptz where id = vehicle;
  insert into public.vehicle_financials (car_id, sale_price, sold_on)
  values (vehicle, amount, sale_date)
  on conflict (car_id) do update set sale_price = excluded.sale_price, sold_on = excluded.sold_on, updated_at = now();
end $$;

revoke all on function public.mark_vehicle_sold(uuid, numeric, date) from public, anon;
grant execute on function public.mark_vehicle_sold(uuid, numeric, date) to authenticated;

commit;
