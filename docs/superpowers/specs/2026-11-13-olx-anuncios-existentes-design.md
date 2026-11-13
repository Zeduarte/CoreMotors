# Anúncios do OLX geridos no backoffice (opção C)

Data: 13/11/2026 · Estado: para aprovação

## Porquê

O stand quer que o backoffice tenha acesso a tudo o que está na conta do OLX e consiga geri-lo de lá,
incluindo anúncios que foram colocados diretamente na plataforma do OLX.

Hoje o backoffice só conhece os anúncios que ele próprio criou (`channel_listings`). Depois de ligar a
conta «Supermotas» (aplicação 201353), o painel mostra 0 anúncios ativos, enquanto a conta tem 11, e
mostra 3 anúncios (Fiat Punto, 2× Yamaha XT 1200Z) que são de outra conta do OLX — a ligação antiga
(aplicação 201290).

## O que se sabe (testado na API a 13/11/2026)

- `GET /adverts` devolve todos os anúncios da conta (11): os criados no OLX (`external_id` vazio) e os
  exportados do Standvirtual (`external_id` 8097…). Pagina com `offset` + `limit`; a resposta só tem
  `data` (sem metadados) — lê-se até vir uma página incompleta.
- `PUT /adverts/{id}` num anúncio criado no OLX (Grand Scenic, reenviado sem alterações): **aceite** (200).
- `PUT` num anúncio do Standvirtual (BMW 525 d): **recusado** (400, campo `user`: «Anúncio exportado do
  Standvirtual. Para alterá-lo, necessita de aceder à sua conta.»).
- `GET /adverts/{id}/statistics` funciona em todos, incluindo os do Standvirtual.
- Anúncios da conta antiga: `404 Advert not found`, ou «Não tem permissões para editar este anúncio».
- O OLX valida os campos antes das permissões: um `PUT` vazio não serve para saber se se pode editar.
- A categoria de cada anúncio de carro é a marca (ex.: 637 Mercedes-Benz, 603 Renault, 741 BMW, filhas
  de 378 Carros); a 1479 Opel é filha de 416 (comerciais).
- Correspondência hoje: os 6 ativos e o BMW 525 d (expirado) têm viatura no stock com a mesma marca,
  modelo e preço. Opel Combo, Citroën C3 Feel, Mercedes CLA 180 (expirados) e Renault Grand Scenic (por
  pagar) não têm viatura.

## Objetivos

1. Em Plataformas de anúncios → OLX, ver **todos** os anúncios da conta, com estado, link e
   estatísticas, lidos todos os dias e a pedido.
2. Associar cada anúncio à sua viatura, com sugestão automática e confirmação do administrador.
3. Gerir a 100% (texto, fotos, preço, ativar, desativar) os anúncios criados no OLX ou pelo site.
4. Anúncios do Standvirtual: só leitura, com a indicação «Gerido no Standvirtual».
5. Anúncios sem viatura: associar, criar a viatura a partir do anúncio, ativar, desativar.
6. Os anúncios de outra conta deixam de aparecer e de dar erro.

## Não-objetivos

- Ligação à API do Standvirtual: continua «Brevemente disponível» (projeto próprio quando houver
  credenciais).
- Comprar pacotes ou pagar destaques no OLX.
- Editar texto e fotos diretamente na lista: um anúncio edita-se pela ficha da viatura a que está
  associado.

## Anti-objetivos (falha mesmo que «funcione»)

- **Duplicar anúncios no OLX**: criar um anúncio para uma viatura que já tem um, de qualquer origem.
- **Mexer num anúncio sem o administrador pedir**: p. ex. associar um anúncio e a sincronização
  desativá-lo porque a viatura não tem OLX marcado.
- Perder as visualizações e quem segue os anúncios atuais.
- Expor tokens ou dados da conta para além do que o painel já mostra.

## Abordagens consideradas

- **A. Tudo passa a ser viatura do stock** — cada anúncio é associado ou importado como viatura. Uma só
  fonte de verdade, mas obriga a criar fichas de carros já vendidos só para os gerir no OLX.
- **B. Gestor de anúncios à parte** — uma página que espelha o OLX, independente do stock. Simples, mas
  o preço passa a viver em dois sítios e diverge da ficha.
- **C. Misto (escolhida)** — todos os anúncios numa lista; os associados gerem-se pela ficha (como os
  que o site cria), os outros têm ações na lista. Fica com a fonte única de A sem obrigar a importar
  carros vendidos.

## Desenho

### Dados — migração 0051 `olx_adverts`

Espelho dos anúncios da conta ligada. Uma linha por anúncio do OLX.

| coluna | tipo | notas |
|---|---|---|
| `id` | bigint PK | id do anúncio no OLX |
| `car_id` | uuid null, **unique**, FK `cars` on delete set null | viatura associada |
| `origin` | text check (`site`, `olx`, `standvirtual`) | ver regras abaixo |
| `status` | text | estado do OLX (`active`, `limited`, `outdated`, …) |
| `title`, `url`, `external_id` | text | |
| `price` | numeric | |
| `category_id` | bigint | |
| `category_name` | text | nome da categoria (é a marca nos carros); usado nas sugestões e na importação |
| `valid_to`, `olx_created_at` | timestamptz | |
| `views`, `phone_views`, `observers` | int ≥ 0 | |
| `stats_at`, `seen_at`, `updated_at` | timestamptz | `seen_at` = última leitura em que apareceu |

