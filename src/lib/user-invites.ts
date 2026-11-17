import "server-only";
/**
 * Convites do backoffice: um token aleatório no link, de que a BD só guarda o
 * sha256 (`user_invites`, 0053). Com validade e de uso único.
 */
import { createHash, randomBytes } from "node:crypto";
import { INVITE_TTL_DAYS } from "@/lib/usernames";

export const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

/** 32 bytes aleatórios em base64url: 43 caracteres. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function isInviteToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Um token novo e o hash que vai para a BD. */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

/** Caminho do link de convite (o browser junta-lhe o domínio). */
export function invitePath(token: string): string {
  return `/admin/convite/${token}`;
}

export type InviteState = "pending" | "expired" | "used";

/** Estado de um convite num dado momento. */
export function inviteState(
  invite: { expires_at: string; used_at: string | null },
  now: number = Date.now(),
): InviteState {
  if (invite.used_at) return "used";
  return new Date(invite.expires_at).getTime() > now ? "pending" : "expired";
}
