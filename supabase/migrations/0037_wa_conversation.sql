-- Memória curta das conversas do assistente interno por WhatsApp.
--
-- Até aqui cada mensagem era interpretada sozinha: se o assistente perguntava
-- «qual BMW?» e a pessoa respondia «o preto», a resposta chegava sem a pergunta
-- e não se percebia. Guardam-se agora as últimas mensagens de cada número (o
-- que a pessoa escreveu e o que o assistente respondeu, em texto), e só essas
-- voltam ao modelo.
--
-- Só texto: nunca se guardam blocos de pensamento nem resultados de
-- ferramentas, por isso o que volta ao modelo é exactamente o que a pessoa leu
-- no WhatsApp. E é memória CURTA de propósito — dois dias chegam para uma
-- conversa, e não se acumula um histórico de mensagens de colaboradores.
--
-- O número 0036 está reservado para as notificações por WhatsApp.
begin;

create table if not exists public.wa_conversation (
  id         bigserial primary key,
  -- O número, ou a chave do simulador do backoffice («sim:<id>»).
  from_phone text not null,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null check (length(content) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists wa_conversation_phone_idx
  on public.wa_conversation (from_phone, created_at desc);

-- Canalização de servidor, como wa_messages: RLS activa e nenhuma política.
alter table public.wa_conversation enable row level security;
revoke all on public.wa_conversation from anon, authenticated;
revoke all on sequence public.wa_conversation_id_seq from anon, authenticated;

-- A limpeza que já corre na manutenção passa a apagar também a memória antiga.
-- `create or replace` mantém os privilégios definidos na 0024 (só service_role).
create or replace function public.prune_whatsapp() returns void
language sql security definer set search_path = public as $$
  delete from public.wa_messages where received_at < now() - interval '7 days';
  delete from public.wa_pending_actions
   where status <> 'pending' and created_at < now() - interval '1 day';
  delete from public.wa_conversation where created_at < now() - interval '2 days';
$$;

commit;
