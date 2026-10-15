# Modelos de WhatsApp dos avisos à equipa

Quando entra algo novo no backoffice — um contacto do site, uma proposta de preço, um pedido de reserva, um testemunho por aprovar, uma viatura nova — cada colaborador com telefone no perfil recebe uma mensagem no WhatsApp sobre o que é da sua área.

Estas mensagens são a empresa a iniciar a conversa. Fora da janela de 24 horas que se abre quando a pessoa escreve, a Meta **só aceita modelos (templates) aprovados**. Por isso, antes de ligar os avisos, o administrador de cada stand tem de criar estes quatro modelos na conta do WhatsApp Business **do número ligado ao site** (cada stand tem a sua conta; os modelos não passam de uma conta para outra).

## Como criar cada modelo

1. Abra o [WhatsApp Manager](https://business.facebook.com/wa/manage/message-templates/) da conta do número ligado em Integrações → **Modelos de mensagem** → **Criar modelo**.
2. Categoria: **Utility** (utilidade). São avisos sobre a conta e a atividade da empresa, não marketing.
3. Nome: o indicado abaixo, exatamente (só minúsculas, algarismos e `_`).
4. Idioma: **Portuguese (POR)** — código `pt_PT`.
5. Sem cabeçalho, sem rodapé e sem botões. No **corpo**, cole o texto exato abaixo, com as mesmas mudanças de linha. As variáveis `{{1}}`, `{{2}}`, … têm de ficar como estão.
6. Em **Exemplos de variáveis**, preencha com os exemplos indicados (a Meta pede-os para aprovar).
7. Submeta. A aprovação costuma levar de minutos a algumas horas.

Quando os quatro estiverem **Ativos**, vá a **Integrações → Avisos por WhatsApp**, carregue em **Enviar teste para o meu telefone** (envia os quatro modelos, com valores de exemplo, para o telefone do seu perfil — se a Meta recusar algum, o motivo aparece logo) e depois marque **Enviar avisos por WhatsApp à equipa**.

Se a Meta recusar um nome (por exemplo, porque já existiu um modelo apagado com esse nome há menos de 30 dias), crie-o com outro nome e indique-o na variável de ambiente correspondente, no Netlify. O texto e as variáveis têm de ser os mesmos.

## 1. `engineline_lead` — pedidos do site

Usado para todos os contactos que chegam pelo site: pedido de contacto, de financiamento, de test drive, proposta de preço, pedido de reserva com sinal, pedido de venda ou retoma, encomenda de viatura e alerta de stock («avise-me quando entrar»).

- Nome: `engineline_lead` (variável `WHATSAPP_TEMPLATE_LEAD` para usar outro)
- Categoria: Utility · Idioma: `pt_PT`

Corpo:

```
Novo pedido no backoffice: {{1}}.

Cliente: {{2}}
Viatura: {{3}}

Abra o pedido em {{4}} para responder ao cliente.
```

Exemplos:

| Variável | O que é | Exemplo |
|---|---|---|
| `{{1}}` | O tipo de pedido | `proposta de preço de 18 500 €` |
| `{{2}}` | O nome do cliente | `Maria Silva` |
| `{{3}}` | A viatura, ou «sem viatura associada» | `BMW 320d Touring` |
| `{{4}}` | O link para o contacto no backoffice | `https://www.exemplo.pt/admin/leads/3f2a9c1e-5b7d-4e8a-9c2f-1a2b3c4d5e6f` |

## 2. `engineline_viatura` — viaturas

Usado quando uma viatura entra na oficina (incluindo as registadas pelo assistente do WhatsApp), é criada em Viaturas, é dada como preparada pela oficina, é publicada no site pela primeira vez, ou é reservada por um colega. Quando várias viaturas chegam de uma vez para a mesma pessoa (publicar em lote), vai uma mensagem só, com o número de viaturas.

- Nome: `engineline_viatura` (variável `WHATSAPP_TEMPLATE_VIATURA` para usar outro)
- Categoria: Utility · Idioma: `pt_PT`

Corpo:

```
Novidade nas viaturas do backoffice: {{1}}.

Viatura: {{2}}

Veja os detalhes em {{3}} quando puder.
```

Exemplos:

| Variável | O que é | Exemplo |
|---|---|---|
| `{{1}}` | O que aconteceu | `viatura publicada no site` |
| `{{2}}` | A viatura (e a matrícula, se houver) | `Honda CB500F · AA-00-BB` |
| `{{3}}` | O link para a ficha no backoffice | `https://www.exemplo.pt/admin/carros/7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f` |

## 3. `engineline_testemunho` — testemunhos por aprovar

Usado quando um visitante deixa um testemunho no site. Só aparece no site depois de alguém com o separador Testemunhos o aprovar.

- Nome: `engineline_testemunho` (variável `WHATSAPP_TEMPLATE_TESTEMUNHO` para usar outro)
- Categoria: Utility · Idioma: `pt_PT`

Corpo:

```
Chegou um testemunho novo pelo site, à espera de aprovação.

Autor: {{1}}
Classificação: {{2}} em 5

Aprove-o ou recuse-o em {{3}}: só aparece no site depois de aprovado.
```

Exemplos:

| Variável | O que é | Exemplo |
|---|---|---|
| `{{1}}` | Quem escreveu | `João Pereira` |
| `{{2}}` | As estrelas, de 1 a 5 | `5` |
| `{{3}}` | O link para os testemunhos no backoffice | `https://www.exemplo.pt/admin/testemunhos` |

## 4. `engineline_aviso` — avisos gerais

Usado para avisos sobre o próprio backoffice. Hoje: o acesso ao WhatsApp dado pela Meta dura 60 dias e, quando expira, o WhatsApp todo pára (respostas do assistente e avisos). Uma semana antes, quem tem o separador Integrações recebe este aviso.

- Nome: `engineline_aviso` (variável `WHATSAPP_TEMPLATE_AVISO` para usar outro)
- Categoria: Utility · Idioma: `pt_PT`

Corpo:

```
Aviso do backoffice: {{1}}.

Para evitar interrupções, trate disto em {{2}} logo que possível.
```

Exemplos:

| Variável | O que é | Exemplo |
|---|---|---|
| `{{1}}` | O aviso | `o acesso ao WhatsApp dado pela Meta expira a 12/12/2026; volte a ligar o número em «Trocar de número»` |
| `{{2}}` | O link para a página certa do backoffice | `https://www.exemplo.pt/admin/integracoes` |

## Quem recebe o quê

Cada colaborador recebe um aviso se **todas** estas condições se cumprirem:

- tem telefone no perfil («O meu perfil»);
- tem acesso ao separador do aviso: Leads (contactos do site e reservas), Testemunhos, Oficina (entradas na oficina), Viaturas (viaturas criadas, preparadas e publicadas) ou Integrações (acesso ao WhatsApp a expirar);
- tem acesso ao tipo de viatura (carros/motas), quando o aviso é sobre uma viatura ou um contacto de um dos tipos;
- não desligou esse aviso em «O meu perfil → Avisos por WhatsApp» (por defeito, estão todos ligados);
- não foi ele próprio a fazer a ação.

As condições voltam a ser verificadas no momento do envio: quem perdeu o acesso entretanto já não recebe. O mesmo acontecimento nunca chega duas vezes à mesma pessoa.

## Outras variáveis de ambiente

| Variável | Por defeito | Para quê |
|---|---|---|
| `WHATSAPP_TEMPLATE_LEAD` | `engineline_lead` | Nome do modelo dos pedidos do site |
| `WHATSAPP_TEMPLATE_VIATURA` | `engineline_viatura` | Nome do modelo das viaturas |
| `WHATSAPP_TEMPLATE_TESTEMUNHO` | `engineline_testemunho` | Nome do modelo dos testemunhos |
| `WHATSAPP_TEMPLATE_AVISO` | `engineline_aviso` | Nome do modelo dos avisos gerais |
| `WHATSAPP_TEMPLATE_LANGUAGE` | `pt_PT` | Idioma em que os modelos foram aprovados |

O endereço dos links é o `NEXT_PUBLIC_SITE_URL` do site.

## Quando um envio falha

Em **Integrações → Avisos por WhatsApp → Últimos avisos** aparece cada aviso, a quem foi e o resultado. Quando a Meta recusa, aparece o motivo dela (por exemplo `(#132001) Template name does not exist in the translation` — o modelo não existe, não foi aprovado, ou tem outro nome/idioma).

- Erros passageiros repetem-se sozinhos, até 8 vezes.
- Erros que não se resolvem a repetir (modelo inexistente ou pausado, variáveis erradas, número sem WhatsApp) param logo e ficam à espera do administrador, com o botão **Voltar a tentar**.
- Se a Meta não responder a tempo, a mensagem **pode ter chegado**: não se repete sozinha, para não chegar duas vezes. Confirme com a pessoa e use **Voltar a tentar** se não chegou.
- Um aviso que fique mais de 24 horas sem poder ser enviado (por exemplo, sem número ligado) já não é novidade e não se envia.
