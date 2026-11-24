import { core } from "./core";
import type { ThemeConfig } from "./types";

/**
 * Core3: o site das maquetes da Supermotas. Parte do Core e muda:
 * - o menu (Motas · Moto 4 · Carros · Vender · Contactos · «Ver stock»), com
 *   o deslize entre páginas na ordem do menu;
 * - a página inicial: topo, cartões das categorias, últimas entradas e a faixa
 *   de serviços (os serviços deixam de ter menu), e depois o resto de sempre;
 * - Motas, Moto 4 e Carros: cada uma é o stock do Core2 só desse tipo.
 *
 * O CSS (o stock partilha o do Core2) está em `core2.css` e `core3.css`.
 */
export const core3: ThemeConfig = {
  ...core,
  id: "core3",
  label: "Core3",
  description: "O site das maquetes: menu Motas · Moto 4 · Carros, serviços na página inicial e uma página de stock por tipo.",
  texts: { ...core.texts },
  homeSections: [
    "c3hero",
    "c3categories",
    "c3latest",
    "c3services",
    "brands",
    "stock",
    "sell",
    "trust",
    "sold",
    "showroom",
    "testimonials",
    "contact",
  ],
  adminNotes: [
    { text: "Menu: Motas · Moto 4 · Carros · Vender · Contactos e o botão «Ver stock». A Moto 4 (as viaturas da categoria «Moto 4») aparece sempre num site que venda motas. «Vender» abre «Compramos o seu veículo» (a avaliação da retoma)." },
    {
      text: "Os serviços saem do menu: o Financiamento e a Garantia (se estiverem ativos) entram na faixa da página inicial, ao lado das retomas e das entregas.",
      href: "/admin/pagina-inicial#servicos",
      link: "Editar os serviços",
    },
    { text: "«Sobre» e «Veículo ideal» passam para o rodapé; o «Veículo ideal» também fica por baixo da faixa de serviços." },
  ],
};
