-- Assistente interno por WhatsApp: a Página inicial e as Definições.
--
-- O canal passa a poder mudar, sempre por proposta + imagem + «sim», o que se
-- muda hoje nesses dois separadores do backoffice — textos, números, opções e
-- sim/não, nada mais:
--
--   Página inicial → textos do topo, marcas, confiança e chamada final
--                    (site_content 'home'); pontos de venda, serviços,
--                    perguntas frequentes e Google (site_content 'showroom').
--                    Precisa do separador Página inicial, como o
--                    `requireSection("pagina-inicial")` das acções.
--   Definições     → nome, slogan e cores da marca; WhatsApp e Messenger do
--                    site; valor/hora da oficina (site_settings); etiquetas
--                    dos cards (site_content 'badges'). Só administradores,
--                    como o `requireAdmin` de cada acção: o separador não basta.
--
-- O desenho é o da 0024/0038: a autorização é feita com o id explícito
-- (`wa_begin_as` → `has_section_for`, e o papel lido aqui), só depois se
-- assume a identidade. O TypeScript já validou tudo com os MESMOS esquemas zod
-- do backoffice; aqui repete-se a parte que importa para a segurança: uma
-- lista branca de chaves (nem uma a mais, nem uma a menos) e os limites de
-- cada valor. Uma chave de integração, um token ou o logótipo nunca passam.
--
-- Fica de fora de propósito: imagens, integrações e segredos
-- (integration_secrets, OLX, ligação do WhatsApp, Analytics, Pixel, reservas
-- online), utilizadores e permissões. E nada se retira: os pontos de venda e
-- as perguntas mantêm-se os mesmos, e nenhuma função desta migração apaga.
--
-- A 0039 (fotos) e a 0041 (avisos) são de outros trabalhos; esta não lhes toca.
begin;

-- ---------------------------------------------------------------------------
-- As novas propostas cabem na tabela de propostas
-- ---------------------------------------------------------------------------

-- Acrescenta, sem reescrever a lista: lê os tipos que a restrição já aceita
-- (os da 0038 e os de qualquer migração entretanto) e junta os novos. Assim a
-- ordem em que as migrações dos vários trabalhos chegam não faz perder nenhum.
do $$
declare
  atuais text[];
  novos text[] := array['update_homepage', 'update_showroom', 'update_site_settings', 'update_badges'];
begin
  select coalesce(array_agg(distinct m[1]), '{}') into atuais
    from pg_constraint c
    cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m
   where c.conrelid = 'public.wa_pending_actions'::regclass
     and c.conname = 'wa_pending_actions_kind_check';
  alter table public.wa_pending_actions drop constraint if exists wa_pending_actions_kind_check;
  execute format(
    'alter table public.wa_pending_actions add constraint wa_pending_actions_kind_check check (kind = any (%L::text[]))',
    (select array_agg(distinct k order by k) from unnest(atuais || novos) k));
end $$;

-- ---------------------------------------------------------------------------
-- A lista branca: um valor tem exactamente a forma prevista
-- ---------------------------------------------------------------------------

