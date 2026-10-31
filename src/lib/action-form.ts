/**
 * O envio de um `ActionForm` (backoffice), sem React: o que se pergunta, o que
 * se chama e quando se limpa o formulário.
 *
 * Não se usa `<form action={fn}>`: no React 19 o formulário é sempre limpo
 * depois de uma ação, corra ela bem ou mal — e um erro de validação apagava o
 * que se tinha escrito. Aqui só se limpa quando a ação corre bem; cancelar a
 * confirmação não toca em nada.
 */
export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Para onde ir depois (ex.: o registo deixou de existir). */
  redirect?: string;
}

export type SubmitOutcome = "cancelled" | "error" | "ok";

export async function submitActionForm(deps: {
  confirmText?: string;
  confirm: (text: string) => boolean;
  data: () => FormData;
  action: (data: FormData) => Promise<ActionResult>;
  onError: (message: string) => void;
  onSuccess: (result: ActionResult) => void;
  reset: () => void;
}): Promise<SubmitOutcome> {
  if (deps.confirmText && !deps.confirm(deps.confirmText)) return "cancelled";
  const data = deps.data();
  try {
    const result = await deps.action(data);
    if (!result.ok) {
      deps.onError(result.error ?? "Não foi possível guardar.");
      return "error";
    }
    deps.reset();
    deps.onSuccess(result);
    return "ok";
  } catch {
    deps.onError("Não foi possível guardar. Verifique a ligação e tente novamente.");
    return "error";
  }
}
