-- ============================================================================
-- 0045 — O que o público lê, as quotas dos formulários e a fila do webhook
--
--  1. Viaturas: o papel `anon` (a chave pública do site) deixa de ler a tabela
--     inteira. Lê coluna a coluna tudo o que o site mostra; a matrícula, o
--     autor (`created_by`) e a categoria do OLX ficam só para a equipa.
--     A RLS continua a decidir QUE viaturas se veem; isto decide QUE colunas.
--  2. Definições do site: o preço/hora da oficina deixa de ser público.
--  3. Fotografias (bucket `car-media`): a API de Storage deixa de listar ao
--     público as pastas de viaturas que não estão no site (rascunhos, oficina).
--     Os links públicos (/object/public/…) continuam a funcionar como antes.
--  4. Quotas dos formulários: um pedido recusado deixa de contar.
--  5. Webhook dos contactos: só entra na fila com um webhook configurado, o que
--     ficou parado mais de 24 horas já não sai sozinho, e a limpeza apaga o que
--     tem mais de 30 dias.
--
-- Pode correr-se mais do que uma vez. O site funciona antes e depois dela: as
-- leituras públicas já pedem as colunas pela lista de src/lib/public-columns.ts.
--
-- ATENÇÃO a migrações futuras: uma coluna nova em `cars` ou `site_settings`
-- NÃO fica visível ao público. Se o site a mostrar, acrescentar
-- `grant select (coluna) on public.<tabela> to anon;` e a coluna à lista de
-- src/lib/public-columns.ts (o teste tests/security.test.mjs compara as duas).
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. Viaturas: colunas públicas
-- ---------------------------------------------------------------------------
-- O revoke da tabela tira também os grants por coluna de uma corrida anterior:
-- a lista abaixo fica a ser a única verdade.
revoke select on public.cars from anon;
grant select (
  id, slug, make, model, variant, year, mileage, fuel, transmission, body,
  power, displacement, color, doors, seats, price, price_on_request, status,
  featured, tagline, description, extras, location, highlights, published_at,
  sold_at, created_at, updated_at, previous_price, national, owners,
  first_owner, service_book, warranty_months, last_inspection, channels,
  registration_month, vehicle_type, point_of_sale_id, olx_attributes, badges
) on public.cars to anon;
-- `authenticated` (a equipa) e `service_role` mantêm a tabela inteira.

-- ---------------------------------------------------------------------------
-- 2. Definições do site: tudo menos o preço/hora da oficina
-- ---------------------------------------------------------------------------
revoke select on public.site_settings from anon;
grant select (
  id, company_name, logo_url, tagline, accent, accent_soft, updated_at,
  ga4_id, pixel_id, reservation_enabled, deposit_amount, phone, email,
  whatsapp, address_street, address_city, address_postal, address_country,
  hours, geo_lat, geo_lng, messenger
) on public.site_settings to anon;

-- ---------------------------------------------------------------------------
-- 3. Storage: o público só lista/lê pela API as pastas de viaturas no site
-- ---------------------------------------------------------------------------
-- As fotografias de uma viatura ficam em `<id da viatura>/<ficheiro>`. O
-- `split_part` é o mesmo que `(storage.foldername(name))[1]` para estes nomes.
-- O bucket continua público: os URLs /object/public/ não passam pela RLS (são
-- nomes aleatórios, que só se conhecem pela ficha publicada).
drop policy if exists "car-media: public read" on storage.objects;
drop policy if exists "car-media: public read on-site" on storage.objects;
create policy "car-media: public read on-site" on storage.objects for select to anon
using (
  bucket_id = 'car-media'
  and exists (
    select 1 from public.cars c
     where c.id::text = split_part(objects.name, '/', 1)
       and c.status in ('published', 'reserved', 'sold')
  )
);
-- A equipa (e quem tem sessão a ver o site) continua a ver o mesmo que antes
-- no que é da equipa: tudo o que está no bucket.
drop policy if exists "car-media: staff read" on storage.objects;
create policy "car-media: staff read" on storage.objects for select to authenticated
using (
  bucket_id = 'car-media'
  and (
    public.is_staff()
    or exists (
      select 1 from public.cars c
       where c.id::text = split_part(objects.name, '/', 1)
         and c.status in ('published', 'reserved', 'sold')
    )
  )
);

