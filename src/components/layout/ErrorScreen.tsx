import Image from "next/image";
import Link from "next/link";

/**
 * O ecrã das páginas de erro («não encontrada», «algo correu mal»): a marca do
 * stand, a mensagem e o atalho para o stock — quem chega aqui por um link
 * antigo ou partilhado deve continuar a ver viaturas, não sair do site.
 *
 * Sem hooks: serve tanto a `not-found` (servidor) como a `error` (cliente).
 */
export function ErrorScreen({
  companyName,
  logoUrl,
  eyebrow,
  title,
  text,
  children,
}: {
  companyName: string;
  logoUrl: string | null;
  eyebrow: string;
  title: string;
  text: string;
  /** Ações extra, antes do «Ver stock» (ex.: «Tentar novamente»). */
  children?: React.ReactNode;
}) {
  return (
    <main className="container-px flex min-h-dvh flex-col items-center justify-center text-center">
      <Link
        href="/"
        aria-label={`${companyName} — página inicial`}
        className="mb-12 flex items-center text-2xl font-bold tracking-tight text-paper"
      >
        {logoUrl ? (
          <Image
            src={logoUrl}
            alt={companyName}
            width={280}
            height={70}
            className="h-14 w-auto max-w-[70vw] object-contain"
            priority
          />
        ) : (
          <span>{companyName}</span>
        )}
      </Link>
      <p className="eyebrow mb-6">{eyebrow}</p>
      <h1 className="text-headline font-semibold text-paper">{title}</h1>
      <p className="mt-4 max-w-md font-light text-paper/60">{text}</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        {children}
        <Link
          href="/inventario"
          className="rounded-full bg-accent px-8 py-3.5 text-sm font-semibold text-ink transition-transform duration-300 ease-premium hover:scale-[1.03]"
        >
          Ver stock
        </Link>
      </div>
    </main>
  );
}
