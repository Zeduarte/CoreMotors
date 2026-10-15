-- Que migrações já estão aplicadas nesta base de dados?
--
-- Cole isto no SQL Editor do Supabase e carregue em Run. Cada linha diz se a
-- migração está aplicada, pela presença de algo que ela cria. Aplique as que
-- disserem «FALTA», uma de cada vez e por ordem de número.

select migracao, case when aplicada then 'aplicada' else 'FALTA' end as estado
from (values
  ('0019_vehicle_worlds',
    exists (select 1 from pg_proc where proname = 'create_workshop_intake_for_type')),
  ('0020_profile_vehicle_types',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'profiles' and column_name = 'allowed_vehicle_types')),
  ('0021_profile_and_leave',
    to_regclass('public.leave_balances') is not null),
  ('0022_leave_hierarchy',
    exists (select 1 from pg_proc where proname = 'can_decide_leave_for')),
  ('0023_profile_write_grants',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'profiles' and column_name = 'job_title')
    and has_column_privilege('authenticated', 'public.profiles', 'job_title', 'UPDATE')),
  ('0024_whatsapp_orders',
    to_regclass('public.wa_messages') is not null),
  ('0025_olx',
    to_regclass('public.olx_connection') is not null),
  ('0026_profile_owner',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_owner')),
  ('0027_workshop_statuses',
    exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
            where t.typname = 'car_status' and e.enumlabel = 'workshop')),
  ('0028_workshop_flow',
    exists (select 1 from pg_proc where proname = 'mark_vehicle_prepared')),
  ('0029_time_entries',
    to_regclass('public.time_entries') is not null),
  ('0030_olx_stats',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'channel_listings' and column_name = 'views')),
  ('0031_olx_category_per_car',
    to_regclass('public.olx_category_details') is not null),
  ('0032_olx_fields',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'cars' and column_name = 'olx_attributes')),
  ('0033_body_types',
    exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
            where t.typname = 'body_type' and e.enumlabel = 'Moto 4')),
  ('0034_vehicle_badges',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'cars' and column_name = 'badges')),
  ('0035_whatsapp_connection',
    to_regclass('public.whatsapp_connection') is not null),
  ('0037_wa_conversation',
    to_regclass('public.wa_conversation') is not null)
) as m(migracao, aplicada)
order by migracao;