-- `shape` descreve o valor:
--   {"t":"text","max":N,"min":N,"re":"…"}  texto (min conta sem espaços nas pontas)
--   {"t":"enum","of":[…]}                   um dos textos da lista
--   {"t":"bool"}                            verdadeiro/falso
--   {"t":"num","min":N,"max":N,"null":true} número (nulo só se permitido)
--   {"t":"list","max":N,"item":{…}}         lista de valores com a forma item
--   {"t":"obj","keys":{…}}                  objecto com EXACTAMENTE estas chaves
create or replace function public.wa_json_fits(v jsonb, shape jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare t text := shape->>'t'; k text; item jsonb;
begin
  if v is null or shape is null then return false; end if;
  if t = 'text' then
    return jsonb_typeof(v) = 'string'
       and length(v #>> '{}') <= (shape->>'max')::int
       and length(trim(v #>> '{}')) >= coalesce((shape->>'min')::int, 0)
       and (shape->>'re' is null or (v #>> '{}') ~ (shape->>'re'));
  elsif t = 'enum' then
    return jsonb_typeof(v) = 'string' and (shape->'of') ? (v #>> '{}');
  elsif t = 'bool' then
    return jsonb_typeof(v) = 'boolean';
  elsif t = 'num' then
    if jsonb_typeof(v) = 'null' then return coalesce((shape->>'null')::boolean, false); end if;
    return jsonb_typeof(v) = 'number'
       and (v #>> '{}')::numeric between (shape->>'min')::numeric and (shape->>'max')::numeric;
  elsif t = 'list' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > (shape->>'max')::int then return false; end if;
    for item in select value from jsonb_array_elements(v) loop
      if not public.wa_json_fits(item, shape->'item') then return false; end if;
    end loop;
    return true;
  elsif t = 'obj' then
    if jsonb_typeof(v) <> 'object' then return false; end if;
    -- A lista branca propriamente dita: uma chave a mais (um token, um
    -- logótipo) recusa o conteúdo inteiro.
    if (select coalesce(array_agg(x order by x), '{}') from jsonb_object_keys(v) x)
       is distinct from
       (select coalesce(array_agg(x order by x), '{}') from jsonb_object_keys(shape->'keys') x) then
      return false;
    end if;
    for k in select jsonb_object_keys(shape->'keys') loop
      if not public.wa_json_fits(v->k, shape->'keys'->k) then return false; end if;
    end loop;
    return true;
  end if;
  return false;
end $$;

-- As Definições são só de administradores, como o `requireAdmin` das acções.
create or replace function public.wa_require_admin(actor uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = actor and role::text = 'admin') then
    raise exception 'Apenas administradores';
  end if;
end $$;

-- Os ids de uma lista de objectos, pela ordem (nulo/ausente → lista vazia).
create or replace function public.wa_ids(list jsonb)
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(e.value->>'id' order by e.n), '{}')
    from jsonb_array_elements(case when jsonb_typeof(list) = 'array' then list else '[]'::jsonb end)
         with ordinality as e(value, n);
$$;

-- ---------------------------------------------------------------------------
-- Página inicial: textos (homeContentSchema)
-- ---------------------------------------------------------------------------

create or replace function public.wa_update_home(actor uuid, new_content jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  botao jsonb := '{"t":"obj","keys":{"label":{"t":"text","max":60},"href":{"t":"text","max":200}}}';
  forma jsonb;
begin
  perform public.wa_begin_as(actor, array['pagina-inicial']);
  forma := jsonb_build_object('t', 'obj', 'keys', jsonb_build_object(
    'hero', jsonb_build_object('t', 'obj', 'keys', jsonb_build_object(
      'eyebrow', '{"t":"text","max":80}'::jsonb,
      'title', '{"t":"text","min":1,"max":160}'::jsonb,
      'subtitle', '{"t":"text","max":300}'::jsonb,
      'primaryCta', botao,
      'secondaryCta', botao,
      'media', '{"t":"enum","of":["auto","video","image"]}'::jsonb)),
    'motoHero', jsonb_build_object('t', 'obj', 'keys', jsonb_build_object(
      'eyebrow', '{"t":"text","max":80}'::jsonb,
      'title', '{"t":"text","min":1,"max":160}'::jsonb,
      'subtitle', '{"t":"text","max":300}'::jsonb,
      'primaryCta', botao)),
    'brands', '{"t":"list","max":30,"item":{"t":"text","min":1,"max":200}}'::jsonb,
    'trust', jsonb_build_object('t', 'obj', 'keys', jsonb_build_object(
      'eyebrow', '{"t":"text","max":80}'::jsonb,
      'title', '{"t":"text","max":160}'::jsonb,
      'pillars', '{"t":"list","max":8,"item":{"t":"obj","keys":{"kpi":{"t":"text","max":20},"title":{"t":"text","max":80},"body":{"t":"text","max":400}}}}'::jsonb)),
    'cta', jsonb_build_object('t', 'obj', 'keys', jsonb_build_object(
      'eyebrow', '{"t":"text","max":80}'::jsonb,
      'title', '{"t":"text","max":160}'::jsonb,
      'whatsappLabel', '{"t":"text","max":60}'::jsonb,
      'secondary', botao))));
  if not public.wa_json_fits(new_content, forma) then raise exception 'Conteúdo inválido'; end if;
  insert into public.site_content(key, content) values ('home', new_content)
  on conflict (key) do update set content = excluded.content;
end $$;

-- ---------------------------------------------------------------------------
-- Página inicial: serviços, perguntas, Google e pontos de venda (showroomSchema)
-- ---------------------------------------------------------------------------

create or replace function public.wa_update_showroom(actor uuid, new_content jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  atual jsonb;
  forma jsonb := '{"t":"obj","keys":{
    "locations":{"t":"list","max":20,"item":{"t":"obj","keys":{
      "id":{"t":"text","min":1,"max":80,"re":"^[a-z0-9-]+$"},
      "name":{"t":"text","min":1,"max":100},
      "address":{"t":"text","min":1,"max":250},
      "city":{"t":"text","min":1,"max":100},
      "postalCode":{"t":"text","max":20},
      "phone":{"t":"text","max":30,"re":"^[-+0-9[:space:]()]*$"},
      "email":{"t":"text","max":320},
      "hours":{"t":"text","max":500},
      "latitude":{"t":"num","min":-90,"max":90,"null":true},
      "longitude":{"t":"num","min":-180,"max":180,"null":true}}}},
    "faqs":{"t":"list","max":60,"item":{"t":"obj","keys":{
      "question":{"t":"text","min":1,"max":200},
      "answer":{"t":"text","min":1,"max":2000},
      "category":{"t":"enum","of":["geral","financiamento","garantia","oficina","encomendas"]}}}},
    "services":{"t":"list","max":4,"item":{"t":"obj","keys":{
      "id":{"t":"enum","of":["financiamento","garantia","oficina","encomendas"]},
      "title":{"t":"text","min":1,"max":100},
      "summary":{"t":"text","min":1,"max":300},
      "body":{"t":"text","min":1,"max":10000},
      "enabled":{"t":"bool"}}}},
    "google":{"t":"obj","keys":{
      "enabled":{"t":"bool"},
      "placeId":{"t":"text","max":200,"re":"^[a-zA-Z0-9_-]*$"},
      "mapsUrl":{"t":"text","max":2000,"re":"^(https://[^[:space:]]+)?$"}}}}}';
begin
  perform public.wa_begin_as(actor, array['pagina-inicial']);
  if not public.wa_json_fits(new_content, forma) then raise exception 'Conteúdo inválido'; end if;
  if jsonb_array_length(new_content->'services') <> 4
     or (select count(distinct s) from unnest(public.wa_ids(new_content->'services')) s) <> 4 then
    raise exception 'Conteúdo inválido';
  end if;

  select content into atual from public.site_content where key = 'showroom' for update;
  -- Por aqui só se altera o que existe: os mesmos pontos de venda, pela mesma
  -- ordem (o primeiro é o principal e o id liga as viaturas), e as mesmas
  -- perguntas. Acrescentar ou retirar é no backoffice.
  if public.wa_ids(new_content->'locations') is distinct from public.wa_ids(atual->'locations') then
    raise exception 'Pontos de venda diferentes';
  end if;
  if jsonb_typeof(atual->'faqs') = 'array'
     and jsonb_array_length(atual->'faqs') <> jsonb_array_length(new_content->'faqs') then
    raise exception 'Conteúdo mudou';
  end if;

  insert into public.site_content(key, content) values ('showroom', new_content)
  on conflict (key) do update set content = excluded.content;
end $$;

-- ---------------------------------------------------------------------------
-- Definições: etiquetas dos cards (badgesSchema). Só administradores.
-- ---------------------------------------------------------------------------

create or replace function public.wa_update_badges(actor uuid, new_content jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  atual jsonb;
  novos text[];
  antigos text[];
  forma jsonb := '{"t":"obj","keys":{"items":{"t":"list","max":40,"item":{"t":"obj","keys":{
    "id":{"t":"text","min":1,"max":40,"re":"^[a-z0-9_-]+$"},
    "label":{"t":"text","min":1,"max":30},
    "color":{"t":"text","max":7,"re":"^#[0-9a-fA-F]{6}$"},
    "enabled":{"t":"bool"}}}}}}';
begin
  perform public.wa_begin_as(actor, array['definicoes']);
  perform public.wa_require_admin(actor);
  if not public.wa_json_fits(new_content, forma) then raise exception 'Conteúdo inválido'; end if;
  novos := public.wa_ids(new_content->'items');
  if (select count(distinct x) from unnest(novos) x) <> cardinality(novos) then
    raise exception 'Conteúdo inválido';
  end if;

  select content into atual from public.site_content where key = 'badges' for update;
  antigos := public.wa_ids(atual->'items');
  -- As mesmas etiquetas: as do stand que existem continuam (nenhuma sai), e só
  -- entram as automáticas, que o `mergeBadges` repõe sempre.
  if not (antigos <@ novos)
     or not (novos <@ (antigos || array['reserved', 'sold', 'price_drop', 'national', 'new', 'low_km'])) then
    raise exception 'Conteúdo mudou';
  end if;

  insert into public.site_content(key, content) values ('badges', new_content)
  on conflict (key) do update set content = excluded.content;
end $$;

-- ---------------------------------------------------------------------------
-- Definições: marca, canais de conversa e valor/hora (site_settings). Só
-- administradores. Só as colunas da lista; GA4, Pixel, reservas, logótipo e
-- os contactos antigos (que agora vêm do ponto de venda) ficam de fora.
-- ---------------------------------------------------------------------------

create or replace function public.wa_update_site_settings(actor uuid, changes jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare k text; v jsonb; s public.site_settings%rowtype;
begin
  perform public.wa_begin_as(actor, array['definicoes']);
  perform public.wa_require_admin(actor);
  if changes is null or jsonb_typeof(changes) <> 'object' or changes = '{}'::jsonb then
    raise exception 'Nada para alterar';
  end if;
  for k in select jsonb_object_keys(changes) loop
    if k not in ('company_name', 'tagline', 'accent', 'accent_soft', 'whatsapp', 'messenger',
                 'workshop_hourly_rate') then
      raise exception 'Campo não permitido';
    end if;
  end loop;

  select * into s from public.site_settings where id = 1 for update;
  if not found then raise exception 'Definições inexistentes'; end if;

  -- As regras do siteSettingsSchema / companySchema / workshopSchema. Texto
  -- vazio grava-se como nulo, como nas acções (`|| null`).
  if changes ? 'company_name' then
    v := changes->'company_name';
    if not public.wa_json_fits(v, '{"t":"text","min":1,"max":60}') then raise exception 'Nome inválido'; end if;
    s.company_name := trim(v #>> '{}');
  end if;
  if changes ? 'tagline' then
    v := changes->'tagline';
    if not public.wa_json_fits(v, '{"t":"text","max":160}') then raise exception 'Slogan inválido'; end if;
    s.tagline := nullif(trim(v #>> '{}'), '');
  end if;
  if changes ? 'accent' then
    v := changes->'accent';
    if not public.wa_json_fits(v, '{"t":"text","max":7,"re":"^#[0-9a-fA-F]{6}$"}') then raise exception 'Cor inválida'; end if;
    s.accent := v #>> '{}';
  end if;
  if changes ? 'accent_soft' then
    v := changes->'accent_soft';
    if not public.wa_json_fits(v, '{"t":"text","max":7,"re":"^#[0-9a-fA-F]{6}$"}') then raise exception 'Cor inválida'; end if;
    s.accent_soft := v #>> '{}';
  end if;
  if changes ? 'whatsapp' then
    v := changes->'whatsapp';
    -- Só dígitos e com indicativo (o TypeScript já completou o 351).
    if not public.wa_json_fits(v, '{"t":"text","max":23,"re":"^([0-9]{11,23})?$"}') then
      raise exception 'WhatsApp inválido';
    end if;
    s.whatsapp := nullif(v #>> '{}', '');
  end if;
  if changes ? 'messenger' then
    v := changes->'messenger';
    if not public.wa_json_fits(v, '{"t":"text","max":200}') then raise exception 'Messenger inválido'; end if;
    s.messenger := nullif(trim(v #>> '{}'), '');
  end if;
  if changes ? 'workshop_hourly_rate' then
    v := changes->'workshop_hourly_rate';
    if not public.wa_json_fits(v, '{"t":"num","min":0,"max":1000}') then raise exception 'Valor inválido'; end if;
    s.workshop_hourly_rate := round((v #>> '{}')::numeric, 2);
  end if;

  update public.site_settings
     set company_name = s.company_name, tagline = s.tagline, accent = s.accent,
         accent_soft = s.accent_soft, whatsapp = s.whatsapp, messenger = s.messenger,
         workshop_hourly_rate = s.workshop_hourly_rate
   where id = 1;
end $$;

-- Só o servidor, como na 0024 e na 0038: revoke e grant juntos.
do $$ declare sig text; begin
  foreach sig in array array[
    'wa_json_fits(jsonb,jsonb)',
    'wa_require_admin(uuid)',
    'wa_ids(jsonb)',
    'wa_update_home(uuid,jsonb)',
    'wa_update_showroom(uuid,jsonb)',
    'wa_update_badges(uuid,jsonb)',
    'wa_update_site_settings(uuid,jsonb)'
  ] loop
    execute 'revoke all on function public.' || sig || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || sig || ' to service_role';
  end loop;
end $$;

commit;
