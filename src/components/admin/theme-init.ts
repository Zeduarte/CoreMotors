/** Onde o tema escolhido fica guardado (só neste navegador). */
export const ADMIN_THEME_KEY = "admin-theme";

/**
 * Corre antes da 1.ª pintura (inline no layout) para o backoffice não piscar o
 * tema errado. Vive aqui, e não em ThemeToggle, porque o layout é um Server
 * Component e um valor exportado de um módulo "use client" não chega ao
 * servidor como texto.
 */
export const THEME_INIT_SCRIPT = `try{var c=localStorage.getItem("${ADMIN_THEME_KEY}");var l=c==="light"||(c!=="dark"&&matchMedia("(prefers-color-scheme: light)").matches);document.documentElement.dataset.adminTheme=l?"light":"dark"}catch(e){}`;
