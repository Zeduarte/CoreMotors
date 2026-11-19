-- 0055 · Versão do site (tema Core / Core2): só o acesso core a muda
--
-- O tema do site público escolhe-se no backoffice, em Gestão, e fica em
-- `site_content` (chave `theme`, ex.: {"theme": "core2"}), que o público já lê.
-- Gestão é só do acesso core — o dono da conta (`profiles.is_owner`); nem os
-- administradores do stand a mudam. A app já o verifica; aqui fica a mesma
-- regra na base de dados (políticas restritivas, que se somam às de 0013/0049).
--
-- Idempotente: pode correr-se mais de uma vez. Aplicar no Supabase → SQL Editor.

begin;

-- O utilizador autenticado é o dono da conta?
create or replace function public.is_owner()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_owner from public.profiles where id = auth.uid()), false);
$$;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

drop policy if exists "content: owner-only keys insert" on public.site_content;
create policy "content: owner-only keys insert" on public.site_content
  as restrictive for insert to authenticated
  with check (key <> 'theme' or public.is_owner());

drop policy if exists "content: owner-only keys update" on public.site_content;
create policy "content: owner-only keys update" on public.site_content
  as restrictive for update to authenticated
  using (key <> 'theme' or public.is_owner())
  with check (key <> 'theme' or public.is_owner());

drop policy if exists "content: owner-only keys delete" on public.site_content;
create policy "content: owner-only keys delete" on public.site_content
  as restrictive for delete to authenticated
  using (key <> 'theme' or public.is_owner());

commit;
