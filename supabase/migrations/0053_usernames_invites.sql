-- Nomes de utilizador e convites para entrar no backoffice.
--
-- Entra-se com nome de utilizador + palavra-passe. O Supabase Auth continua a
-- exigir um email, por isso:
--  - quem já existe mantém o email que tem no Auth (o dono incluído, que passa
--    a chamar-se «Core» e não muda de palavra-passe);
--  - quem é criado a partir de agora fica com um email interno derivado do nome
--    (`<nome>@utilizadores.coremotors.local`), que nunca recebe correio.
-- O login traduz o nome no email com `login_email`, que só o servidor chama.
--
-- O administrador cria a conta só com o nome e recebe um link de convite: um
-- token aleatório de que aqui só se guarda o hash, com validade e de uso único.
-- Quem o abre define a palavra-passe. O mesmo link serve para dar uma
-- palavra-passe nova a quem a esqueceu.
--
-- E a gestão de utilizadores passa a ser só dos administradores: o separador
-- «utilizadores» deixa de se poder conceder a chefes ou vendedores.
begin;

-- ---------------------------------------------------------------------------
-- profiles.username
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists username text;

alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format check (
  username is null or (
    length(username) between 3 and 32
    and username ~ '^[A-Za-z0-9]+([._-][A-Za-z0-9]+)*$'
  )
);

-- Único sem olhar a maiúsculas: «Core» e «core» são o mesmo utilizador.
create unique index if not exists profiles_username_unique
  on public.profiles (lower(username));

-- O dono fica «Core» (se ninguém tiver já esse nome).
update public.profiles set username = 'Core'
where is_owner and username is null
  and not exists (select 1 from public.profiles where lower(username) = 'core');

-- Os restantes: a parte do email antes do @, só com letras, números e pontos.
-- Nomes repetidos ganham -2, -3, … O administrador vê-os em Utilizadores.
do $$
declare
  r record;
  base text;
  candidate text;
  n int;
begin
  for r in select id, email from public.profiles where username is null order by created_at, id loop
    base := lower(coalesce(split_part(r.email, '@', 1), ''));
    base := regexp_replace(base, '[^a-z0-9]+', '.', 'g');
    base := regexp_replace(left(regexp_replace(base, '^\.+', ''), 28), '\.+$', '');
    if length(base) < 3 then base := 'utilizador'; end if;
    candidate := base;
    n := 1;
    while exists (select 1 from public.profiles where lower(username) = candidate) loop
      n := n + 1;
      candidate := base || '-' || n;
    end loop;
    update public.profiles set username = candidate where id = r.id;
  end loop;
end $$;

-- O próprio não muda o nome: o `authenticated` só tem update em full_name,
-- phone, birth_date e job_title (0013/0023), e assim continua.

-- Email de Auth de um nome de utilizador, para o login. Só o servidor: dar isto
-- ao anon era entregar a lista de emails a quem adivinhasse nomes.
create or replace function public.login_email(p_username text)
returns text language sql stable security definer set search_path = public as $$
  select u.email
  from public.profiles p
  join auth.users u on u.id = p.id
  where lower(p.username) = lower(trim(p_username))
  limit 1;
$$;
revoke all on function public.login_email(text) from public, anon, authenticated;
grant execute on function public.login_email(text) to service_role;

-- ---------------------------------------------------------------------------
-- Convites
-- ---------------------------------------------------------------------------
create table if not exists public.user_invites (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  -- sha256 (hex) do token do link. O token em si nunca chega à base de dados.
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  check (expires_at > created_at)
);
create index if not exists user_invites_user_idx on public.user_invites (user_id, created_at desc);

-- Sem políticas: só o servidor (service_role, que ignora a RLS) lê e escreve.
alter table public.user_invites enable row level security;
revoke all on public.user_invites from public, anon, authenticated;

-- Novo convite: os que estavam por usar deixam de valer, para haver no máximo
-- um link vivo por pessoa.
create or replace function public.create_user_invite(
  p_user uuid, p_token_hash text, p_created_by uuid, p_expires_at timestamptz
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  update public.user_invites set used_at = now()
  where user_id = p_user and used_at is null;
  insert into public.user_invites (user_id, token_hash, created_by, expires_at)
  values (p_user, p_token_hash, p_created_by, p_expires_at)
  returning id into new_id;
  return new_id;
end;
$$;

-- Usa o convite: devolve o utilizador, ou null se não existe, já foi usado ou
-- expirou. É um só UPDATE, por isso dois pedidos ao mesmo tempo não o usam os dois.
create or replace function public.claim_user_invite(p_token_hash text)
returns uuid language sql security definer set search_path = public as $$
  update public.user_invites set used_at = now()
  where token_hash = p_token_hash and used_at is null and expires_at > now()
  returning user_id;
$$;

-- Devolve o convite se não se conseguiu gravar a palavra-passe (ex.: fraca),
-- para a pessoa poder tentar outra vez com o mesmo link. Só o último convite
-- da pessoa: um link substituído entretanto não volta a valer.
create or replace function public.release_user_invite(p_token_hash text)
returns void language sql security definer set search_path = public as $$
  update public.user_invites i set used_at = null
  where i.token_hash = p_token_hash and i.expires_at > now()
    and i.created_at = (select max(created_at) from public.user_invites o where o.user_id = i.user_id);
$$;

revoke all on function public.create_user_invite(uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_user_invite(text) from public, anon, authenticated;
revoke all on function public.release_user_invite(text) from public, anon, authenticated;
grant execute on function public.create_user_invite(uuid, text, uuid, timestamptz) to service_role;
grant execute on function public.claim_user_invite(text) to service_role;
grant execute on function public.release_user_invite(text) to service_role;

-- ---------------------------------------------------------------------------
-- «utilizadores» só para administradores
-- ---------------------------------------------------------------------------
-- Igual à 0052, mais a linha do separador «utilizadores»: mesmo que esteja em
-- allowed_sections de alguém, só um admin lhe acede. Assim a política
-- «profiles: managers read» (0013) também passa a ser só dos admins.
create or replace function public.has_section_for(uid uuid, section text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select case
    when role::text = 'admin' then true
    when section = 'utilizadores' then false
    when role::text = 'mecanico' then section = 'oficina'
    when section = 'dashboard' then true
    when cardinality(allowed_sections) > 0 then section = any(allowed_sections)
    when role::text = 'chefe' then section = any(array['carros','pagina-inicial','leads','testemunhos','financeiro','partilhas'])
    when role::text = 'vendedor' then section = any(array['carros','leads','partilhas'])
    else false end from public.profiles where id = uid), false);
$$;
revoke all on function public.has_section_for(uuid, text) from public, anon;
grant execute on function public.has_section_for(uuid, text) to authenticated, service_role;

-- Tira-se o separador a quem o tinha concedido: deixou de ter efeito. Uma lista
-- que ficasse vazia passava aos acessos por omissão do papel (mais largos),
-- por isso fica pelo menos o Dashboard.
update public.profiles
set allowed_sections = coalesce(
  nullif(array_remove(allowed_sections, 'utilizadores'), '{}'::text[]),
  array['dashboard'])
where role::text <> 'admin' and 'utilizadores' = any(allowed_sections);

commit;
