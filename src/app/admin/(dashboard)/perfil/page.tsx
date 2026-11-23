import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/admin-queries";
import { ActionForm, Field } from "@/components/admin/ActionForm";
import { changeMyPassword, saveMyProfile } from "@/lib/actions/profile";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/usernames";
import { NotificationPreferences } from "@/components/admin/NotificationPreferences";

export const dynamic = "force-dynamic";

export default async function ProfileDataPage() {
  const me = await getCurrentProfile();
  if (!me) redirect("/admin/login");

  return (
    <div className="space-y-6">
      <ActionForm action={saveMyProfile}>
        <h2 className="text-lg font-semibold text-paper">Os seus dados</h2>
        <p className="text-sm text-paper/50">
          Só você altera estes campos. O papel e os acessos são definidos por
          quem gere os utilizadores.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome">
            <input
              className="field"
              name="full_name"
              defaultValue={me.full_name ?? ""}
              maxLength={80}
              required
            />
          </Field>
          <Field label="Função">
            <input
              className="field"
              name="job_title"
              defaultValue={me.job_title ?? ""}
              maxLength={80}
              placeholder="Ex.: Vendedor"
            />
          </Field>
          <Field label="Telefone">
            <input
              className="field"
              name="phone"
              defaultValue={me.phone ?? ""}
              maxLength={30}
              inputMode="tel"
              placeholder="Ex.: 912 345 678"
            />
            {/* O campo existia sem se perceber para que servia: é este número
                que identifica a pessoa quando ela dá ordens por WhatsApp. */}
            <span className="mt-1 block text-xs text-paper/50">
              É por este número que as suas ordens por WhatsApp são reconhecidas,
              e é para ele que vão os avisos. Escreva só o número, sem notas.
            </span>
          </Field>
          <Field label="Data de nascimento">
            <input
              className="field"
              type="date"
              name="birth_date"
              defaultValue={me.birth_date ?? ""}
            />
          </Field>
        </div>
        <p className="text-xs text-paper/40">
          A data de nascimento serve para o dia de aniversário das férias.
        </p>
      </ActionForm>

      <NotificationPreferences me={me} />

      <ActionForm action={changeMyPassword} label="Mudar palavra-passe" success="Palavra-passe alterada.">
        <h2 className="text-lg font-semibold text-paper">Palavra-passe</h2>
        <p className="text-sm text-paper/50">
          Entra com o nome de utilizador{me.username ? <> <strong className="font-mono text-paper/80">{me.username}</strong></> : null}.
          A nova palavra-passe vale já a partir do próximo login; esta sessão continua aberta.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Palavra-passe atual">
            <input className="field" type="password" name="current_password" autoComplete="current-password" required />
          </Field>
          <Field label="Nova palavra-passe">
            <input className="field" type="password" name="new_password" autoComplete="new-password" minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} required />
          </Field>
          <Field label="Repetir a nova">
            <input className="field" type="password" name="confirm_password" autoComplete="new-password" minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} required />
          </Field>
        </div>
        <p className="text-xs text-paper/40">
          Pelo menos {PASSWORD_MIN} caracteres. Se não se lembra da atual, peça um «Link de acesso» a um
          administrador{me.is_owner ? " — ou gere-o em Utilizadores, na sua própria linha" : ""}.
        </p>
      </ActionForm>
    </div>
  );
}
