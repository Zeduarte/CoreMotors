# Copiar a base de dados para outra conta Supabase

Faz uma cópia completa do projeto Supabase atual (tabelas, utilizadores do
backoffice e fotos) para um projeto **novo e vazio**, por exemplo noutra conta.

- O projeto atual **só é lido**: nada muda nele e o site continua a usá-lo.
- Não precisa de instalar nada: a cópia corre no GitHub, ao carregar num botão.
- Demora uns 10 a 20 minutos (a maior parte são as fotos).

## O que vai na cópia

| | |
|---|---|
| Tabelas (viaturas, contactos, oficina, financeiro, …) | ✅ |
| Utilizadores do backoffice, com as mesmas palavras-passe | ✅ |
| Fotos e vídeos (buckets `car-media` e `wa-media`) | ✅ |
| Definições do painel do Supabase (Auth → URL Configuration, SMTP, modelos de email) | ❌ só são precisas se um dia o site passar a usar a cópia |
| Chaves da API | ❌ o projeto novo tem as suas |

Se as fotos já estão no Cloudflare R2, as que foram carregadas depois disso só
existem no R2 e não vão nesta cópia (o R2 não é tocado).

## 1. Criar o projeto novo

Na outra conta, em [supabase.com](https://supabase.com/dashboard):
**New project**, de preferência na mesma região do atual.

Na palavra-passe da base de dados use **só letras e números** (sem `@`, `#`,
`/`, …): vai dentro de um endereço e esses símbolos estragam-no. Guarde-a.

O plano gratuito chega: 500 MB de base e 1 GB de ficheiros. Um projeto
gratuito sem uso é pausado ao fim de uma semana; os dados ficam guardados e
volta a ligar-se no painel (**Restore project**).

## 2. Ir buscar 4 valores

Para **cada** projeto (o atual e o novo):

**a) Endereço da base de dados**: no topo do projeto, botão **Connect** →
**Session pooler** → copie o URI e troque `[YOUR-PASSWORD]` pela palavra-passe
da base. Fica assim:

```
postgresql://postgres.abcdefghijklmnopqrst:APalavraPasse@aws-0-eu-west-3.pooler.supabase.com:5432/postgres
```

Tem de ser o **Session pooler** (o GitHub não consegue usar a «Direct connection»).

Se não souber a palavra-passe da base atual: **Project Settings → Database →
Reset database password**. Não afeta o site, que usa as chaves da API e não
esta palavra-passe.

**b) Chave secreta**: **Project Settings → API Keys** → a **secret key**
(`sb_secret_…`) ou, nos projetos mais antigos, a `service_role`. A do projeto
atual é a mesma que está no Netlify em `SUPABASE_SERVICE_ROLE_KEY`.

## 3. Guardar os valores no GitHub

No repositório: **Settings → Secrets and variables → Actions → New repository
secret**, um de cada vez:

| Nome do segredo | Valor |
|---|---|
| `SUPABASE_ORIGEM_DB_URL` | endereço da base do projeto **atual** |
| `SUPABASE_ORIGEM_SECRET_KEY` | chave secreta do projeto **atual** |
| `SUPABASE_DESTINO_DB_URL` | endereço da base do projeto **novo** |
| `SUPABASE_DESTINO_SECRET_KEY` | chave secreta do projeto **novo** |

Os segredos ficam encriptados e nunca aparecem nos registos. Não os cole em
conversas, emails ou ficheiros.

## 4. Correr a cópia

1. **Actions** → **Copiar base de dados** → **Run workflow**.
2. Em «Escreva COPIAR para confirmar», escreva `COPIAR`.
3. Deixe «base e fotos» e carregue em **Run workflow**.

No fim, a página da execução mostra um resumo: cada tabela com o número de
linhas na origem e na cópia, e quantas fotos foram copiadas.

- Pequenas diferenças em tabelas de filas, notificações ou contadores são
  normais: o site continuou a funcionar enquanto a cópia corria.
- Se só as fotos falharem, corra outra vez com «apenas as fotos»: a base não é
  copiada de novo e as fotos são gravadas por cima.

### Proteções

- Só copia para um projeto **vazio**. Se os segredos estiverem trocados (ou a
  cópia já tiver sido feita), para logo no início, sem mexer em nada.
- A importação é feita de uma só vez: se algo falhar a meio, o projeto novo
  fica vazio como estava.

## Fazer uma cópia nova mais tarde

A cópia é uma fotografia do momento em que correu. Para a atualizar, apague o
projeto novo (**Project Settings → General → Delete project**), crie outro,
atualize os dois segredos `SUPABASE_DESTINO_*` e corra de novo.

Para ter cópias de segurança todos os dias, sem fazer nada à mão, o passo
seguinte é uma cópia automática diária para um bucket privado (por exemplo no
Cloudflare R2).
