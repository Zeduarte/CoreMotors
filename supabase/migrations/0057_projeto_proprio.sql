-- 0057 · Cada stand no seu projeto (Supabase + R2 + Netlify próprios)
--
-- O código é o mesmo para todos os stands; o que é de cada um fica na base de
-- dados dele ou nas variáveis do Netlify dele. Aqui:
--
-- 1. A identificação legal (nome da empresa, NIF) e a ficha de intermediário
--    de crédito passam do código para as Definições → Empresa. Antes estavam
--    fixas no código com os dados da Supermotas — um stand novo mostraria o
--    NIF de outro no rodapé e nas políticas.
-- 2. `setup_owner(email)`: numa base de dados nova, transforma a primeira
--    conta (criada no Supabase → Authentication) no acesso core: administrador,
--    dono da conta e nome de utilizador «Core». Só se corre no SQL Editor.
--
-- Idempotente: pode correr-se mais de uma vez. Aplicar no Supabase → SQL Editor.

-- ---------------------------------------------------------------------------
-- 1. Identificação legal nas Definições
-- ---------------------------------------------------------------------------
alter table public.site_settings add column if not exists legal_name text;
alter table public.site_settings add column if not exists nif text;
alter table public.site_settings add column if not exists credit_intermediary_url text;

-- O site público (anon) lê estas colunas, como as restantes da marca (0045).
grant select (legal_name, nif, credit_intermediary_url) on public.site_settings to anon;

-- A Supermotas (o primeiro stand) tinha estes dados no código: passam para a
-- base de dados dela, para nada mudar no site. Só nessa base de dados (pelo
-- nome da empresa) e só se ainda estiverem vazios — num stand novo não faz nada.
update public.site_settings
set legal_name = coalesce(legal_name, 'Carlos Moreira – Supermotas, Unipessoal Lda'),
    nif = coalesce(nif, '518429261'),
    credit_intermediary_url = coalesce(credit_intermediary_url, '/documentos/informacao-intermediario-credito.pdf')
where id = 1
  and company_name ilike 'supermotas%'
  and legal_name is null;

-- ---------------------------------------------------------------------------
-- 2. O acesso core numa base de dados nova
-- ---------------------------------------------------------------------------
-- Uso (SQL Editor), depois de criar a conta em Authentication → Users → Add user:
--   select public.setup_owner('email@do-dono.pt');
-- Recusa se o email não existir, ou se já houver outro dono.
create or replace function public.setup_owner(p_email text, p_username text default 'Core')
returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
  current_owner uuid;
begin
  select id into uid from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if uid is null then
    raise exception 'Não existe nenhuma conta com o email %. Crie-a primeiro em Authentication → Users → Add user.', p_email;
  end if;
  select id into current_owner from public.profiles where is_owner limit 1;
  if current_owner is not null and current_owner <> uid then
    raise exception 'Esta base de dados já tem um dono (acesso core). Só pode haver um.';
  end if;
  if exists (select 1 from public.profiles where lower(username) = lower(p_username) and id <> uid) then
    raise exception 'O nome de utilizador % já está a ser usado por outra conta.', p_username;
  end if;

  -- O perfil nasce com a conta (gatilho de 0001/0013); se ainda não existir, cria-o.
  insert into public.profiles (id, email, full_name, role)
  values (uid, lower(trim(p_email)), p_username, 'admin')
  on conflict (id) do nothing;

  update public.profiles
  set role = 'admin', is_owner = true, username = p_username, allowed_sections = null
  where id = uid;
  return format('Pronto: %s entra no backoffice com o nome de utilizador «%s».', p_email, p_username);
end;
$$;
revoke all on function public.setup_owner(text, text) from public, anon, authenticated;
