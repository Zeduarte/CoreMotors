import { startTransition, type FormEvent } from "react";

/**
 * `onSubmit` para formulários com `useActionState`, que NÃO apaga o que a
 * pessoa escreveu.
 *
 * No React 19, `<form action={fn}>` limpa os campos sempre que a ação acaba —
 * também quando o servidor recusa (telefone inválido, limite de pedidos) ou
 * quando a validação no browser não deixa enviar: o cliente perdia o nome, o
 * email e a mensagem. Com `onSubmit` não há limpeza automática; cada
 * formulário limpa-se sozinho só quando corre bem (`state.ok`).
 *
 * `validate` (opcional) é o `onSubmit` de validação que já existia: se chamar
 * `preventDefault()`, nada é enviado.
 */
export function submitKeepingFields(
  action: (data: FormData) => unknown,
  validate?: (e: FormEvent<HTMLFormElement>) => void,
) {
  return (e: FormEvent<HTMLFormElement>) => {
    validate?.(e);
    if (e.defaultPrevented) return;
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(e.currentTarget, submitter ?? undefined);
    startTransition(() => {
      action(data);
    });
  };
}
