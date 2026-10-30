import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { getBranding } from "@/lib/queries";
import { LEGAL_NAME, NIF } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  alternates: { canonical: "/politica-de-privacidade" },
  description:
    "Como recolhemos, usamos e protegemos os seus dados pessoais, e os direitos que lhe assistem ao abrigo do RGPD.",
};

export const revalidate = 3600;

export default async function PrivacyPage() {
  const { companyName, company } = await getBranding();

  return (
    <LegalPage title="Política de Privacidade">
      <p>
        A presente Política de Privacidade descreve como a{" "}
        <strong>{LEGAL_NAME}</strong> (NIF {NIF}), doravante “{companyName}”,
        recolhe e trata os dados pessoais dos utilizadores deste site, em
        conformidade com o Regulamento Geral sobre a Proteção de Dados (RGPD) e
        a legislação nacional aplicável.
      </p>

      <h2>1. Responsável pelo tratamento</h2>
      <p>
        O responsável pelo tratamento dos seus dados é a {LEGAL_NAME}, com
        morada em {company.address.street}, {company.address.postalCode}{" "}
        {company.address.city}. Para qualquer questão relativa a dados pessoais,
        pode contactar-nos através de{" "}
        <a href={`mailto:${company.email}`}>{company.email}</a>.
      </p>

      <h2>2. Que dados recolhemos</h2>
      <ul>
        <li>
          <strong>Dados de contacto</strong> que nos fornece nos formulários do
          site (nome, email, telefone) ao pedir informações, propor um valor,
          marcar um test drive ou reservar uma viatura.
        </li>
        <li>
          <strong>Conteúdo das mensagens</strong> que nos envia.
        </li>
        <li>
          <strong>Dados de navegação</strong> (por ex.: páginas visitadas),
          recolhidos apenas com o seu consentimento para fins estatísticos.
        </li>
      </ul>

      <h2>3. Finalidades e fundamento legal</h2>
      <ul>
        <li>
          Responder aos seus pedidos e gerir o contacto comercial — com base no
          seu consentimento e no interesse legítimo em dar-lhe resposta.
        </li>
        <li>
          Gerir reservas e propostas de compra — com base na execução de
          diligências pré-contratuais.
        </li>
        <li>
          Análise estatística do site — apenas mediante o seu consentimento
          (cookies de análise).
        </li>
        <li>Cumprimento de obrigações legais, quando aplicável.</li>
      </ul>

      <h2>4. Partilha de dados</h2>
      <p>
        Não vendemos os seus dados. Podemos partilhá-los com prestadores de
        serviços que atuam em nosso nome (por ex.: alojamento do site,
        ferramentas de análise), sempre sujeitos a obrigações de
        confidencialidade, ou com autoridades quando legalmente exigido.
      </p>

      <h2>5. Prazo de conservação</h2>
      <p>
        Conservamos os seus dados apenas durante o tempo necessário às
        finalidades para que foram recolhidos ou pelos prazos exigidos por lei.
      </p>

      <h2>6. Os seus direitos</h2>
      <p>
        Nos termos do RGPD, tem direito a aceder, retificar, apagar, limitar ou
        opor-se ao tratamento dos seus dados, bem como à portabilidade e à
        retirada do consentimento a qualquer momento. Para exercer estes
        direitos, contacte-nos por{" "}
        <a href={`mailto:${company.email}`}>{company.email}</a>. Tem ainda o
        direito de apresentar reclamação à autoridade de controlo, a Comissão
        Nacional de Proteção de Dados (CNPD).
      </p>

      <h2>7. Alterações</h2>
      <p>
        Esta política pode ser atualizada. A versão em vigor está sempre
        disponível nesta página.
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
