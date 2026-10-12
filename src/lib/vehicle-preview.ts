/**
 * Foto do cartão em que se clicou, para o esqueleto da ficha a mostrar logo
 * (já está no browser, não há nada a descarregar). Fica só em memória, para a
 * navegação seguinte dentro do site.
 */
let preview: { slug: string; src: string } | null = null;

export function setVehiclePreview(slug: string, src: string | undefined) {
  preview = src ? { slug, src } : null;
}

export function vehiclePreview(slug: string): string | null {
  return preview?.slug === slug ? preview.src : null;
}
