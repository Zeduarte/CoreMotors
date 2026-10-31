-- 0044 · Endurecimento de segurança (revisão do backoffice)
--
-- 1. Férias: ninguém aprova os próprios dias.
-- 2. Telefone do perfil: único (o assistente de WhatsApp identifica quem fala
--    pelo número; dois perfis com o mesmo bloqueavam a vítima e um número de
--    fora recebia avisos com dados de contactos).
-- 3. Contactos externos do WhatsApp: só quem tem o separador Integrações.
--
-- Idempotente: pode correr-se mais de uma vez. Aplicar no Supabase → SQL Editor.

begin;

-- 1 ── leave_days: a política «own update» deixava o dono mudar o `status` para
-- «approved» (o `with check` não olhava ao estado). Passa a valer a mesma regra
-- no `using` e no `with check`.
drop policy if exists "leave_days: own update" on public.leave_days;
create policy "leave_days: own update"
  on public.leave_days for update to authenticated
  using (
    (profile_id = auth.uid() and status in ('draft', 'pending'))
    or public.can_decide_leave_for(profile_id)
  )
  with check (
    (profile_id = auth.uid() and status in ('draft', 'pending'))
    or public.can_decide_leave_for(profile_id)
  );

-- 2 ── profiles.phone único (pela forma normalizada). Se já existirem números
-- repetidos, não se cria o índice e fica o aviso: corrigir à mão e voltar a correr.
do $$
begin
  if exists (
    select 1 from public.profiles
    where phone is not null and public.normalize_phone(phone) <> ''
    group by public.normalize_phone(phone)
    having count(*) > 1
  ) then
    raise notice 'profiles.phone tem números repetidos: índice único NÃO criado. Corrija os perfis e volte a correr a migração.';
  else
    create unique index if not exists profiles_phone_unique
      on public.profiles (public.normalize_phone(phone))
      where phone is not null and public.normalize_phone(phone) <> '';
  end if;
end $$;

-- 3 ── wa_contacts: nome, empresa e mensagens de pessoas externas.
drop policy if exists "wa_contacts: staff read" on public.wa_contacts;
create policy "wa_contacts: staff read"
  on public.wa_contacts for select to authenticated
  using (public.has_section('integracoes'));

commit;
