"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  createInviteLink,
  createUser,
  deleteUser,
  updateUserAccess,
  type InviteResult,
} from "@/lib/actions/users";
import type { UserRole } from "@/lib/supabase/database.types";
import {
  ADMIN_ONLY,
  assignableRoles,
  canManage,
  effectiveSections,
  effectiveVehicleTypes,
  ROLE_LABEL,
  SECTIONS,
  ALWAYS,
  PERSONAL,
  type Role,
  type Section,
} from "@/lib/permissions";
import { INVITE_TTL_DAYS, USERNAME_MAX, usernameProblem } from "@/lib/usernames";
import type { VehicleType } from "@/lib/vehicle-categories";

export interface UserInvite {
  state: "pending" | "expired";
  expiresAt: string;
}

export interface UserItem {
  id: string;
  username: string | null;
  /** Email de contacto (null nas contas novas, que só têm o email interno). */
  email: string | null;
  full_name: string | null;
  role: UserRole;
  allowed_sections: string[] | null;
  allowed_vehicle_types: string[] | null;
  is_owner: boolean;
  created_at: string;
  /** Convite por usar (pendente ou expirado), se houver. */
  invite: UserInvite | null;
}

/**
 * Acesso por tipo de viatura. Guardado como lista, mas apresentado como três
 * escolhas — é assim que o cliente pensa no problema.
 */
const TYPE_CHOICES: { value: string; label: string; types: VehicleType[] }[] = [
  { value: "both", label: "Carros e motas", types: ["car", "motorcycle"] },
  { value: "car", label: "Só carros", types: ["car"] },
  { value: "motorcycle", label: "Só motas", types: ["motorcycle"] },
];

function choiceFor(types: VehicleType[]): string {
  if (types.length > 1) return "both";
  return types[0] ?? "both";
}

/**
 * Separadores que se atribuem: nem as Horas (pessoais, toda a gente as tem)
 * nem os só de administrador.
 */
const GRANTABLE = SECTIONS.filter((s) => s.key !== PERSONAL && !ADMIN_ONLY.includes(s.key));

/** Data no fuso de Lisboa, igual no servidor e no browser. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-PT", {
    timeZone: "Europe/Lisbon",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Link gerado, para o administrador copiar e enviar. */
interface ShownLink {
  url: string;
  expiresAt: string;
}

function toShownLink(res: InviteResult): ShownLink | null {
  if (!res.ok || !res.path || !res.expiresAt) return null;
  return { url: `${window.location.origin}${res.path}`, expiresAt: res.expiresAt };
}

function InviteLinkBox({ link, who, onClose }: { link: ShownLink; who: string; onClose: () => void }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url);
      toast.success("Link copiado.");
    } catch {
      toast.error("Não foi possível copiar. Selecione o link e copie à mão.");
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-accent/30 bg-accent/5 p-4">
      <p className="text-sm text-paper">
        Envie este link a <strong>{who}</strong>. Serve uma única vez e é válido
        até <strong>{formatDate(link.expiresAt)}</strong>.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          readOnly
          value={link.url}
          onFocus={(e) => e.currentTarget.select()}
          className="field font-mono text-xs"
          aria-label="Link de convite"
        />
        <button type="button" onClick={copy} className="btn-primary h-auto shrink-0 px-5 py-2 text-sm">
          Copiar
        </button>
      </div>
      <p className="mt-2 text-xs text-paper/50">
        Por segurança o link não volta a aparecer. Se se perder, gere outro em «Link de acesso».
      </p>
      <button type="button" onClick={onClose} className="mt-2 text-xs text-paper/50 hover:text-paper">
        Fechar
      </button>
    </div>
  );
}

