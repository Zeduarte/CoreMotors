# Funcionalidades públicas e pontos de venda

## Ativação

1. Aplicar `supabase/migrations/0018_showroom.sql` depois das migrações anteriores, no projeto Supabase correspondente. A migração acrescenta campos opcionais; anúncios existentes continuam como automóveis e sem mês de matrícula inventado.
2. Em **Admin → Página inicial**, editar pontos de venda reais, FAQs e páginas de serviços. Publicar apenas serviços efetivamente prestados. A página Oficina está inicialmente desativada.
3. No editor da viatura, selecionar automóvel/motociclo, categoria, mês da matrícula (opcional), ponto de venda e preço anterior (opcional). Os identificadores dos pontos são estáveis: reatribuir viaturas antes de os alterar/remover.
4. Para Google: ativar Places API (New) no Google Cloud, configurar faturação, restrições da chave e quotas. Definir `GOOGLE_PLACES_API_KEY` apenas no servidor; indicar Place ID e/ou ligação do perfil no editor. `SUPABASE_SERVICE_ROLE_KEY` e a migração dos limites de submissão já existentes são necessários para limitar pedidos. Não usar prefixo NEXT_PUBLIC para estas chaves.

## Comportamento

- Inventário: limites inclusivos de ano, quilómetros e preço; localização; tipo de veículo; apenas campanhas. Preço sob consulta fica fora de filtros numéricos de preço e campanhas.
- Preço anterior riscado apenas quando superior ao preço atual e o preço não é sob consulta.
- Contactos e ficha da viatura apresentam os pontos configurados; nomes são resolvidos pelo identificador, incluindo após renomear.
- Serviços desativados não aparecem na navegação das páginas de serviços nem no sitemap, e devolvem 404.
- FAQs são editáveis por categoria/página. Textos de serviços são texto simples, sem HTML executável.
- Google só é consultado após clique do visitante. Sem configuração/resposta válida, mantém-se a ligação ao perfil; não se inventam classificações. Não são armazenadas avaliações. São apresentados autores, ligações, atribuições e ordem por relevância do Google.
- Pedidos Google limitados pelo mecanismo persistente de submissões: 100 por 10 minutos globalmente e 10 por IP quando o cabeçalho de ingresso de confiança está configurado. Configurar também quotas no Google Cloud.
- Formulários públicos exigem confirmação da leitura da política no browser e no servidor. Não equivale a consentimento de marketing. Nos contactos é registada a versão/data da confirmação nos detalhes do pedido; testemunhos continuam sujeitos a aprovação.

## Verificação

Executar `npm ci`, `npm test`, `npm run lint`, `npm run typecheck` e `npm run build` com ambiente de teste. Os testes PostgreSQL locais usam PGlite, incluindo migrações, permissões, categorias de motociclos, matrícula e integridade de pontos de venda. Nenhuma migração é aplicada automaticamente pelo build.

A ativação na produção e testes com Google real exigem configuração do alojamento e dados reais do stand. Não colocar credenciais no repositório.

### Validação desta alteração

- 31 testes automatizados aprovados; TypeScript e ESLint sem erros.
- Build de produção concluído com dados de teste locais.
- 11 verificações HTTP aprovadas: inventário, serviços, financiamento, encomendas, oficina desativada (404), contactos, detalhe de automóvel e mota, ficha imprimível, sitemap e Google sem configuração.
- A verificação visual interativa não foi concluída: o navegador deste ambiente bloqueou o acesso ao servidor local. Não foram testadas credenciais Google reais nem aplicadas migrações no Supabase remoto.

## Escolha inicial de carro ou mota

- Ao criar um anúncio, é obrigatório escolher **Carro** ou **Mota** antes de preencher os dados. Ao editar, o tipo guardado fica selecionado.
- O tipo continua na coluna `cars.vehicle_type` (`car` / `motorcycle`), introduzida na migração 0018. Não são necessárias tabelas separadas nem uma nova migração.
- Mudar o tipo limpa marca, modelo e versão e adapta categoria, portas e lugares. Os restantes campos preenchidos são preservados.
- O site é um só para carros e motas. O que o stand vende escolhe-se em Definições → **Tipo de site** (só carros, carros e motas, ou só motas).
- Com os dois tipos, o inventário apresenta **Todos / Carros / Motas**, com URLs `/inventario?tipo=carros` e `/inventario?tipo=motas`. A filtragem é feita no browser sobre o stock dos tipos que o site vende; as opções dos filtros (marcas, categorias, campos do OLX) seguem o tipo escolhido, e mudar de tipo limpa a marca, o modelo e a categoria.
- «Limpar» volta a **Todos** (num site de um só tipo, a esse tipo).

Validação desta separação: 36 testes automatizados, incluindo criação/edição e filtragem no servidor; teste de interação DOM para escolher mota, enviar o formulário e trocar para carro; quatro verificações HTTP do stock completo, carros, motas e parâmetro desconhecido. Build, TypeScript e ESLint aprovados. A migração 0018 continua a ser necessária no ambiente de destino.
