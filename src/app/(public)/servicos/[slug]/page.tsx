import { notFound } from "next/navigation";
import Link from "next/link";
import { getShowroomContent } from "@/lib/showroom-queries";
import { FaqSection } from "@/components/showroom/FaqSection";
import { Locations } from "@/components/showroom/Locations";
import { OrderCarForm } from "@/components/forms/OrderCarForm";
import { ContactForm } from "@/components/forms/ContactForm";
export const revalidate = 300;
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const c = await getShowroomContent();
  const s = c.services.find((x) => x.id === slug && x.enabled);
  return {
    title: s?.title ?? "Serviço indisponível",
    description: s?.summary,
    ...(s && { alternates: { canonical: `/servicos/${s.id}` } }),
  };
}
export default async function ServicePage({ params }: Props) {
  const { slug } = await params;
  const content = await getShowroomContent();
  const service = content.services.find((s) => s.id === slug && s.enabled);
  if (!service) notFound();
  return (
    <div className="container-px pb-20 pt-32">
      <Link href="/servicos" className="text-sm text-accent">
        ← Serviços
      </Link>
      <h1 className="mt-6 text-headline font-semibold">{service.title}</h1>
      <p className="mt-5 max-w-3xl text-xl text-paper/65">{service.summary}</p>
      <div className="mt-12 grid gap-12 lg:grid-cols-2">
        <article className="space-y-5 text-paper/75">
          {service.body.split(/\n\s*\n/).map((p, i) => (
            <p className="whitespace-pre-line leading-relaxed" key={i}>
              {p}
            </p>
          ))}
          <FaqSection
            items={content.faqs.filter((f) => f.category === service.id)}
          />
        </article>
        <div>
          {service.id === "encomendas" ? (
            <OrderCarForm />
          ) : (
            <ContactForm
              subject={`Serviço: ${service.title}`}
              kind={service.id === "financiamento" ? "finance" : "contact"}
            />
          )}
        </div>
      </div>
      <Locations items={content.locations} />
    </div>
  );
}
