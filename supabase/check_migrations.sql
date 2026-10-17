-- Que migrações já estão aplicadas nesta base de dados? (0001 → 0042)
--
-- Cole isto no SQL Editor do Supabase e carregue em Run. Cada linha diz se a
-- migração está aplicada, pela presença de algo que ela cria. Aplique as que
-- disserem «FALTA», uma de cada vez e por ordem de número
-- (supabase/migrations/<número>_*.sql).
--
-- Ao acrescentar uma migração nova, acrescente aqui a linha dela.

select migracao, case when aplicada then 'aplicada' else 'FALTA' end as estado
from (values
  ('0001_init',
    to_regclass('public.cars') is not null and to_regclass('public.leads') is not null),
  ('0002_site_content',
    to_regclass('public.site_content') is not null),
  ('0003_roles_branding',
    to_regclass('public.site_settings') is not null),
  ('0004_leads_crm',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'leads' and column_name = 'car_details')),
  ('0005_trust',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'cars' and column_name = 'warranty_months')),
  ('0006_growth',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'site_settings' and column_name = 'reservation_enabled')),
  ('0007_company',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'site_settings' and column_name = 'phone')),
  ('0008_public_submissions',
    exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
            where t.typname = 'lead_kind' and e.enumlabel = 'offer')),
  ('0009_roles_permissions',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'profiles' and column_name = 'allowed_sections')),
  ('0010_messenger',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'site_settings' and column_name = 'messenger')),
  ('0011_lead_alert',
    exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
            where t.typname = 'lead_kind' and e.enumlabel = 'alert')),
  ('0012_mechanic',
    to_regclass('public.vehicle_tasks') is not null),
  ('0013_operations',
    to_regclass('public.reservations') is not null and to_regclass('public.audit_log') is not null),
  ('0014_channel_listings',
    to_regclass('public.channel_listings') is not null),
  ('0015_fix_work_hours',
    exists (select 1 from pg_proc where proname = 'calculate_work_hours'
            and prosrc like '%start_time is null%')),
  ('0016_workshop_rate',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'site_settings' and column_name = 'workshop_hourly_rate')),
  ('0017_workshop_costs_and_rate',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'vehicle_financials' and column_name = 'hourly_rate_override')),
  ('0018_showroom',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'cars' and column_name = 'registration_month')),
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
  ('0036_whatsapp_notifications',
    to_regclass('public.notification_preferences') is not null),
  ('0037_wa_conversation',
    to_regclass('public.wa_conversation') is not null),
  ('0038_wa_more_actions',
    exists (select 1 from pg_proc where proname = 'wa_update_car')),
  ('0039_wa_media',
    to_regclass('public.wa_media') is not null),
  ('0040_wa_site_settings',
    exists (select 1 from pg_proc where proname = 'wa_update_site_settings')),
  ('0041_more_notifications',
    exists (select 1 from pg_proc where proname = 'queue_whatsapp_leave_upcoming')),
  ('0042_alerts_visits',
    to_regclass('public.customer_settings') is not null
    and to_regclass('public.stock_alert_matches') is not null)
) as m(migracao, aplicada)
order by migracao;