export function UsersManager({
  users,
  currentUser,
  canManageAuth,
}: {
  users: UserItem[];
  currentUser: { id: string; role: UserRole; is_owner: boolean };
  canManageAuth: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [showNew, setShowNew] = useState(false);
  const [username, setUsername] = useState("");
  const [created, setCreated] = useState<{ who: string; link: ShownLink } | null>(null);

  const roles = assignableRoles(currentUser.role);
  const canCreate = canManageAuth && currentUser.role === "admin";
  const typed = username.trim();
  const problem = typed ? usernameProblem(typed) : null;

  function submitNew(e: React.FormEvent) {
    e.preventDefault();
    const name = username.trim();
    startTransition(async () => {
      const res = await createUser({ username: name });
      const link = res.ok ? toShownLink(res) : null;
      if (link) {
        toast.success(`Utilizador «${name}» criado.`);
        setCreated({ who: name, link });
        setUsername("");
        setShowNew(false);
      } else {
        toast.error(res.error ?? "Erro ao criar.");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-paper/50">
          {users.length} {users.length === 1 ? "utilizador" : "utilizadores"}
        </p>
        {canCreate && (
          <button type="button" onClick={() => setShowNew((v) => !v)} className="btn-primary">
            {showNew ? "Cancelar" : "＋ Novo utilizador"}
          </button>
        )}
      </div>

      {!canManageAuth && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          Para <strong>criar</strong>, <strong>gerir</strong> ou <strong>apagar</strong> utilizadores,
          configure a variável <code>SUPABASE_SERVICE_ROLE_KEY</code> no servidor.
        </div>
      )}

      {showNew && canCreate && (
        <form onSubmit={submitNew} className="card space-y-4 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-paper/50">Novo utilizador</h2>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="new-username" className="field-label">
                Nome de utilizador
              </label>
              <input
                id="new-username"
                className="field"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ex.: jose.duarte"
                maxLength={USERNAME_MAX}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                autoFocus
                required
              />
            </div>
            <button type="submit" disabled={pending || !typed || !!problem} className="btn-primary h-auto px-6 py-2.5">
              {pending ? "A criar…" : "Criar"}
            </button>
          </div>
          {problem ? (
            <p className="text-xs text-red-300">{problem}</p>
          ) : (
            <p className="text-xs text-paper/40">
              Letras sem acentos, números e . _ - (ex.: jose.duarte). Recebe um link
              válido {INVITE_TTL_DAYS} dias para enviar à pessoa, que define lá a
              palavra-passe. A conta começa como vendedor; ajuste o papel e os
              separadores na lista.
            </p>
          )}
        </form>
      )}

      {created && (
        <InviteLinkBox link={created.link} who={created.who} onClose={() => setCreated(null)} />
      )}

      <div className="space-y-3">
        {users.map((u) => (
          <UserRow
            key={u.id}
            user={u}
            isSelf={u.id === currentUser.id}
            editable={
              u.id !== currentUser.id &&
              !u.is_owner &&
              canManage(currentUser.role, u.role, currentUser.is_owner)
            }
            assignable={roles}
            canManageAuth={canManageAuth}
            pending={pending}
            onSave={(r, secs, types) =>
              startTransition(async () => {
                const res = await updateUserAccess(u.id, r, secs, types);
                if (res.ok) toast.success("Permissões atualizadas.");
                else toast.error(res.error ?? "Erro.");
              })
            }
            onDelete={() => {
              if (!confirm(`Apagar ${u.full_name || u.username}? Irreversível.`)) return;
              startTransition(async () => {
                const res = await deleteUser(u.id);
                if (res.ok) toast.success("Utilizador apagado.");
                else toast.error(res.error ?? "Erro.");
              });
            }}
            onNewLink={(done) => {
              const who = u.full_name || u.username || "este utilizador";
              const warning = u.invite
                ? `Gerar um link novo para ${who}? O anterior deixa de funcionar.`
                : `Gerar um link para ${who} definir uma palavra-passe nova? A atual continua a funcionar até o link ser usado.`;
              if (!confirm(warning)) return;
              startTransition(async () => {
                const res = await createInviteLink(u.id);
                const link = toShownLink(res);
                if (link) {
                  toast.success("Link de acesso gerado.");
                  done(link);
                } else {
                  toast.error(res.error ?? "Erro ao gerar o link.");
                }
              });
            }}
          />
        ))}
      </div>
    </div>
  );
}

function UserRow({
  user,
  isSelf,
  editable,
  assignable,
  canManageAuth,
  pending,
  onSave,
  onDelete,
  onNewLink,
}: {
  user: UserItem;
  isSelf: boolean;
  editable: boolean;
  assignable: Role[];
  canManageAuth: boolean;
  pending: boolean;
  onSave: (role: UserRole, sections: string[], vehicleTypes: string[]) => void;
  onDelete: () => void;
  onNewLink: (done: (link: ShownLink) => void) => void;
}) {
  const [role, setRole] = useState<UserRole>(user.role);
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<ShownLink | null>(null);
  const [secs, setSecs] = useState<Set<string>>(
    () => new Set(effectiveSections(user.role, user.allowed_sections)),
  );
  const [typeChoice, setTypeChoice] = useState(() =>
    choiceFor(effectiveVehicleTypes(user.role, user.allowed_vehicle_types)),
  );
  const who = user.full_name || user.username || "este utilizador";

  function toggle(key: Section) {
    if (key === ALWAYS) return; // dashboard sempre ativo
    setSecs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-paper">
            {user.full_name || user.username}
            {isSelf && <span className="ml-2 text-xs text-accent">(você)</span>}
          </p>
          <p className="truncate text-xs text-paper/50">
            {user.username ? <span className="font-mono">{user.username}</span> : "sem nome de utilizador"}
            {user.email && <span> · {user.email}</span>}
          </p>
          {user.invite && (
            <p
              className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] ${
                user.invite.state === "pending"
                  ? "bg-amber-500/15 text-amber-200"
                  : "bg-red-500/15 text-red-300"
              }`}
            >
              {user.invite.state === "pending"
                ? `Convite por aceitar · até ${formatDate(user.invite.expiresAt)}`
                : "Convite expirado · gere um link novo"}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {editable ? (
            <>
              <select
                value={role}
                disabled={pending}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="rounded-lg border border-white/10 bg-ink px-2 py-1.5 text-xs text-paper"
                aria-label="Papel"
              >
                {assignable.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-paper/70 hover:border-accent hover:text-accent"
              >
                Separadores
              </button>
              {canManageAuth && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onNewLink(setLink)}
                  className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-paper/70 hover:border-accent hover:text-accent"
                >
                  Link de acesso
                </button>
              )}
              {canManageAuth && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={onDelete}
                  className="rounded-lg px-2 py-1.5 text-xs text-red-400/70 hover:bg-red-500/10 hover:text-red-300"
                  title="Apagar"
                  aria-label={`Apagar ${who}`}
                >
                  🗑
                </button>
              )}
            </>
          ) : (
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-paper/70">
              {user.is_owner ? "Dono" : (ROLE_LABEL[user.role as Role] ?? user.role)}
            </span>
          )}
        </div>
      </div>

      {link && <InviteLinkBox link={link} who={who} onClose={() => setLink(null)} />}

      {editable && open && (
        <div className="mt-4 border-t border-white/10 pt-4">
          {/* Acesso por tipo de viatura — transversal aos separadores. */}
          <div className="mb-5">
            <p className="mb-2 text-xs text-paper/50">
              {role === "admin"
                ? "Um administrador acede sempre a carros e motas."
                : "Tipos de viatura que este utilizador pode gerir."}
            </p>
            <div className="flex flex-wrap gap-2">
              {TYPE_CHOICES.map((c) => (
                <label
                  key={c.value}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                    typeChoice === c.value
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-white/10 text-paper/70 hover:border-white/20"
                  } ${role === "admin" ? "pointer-events-none opacity-50" : ""}`}
                >
                  <input
                    type="radio"
                    name={`vehicle-types-${user.id}`}
                    className="accent-[color:var(--accent)]"
                    checked={role === "admin" ? c.value === "both" : typeChoice === c.value}
                    disabled={role === "admin"}
                    onChange={() => setTypeChoice(c.value)}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </div>

          {role === "admin" ? (
            <p className="text-xs text-paper/50">
              Um administrador tem acesso a todos os separadores, incluindo Utilizadores.
            </p>
          ) : (
            <>
              <p className="mb-3 text-xs text-paper/50">
                Escolha os separadores a que este utilizador tem acesso. Utilizadores
                é só de administradores.
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {GRANTABLE.map(({ key: s, label }) => {
                  const locked = s === ALWAYS;
                  return (
                    <label
                      key={s}
                      className={`flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm ${
                        locked ? "opacity-60" : "cursor-pointer hover:border-white/20"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="accent-[color:var(--accent)]"
                        checked={locked || secs.has(s)}
                        disabled={locked}
                        onChange={() => toggle(s)}
                      />
                      {label}
                    </label>
                  );
                })}
              </div>
            </>
          )}

          <button
            type="button"
            disabled={pending}
            onClick={() =>
              onSave(
                role,
                [...secs],
                TYPE_CHOICES.find((c) => c.value === typeChoice)?.types ?? [],
              )
            }
            className="btn-primary mt-4 h-auto px-5 py-2 text-sm"
          >
            {pending ? "A guardar…" : "Guardar"}
          </button>
        </div>
      )}
    </div>
  );
}
