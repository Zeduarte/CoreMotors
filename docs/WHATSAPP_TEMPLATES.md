# Modelos de WhatsApp dos avisos à equipa

Quando acontece algo no backoffice — um contacto do site, uma proposta de preço, um contacto atribuído, uma viatura que sai da oficina, uma venda, um pedido de férias, um colega que vai de férias — cada colaborador com telefone no perfil recebe uma mensagem no WhatsApp sobre o que é da sua área. A lista completa está em [Quem recebe o quê](#quem-recebe-o-quê).

Estas mensagens são a empresa a iniciar a conversa. Fora da janela de 24 horas que se abre quando a pessoa escreve, a Meta **só aceita modelos (templates) aprovados**. Por isso, antes de ligar os avisos, o administrador de cada stand tem de criar estes quatro modelos na conta do WhatsApp Business **do número ligado ao site** (cada stand tem a sua conta; os modelos não passam de uma conta para outra).

## O jeito rápido: o botão do backoffice

Em **Integrações → Avisos por WhatsApp**, o botão **Criar os modelos na Meta** submete de uma vez os seis modelos descritos abaixo (categoria Utility, `pt_PT`, texto e exemplos exatos); os que já existem são ignorados. Precisa do ID da conta do WhatsApp Business: vem da ligação feita em Integrações («Trocar de número») ou, se o número só estiver nas variáveis do Netlify, da variável `WHATSAPP_BUSINESS_ACCOUNT_ID` (WhatsApp Manager → Definições da conta). Se preferir, crie-os à mão como a seguir.

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

## 1. `engineline_contacto` — pedidos do site

Usado para todos os contactos que chegam pelo site: pedido de contacto, de financiamento, de test drive, proposta de preço, pedido de reserva com sinal, pedido de venda ou retoma, encomenda de viatura e alerta de stock («avise-me quando entrar»). E quando um colega atribui um contacto a alguém: `{{1}}` fica, por exemplo, `contacto atribuído a si (proposta de preço de 18 500 €)`.

O aviso leva **todos os dados do cliente** (telemóvel, email, mensagem), para quem o recebe saber do que se trata sem abrir o backoffice. Os dados são lidos do contacto no momento do envio. Se faltar algum, a mensagem diz «não indicado» ou «sem mensagem».

O modelo anterior, `engineline_lead`, tinha um link em vez dos dados. Pode continuar na Meta; o site já não o usa.

- Nome: `engineline_contacto` (variável `WHATSAPP_TEMPLATE_LEAD` para usar outro)
- Categoria: Utility · Idioma: `pt_PT`

Corpo:

```
Novo pedido no backoffice: {{1}}.

Cliente: {{2}}
Telemóvel: {{3}}
Email: {{4}}
Viatura: {{5}}
Mensagem: {{6}}

Responda ao cliente o mais depressa possível.
```

Exemplos:

| Variável | O que é | Exemplo |
|---|---|---|
| `{{1}}` | O tipo de pedido (com a data pretendida, nos test drives) | `proposta de preço de 18 500 €` |
| `{{2}}` | O nome do cliente | `Maria Silva` |
| `{{3}}` | O telemóvel do cliente, ou «não indicado» | `+351 912 345 678` |
| `{{4}}` | O email do cliente | `maria.silva@exemplo.pt` |
| `{{5}}` | A viatura, ou «sem viatura associada» | `BMW 320d Touring` |
| `{{6}}` | A mensagem do cliente (até 300 caracteres, numa só linha), ou «sem mensagem» | `Gostava de ver a viatura no sábado de manhã.` |

## 2. `engineline_novidade` — viaturas

Usado quando uma viatura entra na oficina (incluindo as registadas pelo assistente do WhatsApp), é criada em Viaturas, sai da oficina, é publicada no site pela primeira vez, é reservada por um colega, fica outra vez disponível (reserva cancelada ou expirada), é vendida, ou muda de preço. E quando um contacto atribuído a alguém é dado como ganho ou perdido por um colega. Quando várias viaturas chegam de uma vez para a mesma pessoa (publicar em lote), vai uma mensagem só, com o número de viaturas.

Exemplos de `{{1}}`:

- `a mota Honda CB650R saiu da oficina e está pronta no stand`
- `viatura vendida, já não está disponível`
- `reserva de Maria Silva cancelada; a viatura voltou a estar disponível`
- `preço alterado de 18 900 € para 17 900 €`
- `o contacto de Maria Silva, atribuído a si, foi dado como perdido (motivo: comprou noutro stand)` — aqui, `{{2}}` é a viatura do contacto, ou «sem viatura associada».

O modelo anterior, `engineline_viatura`, tinha um link para o backoffice. Pode continuar na Meta; o site já não o usa.

- Nome: `engineline_novidade` (variável `WHATSAPP_TEMPLATE_VIATURA` para usar outro)
- Categoria: Utility · Idioma: `pt_PT`

Corpo:

```
Novidade nas viaturas do backoffice: {{1}}.

Viatura: {{2}}

Trate disto no backoffice quando puder.
```

Exemplos:

| Variável | O que é | Exemplo |
|---|---|---|
| `{{1}}` | O que aconteceu | `viatura publicada no site` |
| `{{2}}` | A viatura (e a matrícula, se houver) | `Honda CB500F · AA-00-BB` |

## 3. `engineline_testemunho_novo` — testemunhos por aprovar

Usado quando um visitante deixa um testemunho no site. Só aparece no site depois de alguém com o separador Testemunhos o aprovar.

O modelo anterior, `engineline_testemunho`, tinha um link. Pode continuar na Meta; o site já não o usa.

- Nome: `engineline_testemunho_novo` (variável `WHATSAPP_TEMPLATE_TESTEMUNHO` para usar outro)
- Categoria: Utility · Idioma: `pt_PT`

Corpo:

```
Chegou um testemunho novo pelo site, à espera de aprovação.

Autor: {{1}}
Classificação: {{2}} em 5

Aprove-o ou recuse-o no backoffice: só aparece no site depois de aprovado.
```

Exemplos:

| Variável | O que é | Exemplo |
|---|---|---|
| `{{1}}` | Quem escreveu | `João Pereira` |
| `{{2}}` | As estrelas, de 1 a 5 | `5` |

## 4. `engineline_aviso_geral` — avisos gerais

Usado para avisos sobre o próprio backoffice:

- o acesso ao WhatsApp dado pela Meta dura 60 dias e, quando expira, o WhatsApp todo pára (respostas do assistente e avisos). Uma semana antes, quem tem o separador Integrações recebe este aviso;
- férias: um pedido à espera de decisão (`Rita Costa pediu férias de 2 a 6 de dezembro (5 dias) e aguarda a sua decisão`), a decisão (`o seu pedido de férias de 2 a 6 de dezembro (5 dias) foi aprovado por Ana Lopes`) e um colega que vai de férias nos próximos 7 dias (`Rita Costa vai estar de férias de 2 a 6 de dezembro (5 dias)`).

O modelo anterior, `engineline_aviso`, tinha um link. Pode continuar na Meta; o site já não o usa.

- Nome: `engineline_aviso_geral` (variável `WHATSAPP_TEMPLATE_AVISO` para usar outro)
- Categoria: Utility · Idioma: `pt_PT`

Corpo:

```
Aviso do backoffice: {{1}}.

Trate disto no backoffice logo que possível.
```

Exemplos:

| Variável | O que é | Exemplo |
|---|---|---|
| `{{1}}` | O aviso | `o acesso ao WhatsApp dado pela Meta expira a 12/12/2026; volte a ligar o número em «Trocar de número»` |

## Mensagens aos clientes (alertas de stock e visitas)

Além dos avisos à equipa, o site pode escrever aos **clientes** que o pediram no formulário:

- **Alerta de stock** — quem criou um alerta («avisamos quando entrar») e marcou «Quero receber o aviso por WhatsApp» recebe o link quando é publicada uma viatura compatível (no máximo uma mensagem por dia; as outras seguem nos dias seguintes). A mensagem leva um link para cancelar o alerta.
- **Visita ao stand** — quem marcou visita na ficha da viatura e aceitou a confirmação por WhatsApp recebe-a quando a equipa confirma na **Agenda de visitas**, e um lembrete na véspera.

Liga-se em **Integrações → Visitas e mensagens aos clientes → Enviar mensagens automáticas aos clientes por WhatsApp**, depois de estes dois modelos estarem aprovados. Desligado, nada sai sozinho: a equipa vê na Agenda e no contacto o que há para avisar, com um botão que abre o WhatsApp dela com o texto já escrito.

A Meta decide a categoria de cada modelo ao aprová-lo (a confirmação de uma visita é normalmente **Utility**; o aviso de stock pode ser classificado como **Marketing**, que tem outro preço por mensagem). Submeta-os como Utility; se a Meta mudar a categoria, continuam a funcionar.

### 5. `engineline_alerta_stock` — viatura compatível com um alerta

- Nome: `engineline_alerta_stock` (variável `WHATSAPP_TEMPLATE_ALERTA` para usar outro)
- Idioma: `pt_PT`

Corpo:

```
Olá {{1}}! Entrou na {{2}} uma viatura compatível com o alerta que criou no nosso site:

{{3}}

Veja as fotos e os detalhes em {{4}}

Se já não está à procura, pode cancelar o alerta em {{5}} a qualquer momento.
```

Exemplos: `Maria` · `Supermotas` · `Yamaha MT-07 · 2021 · 12 000 km · 6 900 €` · `https://www.exemplo.pt/viaturas/yamaha-mt-07-2021` · `https://www.exemplo.pt/alertas/cancelar/3f2a9c1e`

### 6. `engineline_visita` — confirmação e lembrete da visita

- Nome: `engineline_visita` (variável `WHATSAPP_TEMPLATE_VISITA` para usar outro)
- Idioma: `pt_PT`

Corpo:

```
Olá {{1}}! A sua visita à {{2}} está marcada para {{3}}.

Viatura: {{4}}
Morada: {{5}}

Se precisar de mudar a hora, responda a esta mensagem.
```

Exemplos: `Maria` · `Supermotas` · `terça-feira, 21 de outubro, às 10:30` · `Yamaha MT-07 · 2021` · `Av. da Liberdade 100, 1250-096 Lisboa`

O link de cancelar o alerta é assinado com `ALERT_LINK_SECRET` (se não existir, usa a chave de serviço do Supabase). Não precisa de a definir; se a mudar, os links já enviados deixam de funcionar.

## Quem recebe o quê

Cada colaborador recebe um aviso se **todas** estas condições se cumprirem:

- tem telefone no perfil («O meu perfil»);
- tem acesso ao separador do aviso (os das férias são da área pessoal, que toda a gente tem);
- tem acesso ao tipo de viatura (carros/motas), quando o aviso é sobre uma viatura ou um contacto de um dos tipos;
- não desligou esse aviso em «O meu perfil → Avisos por WhatsApp» (os que vêm desligados por defeito têm de ser ligados lá);
- não foi ele próprio a fazer a ação.

| Aviso | Quem recebe | Por defeito | Modelo |
|---|---|---|---|
| Contacto do site (cada tipo de pedido) | Leads | ligado | `engineline_contacto` |
| Contacto atribuído | o responsável escolhido (Leads) — mesmo com os contactos novos desligados | ligado | `engineline_contacto` |
| Contacto ganho ou perdido por um colega | o responsável do contacto (Leads) | ligado | `engineline_novidade` |
| Viatura reservada por um colega | Leads | ligado | `engineline_novidade` |
| Viatura vendida | Leads | ligado | `engineline_novidade` |
| Reserva cancelada ou expirada | Leads | ligado | `engineline_novidade` |
| Testemunho por aprovar | Testemunhos | ligado | `engineline_testemunho_novo` |
| Viatura nova na oficina | Oficina | ligado | `engineline_novidade` |
| Viatura criada em Viaturas | Viaturas | ligado | `engineline_novidade` |
| Viatura sai da oficina (cada vez que sai) | Viaturas | ligado | `engineline_novidade` |
| Viatura publicada no site (a primeira vez) | Viaturas | ligado | `engineline_novidade` |
| Preço alterado numa viatura publicada ou reservada | Viaturas | **desligado** | `engineline_novidade` |
| Pedido de férias | quem pode decidir as férias dessa pessoa: o administrador; o chefe, para vendedores e mecânicos | ligado | `engineline_aviso_geral` |
| Pedido de férias aprovado ou recusado | quem pediu | ligado | `engineline_aviso_geral` |
| Colega vai de férias nos próximos 7 dias | toda a equipa, menos o próprio (só férias aprovadas; uma vez por período; enviado entre as 9h e as 20h) | ligado | `engineline_aviso_geral` |
| Acesso ao WhatsApp a expirar | Integrações | ligado | `engineline_aviso_geral` |

As condições voltam a ser verificadas no momento do envio: quem perdeu o acesso entretanto já não recebe, e um aviso que deixou de ser verdade (o pedido de férias já foi decidido, o contacto foi atribuído a outra pessoa, as férias foram desmarcadas) não sai. O mesmo acontecimento nunca chega duas vezes à mesma pessoa.

## Outras variáveis de ambiente

| Variável | Por defeito | Para quê |
|---|---|---|
| `WHATSAPP_TEMPLATE_LEAD` | `engineline_contacto` | Nome do modelo dos pedidos do site |
| `WHATSAPP_TEMPLATE_VIATURA` | `engineline_novidade` | Nome do modelo das viaturas |
| `WHATSAPP_TEMPLATE_TESTEMUNHO` | `engineline_testemunho_novo` | Nome do modelo dos testemunhos |
| `WHATSAPP_TEMPLATE_AVISO` | `engineline_aviso_geral` | Nome do modelo dos avisos gerais |
| `WHATSAPP_TEMPLATE_LANGUAGE` | `pt_PT` | Idioma em que os modelos foram aprovados |

O endereço dos links é o `NEXT_PUBLIC_SITE_URL` do site.

## Quando um envio falha

Em **Integrações → Avisos por WhatsApp → Últimos avisos** aparece cada aviso, a quem foi e o resultado. Quando a Meta recusa, aparece o motivo dela (por exemplo `(#132001) Template name does not exist in the translation` — o modelo não existe, não foi aprovado, ou tem outro nome/idioma).

- Erros passageiros repetem-se sozinhos, até 8 vezes.
- Erros que não se resolvem a repetir (modelo inexistente ou pausado, variáveis erradas, número sem WhatsApp) param logo e ficam à espera do administrador, com o botão **Voltar a tentar**.
- Se a Meta não responder a tempo, a mensagem **pode ter chegado**: não se repete sozinha, para não chegar duas vezes. Confirme com a pessoa e use **Voltar a tentar** se não chegou.
- Um aviso que fique mais de 24 horas sem poder ser enviado (por exemplo, sem número ligado) já não é novidade e não se envia.
