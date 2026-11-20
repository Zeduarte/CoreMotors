# Fotos no Cloudflare R2

As fotos e vídeos das viaturas passam do Supabase Storage para o Cloudflare R2.
No R2 o tráfego das fotos não tem custo, e deixa de contar para o limite que
bloqueou o Supabase («cached egress»). O Supabase fica só com os dados.

Nada se apaga: as fotos são **copiadas**, e os originais ficam no Supabase.
Os caminhos guardados na base de dados não mudam.

Tempo total: cerca de 20 minutos.

## 1. Criar o bucket no Cloudflare

O domínio `supermotas.com` já está na Cloudflare, por isso é tudo na mesma conta.

1. Cloudflare → **R2 Object Storage** → **Create bucket**.
   - Nome: `supermotas-fotos`
   - Localização: **Automatic** (ou Europa)
2. No bucket → **Settings** → **Custom Domains** → **Connect Domain** →
   `fotos.supermotas.com` → **Connect**. A Cloudflare cria o registo DNS sozinha.

## 2. Permitir carregar fotos a partir do backoffice (CORS)

No bucket → **Settings** → **CORS Policy** → **Add CORS policy**, e cole:

```json
[
  {
    "AllowedOrigins": ["https://supermotas.com", "https://www.supermotas.com"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

## 3. Criar a chave de acesso

1. R2 → **Manage API Tokens** (ou «API» → «Manage API tokens») → **Create API Token**.
2. Permissões: **Object Read & Write**. Bucket: só `supermotas-fotos`.
3. **Create**. Copie o **Access Key ID** e o **Secret Access Key**. A Cloudflare
   só mostra o segredo uma vez.
4. Copie também o **Account ID**, que aparece na página do R2.

## 4. Pôr as variáveis no Netlify

Netlify → o site → **Site configuration** → **Environment variables** → **Add a variable**:

| Variável | Valor |
| --- | --- |
| `R2_ACCOUNT_ID` | o Account ID |
| `R2_ACCESS_KEY_ID` | o Access Key ID |
| `R2_SECRET_ACCESS_KEY` | o Secret Access Key |
| `R2_BUCKET` | `supermotas-fotos` |
| `NEXT_PUBLIC_MEDIA_URL` | `https://fotos.supermotas.com` |

Depois: **Deploys** → **Trigger deploy** → **Deploy site**, e espere que acabe.

Nesta fase o site continua a usar o Supabase: ainda não muda nada.

## 5. Testar e copiar (no backoffice)

Entre com o acesso core → **Gestão** → secção **Fotos**:

1. **Testar ligação**: todos os pontos devem ficar com ✓. Se algum falhar, a
   mensagem diz o que corrigir.
2. **Copiar N ficheiros**: copia as fotos do Supabase para o R2. Deixe a página
   aberta até acabar. Se algumas falharem, carregue outra vez: só copia as que faltam.

## 6. Ligar o R2

Netlify → **Environment variables** → acrescente:

| Variável | Valor |
| --- | --- |
| `NEXT_PUBLIC_MEDIA_STORAGE` | `r2` |

**Trigger deploy** outra vez. Quando acabar, volte a **Gestão → Fotos** e
carregue em **Copiar** mais uma vez. Isso apanha as fotos que tenham entrado
entre o passo 5 e agora.

A partir daqui, o site, o backoffice, o OLX e os catálogos usam as fotos do R2,
e as fotos novas vão direto para lá.

## 7. Voltar ao plano gratuito do Supabase (opcional)

Espere uns dias com o site a funcionar. Confirme no Supabase (**Usage**) que o
«Cached Egress» quase deixou de subir. Depois pode voltar ao plano Free
(Organization → Billing).

As fotos antigas que ficam no Supabase (cerca de 420 MB) cabem no limite gratuito
de 1 GB e servem de cópia de segurança.

## Voltar atrás

Apague a variável `NEXT_PUBLIC_MEDIA_STORAGE` no Netlify e faça um novo deploy.
O site volta a usar as fotos do Supabase.

Atenção: as fotos carregadas enquanto o R2 esteve ligado ficaram só no R2.
