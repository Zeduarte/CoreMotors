import type { ThemeConfig } from "./types";

/** Core: o site como sempre foi. É a base dos outros temas. */
export const core: ThemeConfig = {
  id: "core",
  label: "Core",
  description: "A versão atual do site.",
  texts: {
    navHome: "Início",
    navStock: "Stock",
    navIdeal: "Veículo ideal",
    navServices: "Serviços",
    navAbout: "Sobre",
    navContacts: "Contactos",
  },
  homeSections: [
    "hero",
    "segments",
    "featured",
    "brands",
    "stock",
    "sell",
    "trust",
    "sold",
    "showroom",
    "testimonials",
    "contact",
  ],
};
