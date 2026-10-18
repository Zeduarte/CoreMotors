-- Contactos externos do número de WhatsApp.
--
-- Até aqui o número era só do pessoal: uma mensagem de um telefone sem perfil
-- ficava sem resposta. Agora é o número da marca, para toda a gente. Quem não
-- é colaborador é um contacto, e identifica-se SEMPRE pela empresa e pelo cargo
-- (o assistente pergunta-os na primeira conversa). Os colaboradores continuam a
-- ser reconhecidos pelo telefone do perfil e não passam por aqui.
begin;

create table if not exists public.wa_contacts (
  -- Telefone normalizado (normalize_phone): uma linha por pessoa.
  phone           text primary key,
  -- O nome do perfil de WhatsApp, tal como a Meta o entrega.
  profile_name    text,
  name            text,
  company         text,
  role            text,
  -- Em que ponto da apresentação vai: company → role → done.
  step            text not null default 'company' check (step in ('company', 'role', 'done')),
  first_message   text,
  last_message    text,
  messages        int  not null default 1,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index if not exists idx_wa_contacts_last on public.wa_contacts (last_message_at desc);

-- O staff vê; só o servidor (chave de serviço) escreve.
alter table public.wa_contacts enable row level security;
revoke all on public.wa_contacts from anon, authenticated;
grant select on public.wa_contacts to authenticated;

drop policy if exists "wa_contacts: staff read" on public.wa_contacts;
create policy "wa_contacts: staff read"
  on public.wa_contacts for select to authenticated
  using (public.is_staff());

commit;
