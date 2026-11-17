import { LoginForm } from "@/components/admin/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; convite?: string }>;
}) {
  const { redirect, convite } = await searchParams;

  return (
    <main className="grid min-h-dvh place-items-center bg-ink px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-2xl font-bold tracking-tight text-paper">
            Super<span className="text-accent">motas</span>
          </p>
          <p className="mt-2 text-sm text-paper/50">Backoffice · acesso restrito</p>
        </div>
        {convite === "ok" && (
          <p className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200" role="status">
            Palavra-passe definida. Entre com o seu nome de utilizador.
          </p>
        )}
        <LoginForm redirectTo={redirect ?? "/admin"} />
      </div>
    </main>
  );
}
