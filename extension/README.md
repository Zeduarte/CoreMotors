# CoreMotors Partilhas (extensão do Chrome)

Faz, no Chrome de cada utilizador e com a sessão do Facebook dele, as partilhas
comandadas pelo separador **Partilhas** do backoffice (`/admin/partilhas`).

## Instalar

1. No backoffice, em **Partilhas**, descarregue a extensão (o ZIP é gerado a
   partir desta pasta por `scripts/build-extension.mjs`) e descompacte-a numa
   pasta que não vá apagar. Em desenvolvimento pode usar esta pasta diretamente.
2. Abra `chrome://extensions`, ligue o **Modo de programador** e carregue em
   **Carregar sem compactação** → escolha a pasta.
3. Abra o separador Partilhas, clique no ícone da extensão e em
   **Autorizar este site**.

## Como funciona

- `bridge.js` corre nas páginas `/admin…` e passa as mensagens da página
  (`window.postMessage`) ao service worker.
- `background.js` só obedece a sites autorizados no popup, só abre endereços do
  Facebook e trabalha numa janela própria. Lê o id da conta do Facebook pelos
  cookies `c_user`/`i_user` (nunca a sessão).
- `fb-page.js` é injetado em cada página do Facebook: lê a lista de grupos
  (`/groups/joins/`) e faz «Partilhar → Grupo → pesquisar → Publicar».

O Facebook muda a interface sem aviso: quando um passo não é reconhecido, a
extensão pára e diz porquê. Limites de publicação, verificações e aprovações
dos administradores são sempre do utilizador; a extensão não os contorna.

Ao alterar a extensão, suba `version` em `manifest.json` e recarregue-a em
`chrome://extensions`.
