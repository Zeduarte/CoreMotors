import Link from "next/link";
export function PrivacyNotice() {
  return (
    <label className="col-span-full my-3 flex items-start gap-3 text-xs leading-relaxed text-paper/65">
      <input
        className="mt-1 shrink-0 accent-[color:var(--accent)]"
        type="checkbox"
        name="privacy_acknowledged"
        value="yes"
        required
      />
      <span>
        Li a{" "}
        <Link
          href="/politica-de-privacidade"
          target="_blank"
          className="underline"
        >
          Política de Privacidade
        </Link>{" "}
        e tomei conhecimento dos{" "}
        <Link href="/termos-condicoes" target="_blank" className="underline">
          Termos e Condições
        </Link>
        . Os meus dados serão utilizados para responder a este pedido.
      </span>
    </label>
  );
}
