/**
 * Mantém o Tab dentro de um diálogo modal (`aria-modal`): do último elemento
 * focável volta ao primeiro e, com Shift+Tab, do primeiro vai ao último. Sem
 * isto, o teclado saía do lightbox para a página que está por trás, tapada.
 *
 * Devolve `true` quando tratou a tecla (e cancelou o comportamento normal).
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])';

export function trapTab(
  container: HTMLElement | null,
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">,
  active: Element | null = typeof document === "undefined" ? null : document.activeElement,
): boolean {
  if (!container || event.key !== "Tab") return false;
  const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (!items.length) {
    event.preventDefault();
    return true;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const inside = !!active && container.contains(active);
  if (event.shiftKey && (!inside || active === first)) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && (!inside || active === last)) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
