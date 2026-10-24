import { LoginForm } from "@/components/admin/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect } = await searchParams;

  return (
    <main className="grid min-h-dvh place-items-center bg-ink px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-2xl font-bold tracking-tight text-paper">
            Core<span className="text-accent">Motors</span>
          </p>
          <p className="mt-2 text-sm text-paper/50">Backoffice · acesso restrito</p>
        </div>
        <LoginForm redirectTo={redirect ?? "/admin"} />
      </div>
    </main>
  );
}
