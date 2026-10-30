import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { getBranding } from "@/lib/queries";
import { LEGAL_NAME, NIF } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Termos e Condições",
  alternates: { canonical: "/termos-condicoes" },
  description:
    "Condições de utilização deste site e da relação comercial com os nossos clientes.",
};

export const revalidate = 3600;

export default async function TermsPage() {
  const { companyName, company } = await getBranding();

  return (
    <LegalPage title="Termos e Condições">
      <p>
        Estes Termos e Condições regulam a utilização do site da{" "}
        <strong>{LEGAL_NAME}</strong> (NIF {NIF}), doravante “{companyName}”. Ao
        utilizar o site, o utilizador aceita estes termos.
      </p>

      <h2>1. Objeto</h2>
      <p>
        O site destina-se à divulgação das viaturas disponíveis e ao contacto
        com potenciais clientes. Não constitui, por si só, uma proposta
        contratual vinculativa.
      </p>

      <h2>2. Informação sobre as viaturas e preços</h2>
      <p>
        Envidamos esforços para manter a informação atualizada e rigorosa. Ainda
        assim, as características, disponibilidade e preços das viaturas são
        indicativos e podem conter lapsos, estando sujeitos a confirmação antes
        da celebração de qualquer negócio. Uma viatura pode deixar de estar
        disponível a qualquer momento.
      </p>

      <h2>3. Pedidos, propostas e reservas</h2>
      <p>
        Os formulários do site (pedido de informações, proposta, test drive e
        reserva) destinam-se a iniciar o contacto. Eventuais reservas com sinal
        são confirmadas diretamente connosco; o sinal e as respetivas condições
        são acordados nesse momento.
      </p>

      <h2>4. Propriedade intelectual</h2>
      <p>
        Os conteúdos do site (textos, imagens, marca e logótipo) são propriedade
        da {companyName} ou dos respetivos titulares e não podem ser utilizados
        sem autorização.
      </p>

      <h2>5. Responsabilidade</h2>
      <p>
        Não nos responsabilizamos por interrupções temporárias do site nem por
        eventuais imprecisões, sem prejuízo dos direitos que a lei confere aos
        consumidores.
      </p>

      <h2>6. Resolução de litígios</h2>
      <p>
        Em caso de litígio de consumo, o consumidor pode recorrer a uma entidade
        de Resolução Alternativa de Litígios (RAL) e à plataforma de resolução
        de litígios em linha da União Europeia, disponível em{" "}
        <a
          href="https://ec.europa.eu/consumers/odr"
          target="_blank"
          rel="noopener noreferrer"
        >
          ec.europa.eu/consumers/odr
        </a>
        . Está igualmente disponível o Livro de Reclamações eletrónico em{" "}
        <a
          href="https://www.livroreclamacoes.pt/Inicio/"
          target="_blank"
          rel="noopener noreferrer"
        >
          livroreclamacoes.pt
        </a>
        .
      </p>

      <h2>7. Lei aplicável</h2>
      <p>
        Estes termos regem-se pela lei portuguesa. Para mais informações,
        contacte-nos por <a href={`mailto:${company.email}`}>{company.email}</a>
        .
      </p>
      <h2>Google Maps e avaliações</h2>
      <p>
        Quando disponíveis, as avaliações são obtidas do Google Maps após
        selecionar “Mostrar avaliações”. As fotografias dos autores e as
        ligações externas podem contactar serviços Google. Consulte os{" "}
        <a href="https://www.google.com/intl/pt-PT/help/terms_maps/">
          Termos do Google Maps
        </a>{" "}
        e a{" "}
        <a href="https://policies.google.com/privacy?hl=pt-PT">
          Política de Privacidade da Google
        </a>
        .
      </p>
    </LegalPage>
  );
}