-- ---------------------------------------------------------------------------
-- 4. Quotas: um pedido recusado não conta
-- ---------------------------------------------------------------------------
-- Mesma assinatura e privilégios da 0013. O contador não passa de `max + 1`:
-- recusar não volta a gastar a quota. O servidor pede primeiro as quotas por IP
-- e por identidade e só depois a global (src/lib/public-submissions.ts), por
-- isso um cliente travado no seu limite já não gasta a quota de todos.
create or replace function public.consume_submission(key_value text, max_hits int, window_seconds int) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into submission_limits as l (key, window_start, hits) values (key_value, now(), 1)
  on conflict (key) do update set
    hits = case when l.window_start < now() - make_interval(secs => window_seconds) then 1
                else least(l.hits + 1, greatest(max_hits, 0) + 1) end,
    window_start = case when l.window_start < now() - make_interval(secs => window_seconds) then now()
                        else l.window_start end
  returning hits into n;
  return n <= max_hits;
end $$;
revoke all on function public.consume_submission(text, int, int) from public, anon, authenticated;
grant execute on function public.consume_submission(text, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Webhook dos contactos
-- ---------------------------------------------------------------------------
-- Só há envio com um webhook configurado (Integrações). Sem ele, cada contacto
-- deixava uma linha na fila para sempre — e ligar o webhook mais tarde enviava
-- os contactos antigos todos, de 3 em 3.
create or replace function public.queue_lead_notification() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.integration_secrets
              where id = 1 and nullif(btrim(data->>'lead_webhook'), '') is not null) then
    insert into public.notification_jobs (lead_id) values (new.id);
  end if;
  return new;
exception when others then
  -- Um problema na fila nunca impede o contacto de ficar gravado.
  raise warning 'queue_lead_notification: %', sqlerrm;
  return new;
end $$;
revoke all on function public.queue_lead_notification() from public, anon, authenticated;

-- O que está há mais de 24 horas por tentar (porque o webhook esteve desligado
-- ou mal configurado) já não é novidade: fica marcado e não sai sozinho. O
-- administrador pode sempre «Voltar a tentar» no painel, que repõe
-- `next_attempt_at` e o torna a pôr na fila. Mesma assinatura da 0013/0036.
create or replace function public.claim_notification_jobs() returns setof public.notification_jobs
language sql security definer set search_path = public as $$
  with parados as (
    update public.notification_jobs
       set attempts = greatest(attempts, 8),
           last_error = 'Não enviado: ficou mais de 24 horas na fila'
     where channel = 'webhook' and delivered_at is null and attempts < 8
       and next_attempt_at < now() - interval '24 hours'
    returning id
  )
  update public.notification_jobs set attempts = attempts + 1, next_attempt_at = now() + interval '2 minutes'
   where id in (select id from public.notification_jobs
                 where channel = 'webhook' and delivered_at is null and attempts < 8
                   and next_attempt_at <= now()
                   and next_attempt_at >= now() - interval '24 hours'
                 order by created_at limit 3 for update skip locked)
  returning *;
$$;
revoke all on function public.claim_notification_jobs() from public, anon, authenticated;
grant execute on function public.claim_notification_jobs() to service_role;

-- A limpeza (0036) passa a apagar também o webhook com mais de 30 dias.
create or replace function public.prune_notification_jobs() returns void
language sql security definer set search_path = public as $$
  delete from public.notification_jobs
   where channel in ('whatsapp', 'webhook') and created_at < now() - interval '30 days';
$$;
revoke all on function public.prune_notification_jobs() from public, anon, authenticated;
grant execute on function public.prune_notification_jobs() to service_role;

commit;
