-- 0049 · Só o administrador muda o «Tipo de site» e as etiquetas dos cards
--
-- O tipo de site (só carros / carros e motas / só motas) e as etiquetas dos
-- cards ficam em `site_content` (chaves `site` e `badges`). No site só o
-- administrador os grava, mas a política da tabela (0013) deixa escrever a
-- quem tem o separador «Página inicial» — por exemplo um chefe podia, pela API,
-- esconder todos os carros do site. Esta migração junta uma regra restritiva:
-- essas duas chaves só as escreve (cria, muda ou apaga) um administrador.
-- Os textos da página inicial (`home`, …) continuam com o separador.
--
-- Idempotente: pode correr-se mais de uma vez. Aplicar no Supabase → SQL Editor.

begin;

drop policy if exists "content: admin-only keys insert" on public.site_content;
create policy "content: admin-only keys insert" on public.site_content
  as restrictive for insert to authenticated
  with check (key not in ('site', 'badges') or public.is_admin());

drop policy if exists "content: admin-only keys update" on public.site_content;
create policy "content: admin-only keys update" on public.site_content
  as restrictive for update to authenticated
  using (key not in ('site', 'badges') or public.is_admin())
  with check (key not in ('site', 'badges') or public.is_admin());

drop policy if exists "content: admin-only keys delete" on public.site_content;
create policy "content: admin-only keys delete" on public.site_content
  as restrictive for delete to authenticated
  using (key not in ('site', 'badges') or public.is_admin());

commit;
