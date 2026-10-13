-- Ligação ao número de WhatsApp da empresa, feita no backoffice.
--
-- Até aqui o número e o token viviam só nas variáveis do Netlify
-- (WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_ACCESS_TOKEN), e trocar de número
-- obrigava a ir ao painel da Meta copiar valores e fazer um novo deploy. Agora
-- o administrador carrega em «Ligar número do WhatsApp» em Integrações, escolhe
-- o número na janela da própria Meta (Embedded Signup), e o site guarda aqui o
-- resultado. As variáveis continuam a funcionar quando esta tabela está vazia.
--
-- Como `olx_connection`: o token dá acesso para enviar mensagens em nome da
-- empresa, por isso a tabela é só de servidor e nenhuma sessão a lê — nem um
-- administrador. O App Secret e o ID da app não vivem aqui: são da app da Meta,
-- não do número, e ficam nas variáveis de ambiente.
begin;

-- Uma linha só (id = 1): o site responde por um número de cada vez.
create table if not exists public.whatsapp_connection (
  id                   int primary key default 1 check (id = 1),
  -- Os dois IDs entram em caminhos do Graph API: só algarismos, sempre.
  waba_id              text not null check (waba_id ~ '^[0-9]+$'),
  phone_number_id      text not null check (phone_number_id ~ '^[0-9]+$'),
  access_token         text not null,
  -- A configuração de Embedded Signup da Meta dá tokens de 60 dias. Guarda-se
  -- a validade (lida da Meta ao ligar) para o painel avisar a tempo de se
  -- voltar a ligar o número. Nulo = a Meta não disse, ou não expira.
  token_expires_at     timestamptz,
  display_phone_number text,
  verified_name        text,
  -- PIN da verificação em dois passos, definido ao registar o número na Cloud
  -- API. É preciso para voltar a registar o número (por exemplo, noutra app);
  -- se se perder, a Meta deixa redefini-lo no WhatsApp Manager.
  registration_pin     text,
  -- O registo pode falhar sem impedir a ligação (o número já estava registado
  -- com outro PIN, por exemplo). Fica escrito para o painel o mostrar.
  register_warning     text,
  connected_by         uuid references public.profiles(id) on delete set null,
  connected_at         timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Canalização de servidor: RLS ativa e nenhuma política, como `olx_connection`.
alter table public.whatsapp_connection enable row level security;
revoke all on public.whatsapp_connection from anon, authenticated;

commit;
