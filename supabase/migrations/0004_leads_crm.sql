-- ============================================================================
-- CoreMotors — CRM de leads (Fase 1)
-- Novos tipos de lead (retoma, encomenda), estados de pipeline, notas e
-- detalhes do carro do cliente. Correr no SQL Editor DEPOIS de 0001–0003.
--
-- Nota: `ALTER TYPE ... ADD VALUE` não pode ser usado na MESMA transação em que
-- o valor é utilizado. Este script apenas adiciona valores e colunas — seguro.
-- ============================================================================

-- Novos tipos de lead
alter type public.lead_kind add value if not exists 'trade_in';
alter type public.lead_kind add value if not exists 'order';

-- Novos estados do pipeline (mantém 'new','contacted','closed' já existentes)
alter type public.lead_status add value if not exists 'proposal';
alter type public.lead_status add value if not exists 'won';
alter type public.lead_status add value if not exists 'lost';

-- Notas internas + detalhes estruturados (ex.: carro de retoma / encomenda)
alter table public.leads add column if not exists notes text;
alter table public.leads
  add column if not exists car_details jsonb not null default '{}'::jsonb;
