import { ActionForm } from "@/components/admin/ActionForm";
import { saveMyNotificationPreferences } from "@/lib/actions/notifications";
import { eventsForSections } from "@/lib/notification-events";
import { effectiveSections, effectiveVehicleTypes, SECTIONS } from "@/lib/permissions";
import { normalizeWhatsApp } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/supabase/database.types";

/**
 * «Avisos por WhatsApp» em O meu perfil: cada pessoa liga e desliga cada tipo
 * de aviso. Só aparecem os avisos dos separadores a que a pessoa tem acesso —
 * os outros nunca lhe chegariam. Por defeito, tudo ligado.
 */
export async function NotificationPreferences({ me }: { me: ProfileRow }) {
  const events = eventsForSections(effectiveSections(me.role, me.allowed_sections));
  if (events.length === 0) return null;

  const db = await createClient();
  const [{ data: prefs, error }, { data: settings }] = await Promise.all([
    db.from("notification_preferences").select("event,enabled").eq("profile_id", me.id),
    db.from("notification_settings").select("whatsapp_enabled").eq("id", 1).maybeSingle(),
  ]);

  if (error) {
    return (
      <section className="card space-y-2 p-5">
        <h2 className="text-lg font-semibold text-paper">Avisos por WhatsApp</h2>
        <p className="text-sm text-paper/50">
          Ainda não disponíveis: falta aplicar a migração 0036_whatsapp_notifications.sql.
        </p>
      </section>
    );
  }

  const off = new Set((prefs ?? []).filter((p) => !p.enabled).map((p) => p.event));
  const hasPhone = /^\d{9,15}$/.test(me.phone ? normalizeWhatsApp(me.phone) : "");
  const types = effectiveVehicleTypes(me.role, me.allowed_vehicle_types);
  const tipos = types.length > 1 ? "carros e motas" : types[0] === "motorcycle" ? "motas" : "carros";
  const groups = SECTIONS.map((s) => ({ ...s, events: events.filter((e) => e.section === s.key) })).filter(
    (s) => s.events.length > 0,
  );

  return (
    <ActionForm action={saveMyNotificationPreferences} label="Guardar avisos">
      <h2 className="text-lg font-semibold text-paper">Avisos por WhatsApp</h2>
      <p className="text-sm text-paper/50">
        Quando entra algo novo na sua área do backoffice, recebe uma mensagem no
        WhatsApp, no telefone acima. Desmarque o que não quer receber.
      </p>
      {!settings?.whatsapp_enabled && (
        <p className="text-sm text-amber-300">
          O administrador ainda não ligou os avisos por WhatsApp. As suas escolhas
          ficam guardadas para quando ligar.
        </p>
      )}
      {!hasPhone && (
        <p className="text-sm text-amber-300">
          Sem telefone no perfil não recebe avisos. Preencha-o acima e guarde.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {groups.map((g) => (
          <div key={g.key} className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-paper/50">{g.label}</p>
            {g.events.map((e) => (
              <label key={e.key} className="flex items-start gap-2 text-sm text-paper/80">
                <input
                  type="checkbox"
                  name={e.key}
                  defaultChecked={!off.has(e.key)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                />
                <span>{e.label}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
      <p className="text-xs text-paper/40">
        Só recebe avisos de {tipos} — os tipos de viatura a que tem acesso — e
        nunca do que foi você a fazer.
      </p>
    </ActionForm>
  );
}
