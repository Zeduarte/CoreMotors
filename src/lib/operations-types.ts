export type StaffMember = { id: string; full_name: string; role: string };
export type Activity = { id: string; lead_id: string; kind: string; body: string; created_by: string | null; created_at: string };
export type Financials = { car_id: string; sale_lead_id: string | null; acquired_on: string | null; purchase_price: number | null; sale_price: number | null; sold_on: string | null; hourly_rate_override: number | null; updated_at: string };
export type VehicleCost = { id: string; car_id: string; category: string; description: string; amount: number; incurred_on: string; created_by: string | null; created_at: string };
export type PreparationTask = { id: string; car_id: string; title: string; stage: string; status: string; assigned_to: string | null; parts: string | null; due_on: string | null; created_at: string; updated_at: string };
export type Reservation = { id: string; car_id: string; lead_id: string; expires_at: string; status: string; deposit_amount: number; deposit_received: boolean; created_by: string | null; created_at: string };
export type AuditEntry = { id: number; entity: string; record_id: string; action: string; actor_id: string | null; changed_fields: Record<string, {before: unknown; after: unknown}>; created_at: string };
export type NotificationJob = { id: string; lead_id: string | null; attempts: number; next_attempt_at: string; delivered_at: string | null; last_error: string | null; created_at: string;
  /** 0036: o canal; no WhatsApp, que aviso, sobre que registo, para quem. */
  channel: "webhook" | "whatsapp"; event: string | null; subject_id: string | null; recipient_id: string | null;
  payload: Record<string, unknown>; claimed_at: string | null; cancelled_at: string | null; wa_message_id: string | null };
export type AnalyticsSummary = { views: number; month_views: number; leads: number; new_leads: number; by_car: {id: string; views: number; leads: number}[] };
