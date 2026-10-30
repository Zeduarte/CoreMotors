# Ativação da versão operacional

Implementação na branch `codex/engineLine`. Não foi aplicada qualquer migração à base remota nem efetuado deployment.

## Funcionalidades

- Permissões por secção na base de dados e nas ações; promoção do próprio perfil bloqueada; criação de staff apenas pelo servidor.
- Contactos pesquisáveis com filtros, paginação de 50, exportação completa em streaming, responsável, próxima ação, histórico e motivo de perda.
- Reserva pública como pedido, sem promessa de disponibilidade nem cobrança. Confirmação pelo staff, prazo até 30 dias, registo manual do sinal, cancelamento e expiração.
- Conclusão transacional de venda: contacto ganho, viatura vendida, reserva concluída e preço efetivo registado juntos.
- Área financeira privada, aquisição, custos discriminados, margens operacionais e envelhecimento de stock.
- Oficina com registos de horas termináveis, cálculo na BD, viaturas de entrada com características desconhecidas e tarefas de preparação/entrega.
- Histórico de alterações gerado na BD, sem permissões de edição para utilizadores normais.
- Contadores analíticos agregados antes dos limites da API e ações prioritárias no dashboard.
- Submissões públicas apenas pelo servidor com limites persistentes. Notificações numa fila com timeout, repetição e estado visível.

## Sequência de ativação

1. Fazer snapshot/backup e aplicar primeiro numa base de staging com uma cópia dos dados. Não usar a produção para testes de permissões.
2. Garantir que as migrações `0001` a `0012` estão aplicadas. Aplicar `supabase/migrations/0013_operations.sql` uma única vez. É transacional; se falhar, não confirmar parcialmente.
3. Configurar no servidor `SUPABASE_SERVICE_ROLE_KEY` (obrigatória também para formulários públicos), `MAINTENANCE_SECRET` (segredo aleatório longo) e o URL canónico. Nunca usar prefixo `NEXT_PUBLIC_` para segredos.
4. Configurar `TRUSTED_CLIENT_IP_HEADER` apenas se o proxy o substituir de forma garantida; em Netlify, verificar a configuração antes de usar `x-nf-client-connection-ip`. Sem este header mantêm-se limites globais e por identidade.
5. Configurar o webhook nas Integrações. Para domínios diferentes da lista predefinida, acrescentar o hostname exato a `NOTIFICATION_WEBHOOK_HOSTS` no servidor. Só HTTPS, sem redirects ou credenciais no URL.
6. Publicar a aplicação junto com a migração. As versões antiga e nova têm contratos de escrita pública diferentes: coordenar a janela de ativação. O backoffice apresenta um aviso enquanto não deteta a migração.
7. No Netlify, verificar a função `operations-maintenance`: executa a cada minuto na publicação de produção. Nas previews da branch não é agendada automaticamente. Pode usar `Run now` na consola do Netlify ou os botões nas Integrações.
8. Noutro alojamento, configurar uma chamada POST por minuto para `/api/maintenance`, com `Authorization: Bearer <MAINTENANCE_SECRET>`. Não colocar o segredo no URL.
9. Fazer os testes funcionais abaixo com contas de staging. Só depois ativar para a equipa.

A função agendada segue a [documentação oficial de Scheduled Functions do Netlify](https://docs.netlify.com/build/functions/scheduled-functions/). A expiração torna-se visível no processamento seguinte, normalmente até um minuto depois do prazo. Se o processamento estiver parado, uma reserva expirada permanece conservadoramente bloqueada até ser libertada.

## Utilizadores

Os utilizadores existentes mantêm os perfis. Após a migração, criar um utilizador no Auth não lhe dá acesso ao backoffice automaticamente. O ecrã Utilizadores cria o Auth e o perfil explicitamente, com a chave de serviço e validação de hierarquia. Se o perfil falhar, tenta remover a conta Auth recém-criada.

Para o primeiro administrador de uma base nova, criar a conta no painel Auth e inserir o perfil explicitamente pelo SQL Editor:

```sql
insert into public.profiles (id,email,full_name,role)
select id,email,'Administrador','admin' from auth.users
where email = 'EMAIL_DO_ADMINISTRADOR'
on conflict(id) do update set role = 'admin';
```

Apenas executar para o email confirmado do administrador. Metadados de registo nunca conferem privilégios. Alterações de papéis por API pública são bloqueadas; o ecrã de gestão usa exclusivamente o servidor autorizado.

## Validação

`npm test` corre PostgreSQL embebido (PGlite) com todas as migrações, roles e RLS, helpers de negócio e renderização dos novos ecrãs com dados fictícios. As tabelas Auth/Storage são simuladas para testar o contrato SQL; isto não substitui o teste do serviço Supabase/Storage real em staging.

Validar em staging:

- Anónimo: leitura pública; inserção direta de leads, visitas e testemunhos recusada; formulários via servidor funcionam.
- Mecânico: oficina permitida, contactos e custos privados recusados mesmo pela API. Entrada de viatura não inventa ano, caixa ou combustível.
- Vendedor: acompanhamento e reservas; dados financeiros recusados salvo concessão explícita de secção.
- Administrador: atribuição de acessos, custos, vendas e notificações.
- Duas reservas para a mesma viatura: só uma ativa. Venda para outro contacto bloqueada enquanto houver reserva.
- Venda: data, preço, estado da viatura e contacto atualizados juntos. Falha de qualquer etapa faz rollback.
- Contactos acima de 200 e visitas acima de 1000: paginação, exportação e totais completos.
- Registo aberto de horas: terminar, incluindo passagem pela meia-noite.
- Webhook indisponível: submissão permanece guardada; próxima tentativa e erro visíveis.
- Reservas expiradas: função agendada liberta a viatura; o backoffice permite processamento manual.

## Limites explícitos

- Não há cobrança online: o sinal é confirmado manualmente depois de recebido. Não integrar chaves Stripe até existir um fluxo de pagamentos completo.
- OLX, Standvirtual e restantes portais: os feeds existem, mas a importação real continua dependente da especificação e validação da conta profissional. A interface assinala “Por validar no portal”; não existe publicação remota automática confirmada.
- A margem apresentada é operacional e depende dos custos lançados. Não substitui contabilidade nem calcula impostos.
- O histórico começa na aplicação desta migração; não reconstrói alterações anteriores. Mostra os últimos 30 eventos por ficha; a BD conserva os restantes.
- Entrega do webhook é “pelo menos uma vez”: um timeout depois de o destino receber pode causar repetição. O envio inclui `Idempotency-Key`; o destino tem de a respeitar para deduplicar.
- Há até 8 tentativas automáticas. As integrações mostram falhas que exigem intervenção. A fila processa até 3 notificações por execução, para respeitar o tempo de execução.
- Os dados de aquisição existentes precisam de ser preenchidos: ausência aparece como “—”, nunca como custo zero ou margem fictícia.

## Voltar a correr migrações

Cada migração aplica-se **uma vez**, por ordem. Não voltar a correr uma migração antiga sozinha:

- `0013`, `0018`, `0019` e `0020` criam objetos sem `if not exists` (políticas, colunas, restrições, funções): uma segunda execução falha logo no início e, por ser transacional, não altera nada — mas também não "repara" nada.
- `0021` corre sem erro, mas repõe as regras de férias dessa altura (por cima da `0022`/`0041`/`0046`): um chefe voltaria a poder aprovar outro chefe. Se for corrida por engano, voltar a correr, por ordem, `0022`, `0041` e `0046`.
- As migrações novas (como a `0046`) são escritas para poderem ser corridas mais de uma vez sem mudar o resultado.