RLS ativa sem políticas e `revoke all` a `anon`/`authenticated`, como `olx_connection`: o painel lê
pelo cliente de serviço. Linha nova em `VERIFICAR_migracoes.sql` e no teste das migrações.

`channel_listings` continua a ser o motor da sincronização por viatura; `olx_adverts` é o que existe no
OLX.

**Origem**
- `external_id` igual ao id de uma viatura do site → `site` (e `car_id` = essa viatura).
- `external_id` vazio → `olx`.
- outro `external_id` → `standvirtual`. Se um `PUT` alguma vez devolver a mensagem «exportado do
  Standvirtual», a origem fica `standvirtual` de vez.

### Ler anúncios do OLX — `importAdverts(db)`

1. `GET /adverts` página a página até ao fim. Se alguma página falhar, pára sem apagar nem limpar nada.
2. Upsert em `olx_adverts` (estado, título, preço, URL, `external_id`, categoria, validade, origem,
   `seen_at`). Não mexe em `car_id` já definido.
3. Linhas que não vieram na leitura completa são apagadas (o anúncio já não existe nesta conta).
4. **Limpar a conta antiga**: um `channel_listings` do OLX cujo `external_id` não veio na lista e cujo
   `GET /adverts/{id}` não devolve 200 → fica sem `external_id`/URL/estado/estatísticas, `status`
   `pending`, `sync_state` `idle`, e o aviso «O anúncio anterior não está na conta do OLX ligada (era de
   outra conta ou foi apagado). Grave a viatura para o publicar nesta conta.» Não volta a publicar
   sozinho.
5. Estatísticas de cada anúncio em `olx_adverts` (todos, incluindo Standvirtual), copiadas também para
   o `channel_listings` da viatura associada, para a ficha continuar a mostrá-las.

Corre:
- todos os dias no `/api/maintenance`, no lugar do atual `refreshStats`;
- com o botão **«Ler anúncios do OLX»** (substitui «Atualizar estatísticas»);
- logo a seguir a ligar a conta (só a lista, sem estatísticas, para o retorno do OLX ser rápido). Se a
  conta ligada for outra (`olx_user_id` diferente do anterior), `olx_adverts` é esvaziada primeiro.

### Sugestões de associação — `suggestCar(advert, cars)` (função pura)

Para um anúncio sem viatura, candidatas = viaturas ainda sem anúncio associado, cuja marca canónica é o
nome da categoria do anúncio ou aparece no título, e cujas palavras do modelo aparecem no título.
- Uma só candidata com o mesmo preço → sugestão forte.
- Uma só candidata pela marca + modelo → sugestão (preço diferente assinalado).
- Várias ou nenhuma → sem sugestão; escolhe-se da lista.

Com os dados de hoje sugere os 7 esperados.

### Associar e desassociar

`linkOlxAdvert(advertId, carId)` (separador «Plataformas de anúncios» + acesso ao tipo da viatura):
- recusa se a viatura ou o anúncio já estiverem associados (a viatura conta como associada se tiver
  linha em `olx_adverts` ou um `external_id` em `channel_listings` que exista em `olx_adverts`);
- grava `olx_adverts.car_id`;
- se a viatura tem OLX marcado e o anúncio é `olx`/`site`, marca para sincronizar. Antes, o painel
  confirma: «A partir de agora o anúncio passa a ter o texto, as fotos e o preço da ficha.»
- **Não marca OLX na viatura sozinho.** Associar só liga as duas coisas; o backoffice passa a mandar
  no anúncio quando a viatura estiver publicada com OLX marcado.

«Confirmar todas as sugestões» associa de uma vez as sugestões fortes.

`unlinkOlxAdvert(advertId)`: tira a associação e, se o anúncio era gerido pelo site, limpa o
`external_id` do `channel_listings` e desmarca OLX na viatura, para a sincronização não criar um
anúncio novo nem desativar o antigo. O anúncio no OLX fica como está.

### Sincronização (`syncListing`) — regras novas

Antes de decidir a ação, se o `channel_listings` não tem `external_id`:
- há um anúncio `olx`/`site` associado à viatura → **adota-o** (`external_id` = esse anúncio) e segue
  como atualização;
- há um anúncio `standvirtual` associado → **não faz nada** (`sync_state` `idle`, nota «Gerido no
  Standvirtual»);
- não há associado, mas `suggestCar` dá uma **sugestão forte** (marca, modelo e preço iguais) para esta
  viatura num anúncio por associar → **não cria**; erro «Já existe no OLX um anúncio que parece ser
  desta viatura («título»). Associe-o, ou desative-o, em Plataformas de anúncios.» Só a sugestão forte
  bloqueia, para uma sugestão errada nunca impedir uma publicação.

Com `external_id`, se o anúncio for `standvirtual` → não envia nada (nunca `PUT` nem comandos).

