-- 0048 · Endurecimento de segurança (revisão do backoffice)
--
-- (A regra das férias — ninguém aprova os próprios dias — já está na 0046.)
-- 1. Telefone do perfil: único (o assistente de WhatsApp identifica quem fala
--    pelo número; dois perfis com o mesmo bloqueavam a vítima e um número de
--    fora recebia avisos com dados de contactos).
-- 2. Contactos externos do WhatsApp: só quem tem o separador Integrações.
--
-- Idempotente: pode correr-se mais de uma vez. Aplicar no Supabase → SQL Editor.

begin;

-- 1 ── profiles.phone único (pela forma normalizada). Se já existirem números
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

-- 2 ── wa_contacts: nome, empresa e mensagens de pessoas externas.
drop policy if exists "wa_contacts: staff read" on public.wa_contacts;
create policy "wa_contacts: staff read"
  on public.wa_contacts for select to authenticated
  using (public.has_section('integracoes'));

commit;
