/**
 * Nomes de utilizador do backoffice (partilhado entre cliente e servidor).
 *
 * Entra-se com nome de utilizador + palavra-passe. O Supabase Auth exige um
 * email, por isso cada conta nova recebe um email interno derivado do nome
 * (`jose.duarte@utilizadores.coremotors.local`), que nunca recebe correio. As
 * contas antigas (o dono incluído) mantêm o email que já tinham: o login
 * pergunta à BD (`login_email`, 0053) qual é o email de cada nome.
 */

/** Domínio dos emails internos. `.local` não existe: nada sai para fora. */
export const INTERNAL_EMAIL_DOMAIN = "utilizadores.coremotors.local";

/** Letras, números e . _ - entre eles (igual ao `check` da 0053). */
export const USERNAME_RE = /^[A-Za-z0-9]+([._-][A-Za-z0-9]+)*$/;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;

export const PASSWORD_MIN = 8;
/** O bcrypt do Supabase ignora o que passa dos 72 bytes. */
export const PASSWORD_MAX = 72;

/** Quanto tempo vale um link de convite. */
export const INVITE_TTL_DAYS = 7;

/** O nome é válido? (Já sem espaços à volta.) */
export function isUsername(value: string): boolean {
  return usernameProblem(value) === null;
}

/** Mensagem de erro do nome, ou null se estiver bom. */
export function usernameProblem(value: string): string | null {
  if (!value) return "Indique o nome de utilizador.";
  if (value.length < USERNAME_MIN) return `O nome de utilizador tem de ter pelo menos ${USERNAME_MIN} caracteres.`;
  if (value.length > USERNAME_MAX) return `O nome de utilizador tem no máximo ${USERNAME_MAX} caracteres.`;
  if (!USERNAME_RE.test(value)) {
    return "Use só letras sem acentos, números e . _ - entre eles (ex.: jose.duarte).";
  }
  return null;
}

/** Email interno de Auth para uma conta nova. */
export function internalEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${INTERNAL_EMAIL_DOMAIN}`;
}

/** É um email interno (não é para mostrar como contacto)? */
export function isInternalEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${INTERNAL_EMAIL_DOMAIN}`);
}

/** Mensagem de erro da palavra-passe nova, ou null se estiver boa. */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < PASSWORD_MIN) return `A palavra-passe tem de ter pelo menos ${PASSWORD_MIN} caracteres.`;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX) {
    return `A palavra-passe tem no máximo ${PASSWORD_MAX} caracteres.`;
  }
  if (password !== confirm) return "As duas palavras-passe não são iguais.";
  return null;
}
