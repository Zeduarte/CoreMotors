import Link from "next/link";
import { AnimatedText } from "@/components/ui/AnimatedText";
import { Reveal } from "@/components/ui/Reveal";
import { waHref, DEFAULT_COMPANY, type Company } from "@/lib/branding";
import {
  DEFAULT_HOME_CONTENT,
  type CtaSectionContent,
} from "@/lib/home-content";

export function ContactCTA({
  content = DEFAULT_HOME_CONTENT.cta,
  company = DEFAULT_COMPANY,
  background = null,
}: {
  content?: CtaSectionContent;
  company?: Company;
  /** contacto.jpg do mundo escolhido, se existir. */
  background?: string | null;
}) {
  return (
    <section className="container-px py-24 md:py-40">
      {/* `site-dark`: no modo claro fica como no escuro (foto com texto por cima). */}
      <div className="site-dark relative overflow-hidden rounded-3xl border border-white/10 bg-ink-soft px-6 py-20 text-center md:px-16 md:py-32">
        {/* Imagem de fundo (contacto.jpg em public/media/carros|motas/) + escurecimento
            para o texto se manter legível. Fallback: fundo sólido. */}
        {background && (
          <div
            aria-hidden
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${background})` }}
          />
        )}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/55 to-ink/45"
        />

        <div className="relative z-10">
          <p className="eyebrow hero-text-shadow mb-6">{content.eyebrow}</p>
        <AnimatedText
          as="h2"
          className="hero-text-shadow mx-auto max-w-3xl text-headline font-semibold text-paper"
        >
          {content.title}
        </AnimatedText>

        <Reveal className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a
            href={waHref(company.whatsapp, "Olá! Tenho interesse numa viatura do stand.")}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-accent px-8 py-3.5 text-sm font-semibold text-ink transition-transform duration-300 ease-premium hover:scale-[1.03]"
          >
            {content.whatsappLabel}
          </a>
          <Link
            href={content.secondary.href}
            className="rounded-full border border-white/20 px-8 py-3.5 text-sm font-medium text-paper transition-colors duration-300 hover:border-white/60"
          >
            {content.secondary.label}
          </Link>
        </Reveal>

        <p className="mt-8 text-sm text-paper/50">
          Ou ligue já:{" "}
          <a href={company.phoneHref} className="text-paper hover:text-accent">
            {company.phone}
          </a>
        </p>
        </div>
      </div>
    </section>
  );
}
