import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Política de Cookies",
  alternates: { canonical: "/politica-de-cookies" },
  description:
    "O que são cookies, que cookies utilizamos neste site e como pode geri-los.",
};

export const revalidate = 3600;

export default function CookiesPage() {
  return (
    <LegalPage title="Política de Cookies">
      <p>
        Esta página explica o que são cookies, que tipos utilizamos e como pode
        controlá-los.
      </p>

      <h2>1. O que são cookies</h2>
      <p>
        Cookies são pequenos ficheiros de texto guardados no seu dispositivo
        quando visita um site. Servem para o site funcionar corretamente,
        recordar preferências e, quando autorizado, recolher estatísticas de
        utilização.
      </p>

      <h2>2. Cookies que utilizamos</h2>
      <ul>
        <li>
          <strong>Essenciais</strong> — necessários ao funcionamento do site
          (por ex.: guardar a sua decisão sobre cookies). Não requerem
          consentimento.
        </li>
        <li>
          <strong>Análise</strong> — ajudam-nos a perceber como o site é
          utilizado, de forma agregada, para o melhorar. Só são ativados{" "}
          <strong>depois de os aceitar</strong> no aviso de cookies.
        </li>
      </ul>

      <h2>3. Gestão de cookies</h2>
      <p>
        Quando visita o site pela primeira vez, apresentamos um aviso onde pode{" "}
        <strong>aceitar</strong> ou <strong>recusar</strong> os cookies de
        análise. Pode alterar a sua escolha a qualquer momento limpando os dados
        do site no seu navegador. Pode também bloquear ou eliminar cookies nas
        definições do navegador — note que desativar alguns cookies pode afetar
        o funcionamento do site.
      </p>

      <h2>4. Alterações</h2>
      <p>
        Esta política pode ser atualizada. A versão em vigor está sempre
        disponível nesta página.
      </p>
    </LegalPage>
  );
}
