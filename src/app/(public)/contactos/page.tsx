import { Locations } from "@/components/showroom/Locations";
import { getShowroomContent } from "@/lib/showroom-queries";
import type { Metadata } from "next";
import { AnimatedText } from "@/components/ui/AnimatedText";
import { Reveal } from "@/components/ui/Reveal";
import { Parallax } from "@/components/ui/Parallax";
import { ContactForm } from "@/components/forms/ContactForm";
import { waHref } from "@/lib/branding";
import { getBranding } from "@/lib/queries";
import { COMMON_MEDIA } from "@/lib/media";

export const metadata: Metadata = {
  title: "Contactos",
  alternates: { canonical: "/contactos" },
  description:
    "Fale connosco. Morada, horário, telefone, WhatsApp e mapa do showroom.",
};

export const revalidate = 300;

export default async function ContactsPage() {
  const { companyName, company } = await getBranding();
  // Mapa normal do Google Maps (embed clássico, sem API key).
  const { lat, lng } = company.geo;
  const mapSrc = `https://maps.google.com/maps?q=${lat},${lng}&z=15&hl=pt-PT&output=embed`;

  return (
    <div className="pb-24 pt-32 md:pt-40">
      <section className="container-px">
        <p className="eyebrow mb-6">Contactos</p>
        <AnimatedText
          as="h1"
          splitBy="word"
          className="max-w-3xl text-display font-bold text-paper"
        >
          Estamos aqui para ajudar
        </AnimatedText>
      </section>

      <div className="container-px">
        <Locations items={(await getShowroomContent()).locations} />
      </div>
      {/* Banner com parallax subtil. A foto (public/media/comum/contactos.jpg) é
          opcional: se faltar, fica o gradiente por baixo — nunca dá imagem
          partida. Basta colocar o ficheiro para aparecer automaticamente. */}
      <section className="container-px mt-12">
        <div className="relative aspect-[21/9] overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-ink-muted via-ink to-black">
          <Parallax amount={0.12} className="absolute inset-0 scale-110">
            <div
              aria-hidden
              className="h-full w-full bg-cover bg-center"
              style={{ backgroundImage: `url(${COMMON_MEDIA.contactos})` }}
            />
          </Parallax>
        </div>
      </section>

      <section className="container-px mt-16 grid gap-12 lg:grid-cols-2">
        <Reveal stagger={0.1} className="space-y-8">
          <ContactBlock label="Morada">
            {company.address.street}
            <br />
            {company.address.postalCode} {company.address.city},{" "}
            {company.address.country}
          </ContactBlock>

          <ContactBlock label="Horário">{company.hours}</ContactBlock>

          <ContactBlock label="Telefone">
            <a href={company.phoneHref} className="hover:text-accent">
              {company.phone}
            </a>
          </ContactBlock>

          <ContactBlock label="Email">
            <a href={`mailto:${company.email}`} className="hover:text-accent">
              {company.email}
            </a>
          </ContactBlock>

          <div className="flex flex-wrap gap-3 pt-2">
            <a
              href={waHref(
                company.whatsapp,
                "Olá! Gostava de mais informações.",
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full bg-accent px-7 py-3 text-sm font-semibold text-ink transition-transform hover:scale-[1.03]"
            >
              Falar por WhatsApp
            </a>
            <a
              href={company.phoneHref}
              className="rounded-full border border-white/20 px-7 py-3 text-sm font-medium text-paper transition-colors hover:border-white/60"
            >
              Ligar agora
            </a>
          </div>
        </Reveal>

        <div className="space-y-8">
          <ContactForm />

          {/* Mapa (OpenStreetMap — sem API key nem cookies de terceiros). */}
          <div className="min-h-[20rem] overflow-hidden rounded-3xl border border-white/10">
            <iframe
              title={`Mapa da localização do ${companyName}`}
              src={mapSrc}
              className="h-full min-h-[20rem] w-full"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function ContactBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-white/10 pb-6">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-paper/40">
        {label}
      </p>
      <p className="mt-2 text-lg font-light text-paper/80">{children}</p>
    </div>
  );
}
