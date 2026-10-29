import { getShowroomContent } from "@/lib/showroom-queries";
import { ServiceCards } from "@/components/showroom/ServiceCards";
export const metadata = {
  title: "Serviços",
  description:
    "Conheça os serviços e o acompanhamento disponíveis para a sua próxima viatura.",
};
export const revalidate = 300;
export default async function ServicesPage() {
  const content = await getShowroomContent();
  return (
    <div className="container-px pb-20 pt-32">
      <h1 className="text-headline font-semibold">Como podemos ajudar?</h1>
      <ServiceCards items={content.services} />
    </div>
  );
}