### Ações na lista (anúncios `olx`/`site`)

- **Ativar** (`command: activate`) e **Desativar** (`command: deactivate`, `is_success: false`), com
  confirmação. Ao ativar, aviso de que o OLX pode cobrar; o erro do OLX aparece tal como vem (ex.:
  pacote pago).
- Só para anúncios sem viatura, ou com viatura sem OLX marcado. Quando o anúncio é gerido pela ficha,
  a lista diz «Gere-se na ficha» — senão a sincronização desfazia a ação (um desativado com a viatura
  publicada é reativado).
- Anúncios do Standvirtual: sem botões, só «Gerido no Standvirtual».

### Criar viatura a partir do anúncio

Para anúncios sem viatura (qualquer origem). Exige os separadores «Plataformas de anúncios» e
«Viaturas» e que o tipo seja um dos que o site vende (Definições → Tipo de site), como o «+ Nova
viatura». Tipo: mota se a categoria descende de 379 (Motociclos), carro nos outros casos (comerciais
incluídos). Cria uma viatura **em rascunho**, já associada, com:
- marca = nome da categoria (ou primeira palavra do título); modelo do atributo `modelo` (rótulo) ou do
  título;
- ano, mês de matrícula, km, combustível, caixa, potência, cilindrada, lugares, portas e carroçaria a
  partir dos atributos do OLX, mapeados para os valores do site (pelo mesmo mapa usado ao publicar,
  ao contrário); os atributos também ficam em `olx_attributes`;
- preço e descrição do anúncio;
- fotos copiadas do CDN do OLX (só `https://*.olxcdn.com`) para `car-media/{carId}/…`, até 30, cada uma
  ≤ 5 MB, sem recomprimir (o OLX já as serve em JPEG de 1000×700; a compressão da ficha corre no browser).

Rascunho e sem OLX marcado: não aparece no site e a sincronização não lhe toca. Depois de revista,
publica-se e marca-se OLX; a sincronização adota o anúncio.

### Painel (Plataformas de anúncios → OLX)

A tabela «Estatísticas dos anúncios» passa a «Anúncios no OLX»:

```
Anúncios no OLX · lidos às 06:00            [Ler anúncios do OLX] [Confirmar 7 sugestões]
Visualizações 401 · Viram o telefone 10 · A seguir 9

Anúncio                      Origem        Estado     Vis. Tel. Seg.  Viatura
Mercedes-Benz A 180 d … ↗    Standvirtual  ativo        76    0    7  Sugestão: Mercedes-Benz A 180 d · 21 900 €  [Associar]
BMW 116 d Pack M ↗           Standvirtual  ativo       171    0    1  BMW 116d Pack M  (Desassociar)
Renault Grand Scenic ↗       OLX           por pagar     0    0    0  [Escolher viatura ▾] [Criar viatura] [Ativar]
```

- Ordenação: por associar primeiro, depois por visualizações.
- «Anúncios com problemas» continua (vem de `channel_listings`).
- **Ficha da viatura** (bloco OLX): com anúncio do Standvirtual associado mostra o estado, o link e as
  estatísticas, com «Este anúncio vem do Standvirtual: altera-se lá». Com anúncio OLX associado mas sem
  OLX marcado: «Marque OLX para o backoffice passar a gerir este anúncio.»

### Testes

- `suggestCar` com os 11 anúncios e as viaturas de hoje (7 sugestões, nenhuma errada).
- Origem a partir do `external_id`.
- `syncListing`: adota o anúncio associado; não toca nos do Standvirtual; não cria com sugestão por
  associar; continua a criar quando não há nada.
- `importAdverts`: página incompleta termina a leitura; falha a meio não apaga nem limpa; anúncio da
  conta antiga só é limpo quando o `GET` individual não dá 200; conta diferente esvazia a tabela.
- Ações: permissões (separador e tipo da viatura), recusa de dupla associação, desassociar desmarca OLX.
- Criar viatura: mapeamento dos atributos do Grand Scenic; só aceita fotos do CDN do OLX.
- Migração: tabela sem acesso de `anon`/`authenticated`.

## Decidido por mim (podes mudar)

- Tabela nova em vez de alargar `channel_listings`: esta exige `car_id` e um anúncio por viatura, e os
  anúncios sem viatura não cabem lá.
- Sugestões confirmadas por uma pessoa, nunca associação automática.
- Associar não marca OLX na viatura.
- Viatura criada a partir do anúncio fica em rascunho.
- Anúncios de outra conta: limpos sem republicar sozinho.
- Só a sugestão forte impede criar um anúncio novo.
- «Criar viatura» exige também o separador «Viaturas» e um tipo que o site venda; comerciais entram
  como carro.

## Para quem construir

- Nomes dos ficheiros e componentes, textos finais dos botões e confirmações.
- Mapa inverso dos atributos do OLX para os campos do site (o direto está em `src/lib/olx/attributes.ts`).
- Ritmo dos pedidos ao OLX na leitura (hoje são 11 anúncios; prever centenas sem estourar o tempo da
  função do Netlify — p. ex. estatísticas em lotes pela manutenção).
