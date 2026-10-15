import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { effectiveSections } from "@/lib/permissions";
import { embeddedSignup } from "@/lib/whatsapp/account";
import { WhatsAppConnect } from "./WhatsAppConnect";
import { WhatsAppSimulator } from "./WhatsAppSimulator";

/**
 * Estado do canal de ordens por WhatsApp, a ligação do número, e o simulador.
 *
 * O simulador não é um extra: é a forma de ver isto a funcionar sem depender do
 * número da Meta, que leva dias a aprovar. Corre o mesmo código do webhook.
 */
export async function WhatsAppPanel({ baseUrl }: { baseUrl: string }) {
  // Da app da Meta, não do número: são precisas qualquer que seja o número.
  const variaveis = [
    ["WHATSAPP_VERIFY_TOKEN", !!process.env.WHATSAPP_VERIFY_TOKEN],
    ["WHATSAPP_APP_SECRET", !!process.env.WHATSAPP_APP_SECRET],
    ["ANTHROPIC_API_KEY", !!process.env.ANTHROPIC_API_KEY],
  ] as const;
  const signup = embeddedSignup();
  const numeroNasVariaveis = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();

  // Quem pode usar o assistente: qualquer colaborador com telefone no perfil
  // pode consultar; registar exige Oficina ou Custos e margens.
  const db = await createClient();
  const { data: perfis } = await db
    .from("profiles")
    .select("id,full_name,role,phone,allowed_sections")
    .order("full_name");
  const ligados = (perfis ?? [])
    .map((p) => ({
      nome: p.full_name?.trim() || "Sem nome",
      telefone: p.phone?.trim() ?? "",
      secoes: effectiveSections(p.role, p.allowed_sections).filter(
        (s) => s === "oficina" || s === "financeiro",
      ),
    }));

  // As últimas ordens, para diagnóstico. A tabela é de servidor, por isso é o
  // cliente de serviço que a lê.
  const admin = createAdminClient();
  const [{ data: ultimas }, { data: ligacao }] = admin
    ? await Promise.all([
        admin
          .from("wa_messages")
          .select("wam_id,from_phone,received_at,processed_at,reply_sent_at,last_error")
          .order("received_at", { ascending: false })
          .limit(10),
        // Nunca o token: só o que é seguro mostrar.
        admin
          .from("whatsapp_connection")
          .select("display_phone_number,verified_name,phone_number_id,register_warning,connected_at,connected_by,token_expires_at")
          .eq("id", 1)
          .maybeSingle(),
      ])
    : [{ data: null }, { data: null }];
  const ligadoPor = ligacao?.connected_by
    ? perfis?.find((p) => p.id === ligacao.connected_by)?.full_name?.trim()
    : null;
  // O acesso dado pela Meta dura 60 dias: avisa-se nas duas últimas semanas.
  const expira = ligacao?.token_expires_at ? new Date(ligacao.token_expires_at) : null;
  const diasAteExpirar = expira ? Math.ceil((expira.getTime() - Date.now()) / 86_400_000) : null;

  const faltam = [
    ...(ligacao || numeroNasVariaveis ? [] : ["número da empresa"]),
    // O número das variáveis sem o token recebe mensagens mas não responde.
    ...(!ligacao && numeroNasVariaveis && !process.env.WHATSAPP_ACCESS_TOKEN?.trim()
      ? ["WHATSAPP_ACCESS_TOKEN"]
      : []),
    ...variaveis.filter(([, presente]) => !presente).map(([nome]) => nome),
  ];

  return (
    <section className="card space-y-5 p-5">
      <div>
        <h2 className="text-lg font-semibold text-paper">Ordens por WhatsApp</h2>
        <p className="mt-1 text-sm text-paper/60">
          Um colaborador manda uma mensagem — «coloca uma despesa de 450 de
          embraiagem ao bmw 320» — e o registo é feito na Oficina ou em Custos e
          margens, com as permissões dele. Confirma sempre antes de gravar.
        </p>
      </div>

      {/* Estado da ligação */}
      <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <p className="text-sm font-medium text-paper">
          {faltam.length === 0 ? "Ligação configurada." : `Falta: ${faltam.join(", ")}.`}
        </p>

        {/* O número da empresa */}
        <div className="text-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-paper/50">
            Número da empresa
          </p>
          {ligacao ? (
            <div className="mt-1 space-y-1 text-paper/80">
              <p>
                <strong className="text-paper">
                  {ligacao.display_phone_number ?? `ID ${ligacao.phone_number_id}`}
                </strong>
                {ligacao.verified_name ? ` · ${ligacao.verified_name}` : ""}
              </p>
              <p className="text-xs text-paper/50">
                Ligado no backoffice a {new Date(ligacao.connected_at).toLocaleString("pt-PT")}
                {ligadoPor ? ` por ${ligadoPor}` : ""}.
              </p>
              {expira && diasAteExpirar !== null && (
                <p
                  className={`text-xs ${
                    diasAteExpirar <= 0
                      ? "text-red-300"
                      : diasAteExpirar <= 14
                        ? "text-amber-300"
                        : "text-paper/50"
                  }`}
                >
                  {diasAteExpirar <= 0
                    ? "O acesso dado pela Meta expirou: as respostas deixaram de sair. Carregue em «Trocar de número» e escolha o mesmo número."
                    : `O acesso dado pela Meta vale até ${expira.toLocaleDateString("pt-PT")}${
                        diasAteExpirar <= 14
                          ? ` (${diasAteExpirar} ${diasAteExpirar === 1 ? "dia" : "dias"}). Volte a ligar o número antes disso, em «Trocar de número».`
                          : "."
                      }`}
                </p>
              )}
              {ligacao.register_warning && (
                <p className="text-xs text-amber-300">{ligacao.register_warning}</p>
              )}
            </div>
          ) : numeroNasVariaveis ? (
            <p className="mt-1 text-paper/70">
              Definido nas variáveis do Netlify (ID {numeroNasVariaveis}).
              {signup ? " Pode passar a ligá-lo aqui: o número ligado aqui passa à frente das variáveis." : ""}
            </p>
          ) : (
            <p className="mt-1 text-amber-300">Nenhum número ligado.</p>
          )}
          <div className="mt-3">
            <WhatsAppConnect signup={signup} connected={!!ligacao} />
          </div>
          {!signup && (
            <p className="mt-2 text-xs text-paper/50">
              Para ligar o número aqui, sem copiar tokens para o Netlify, crie as variáveis{" "}
              <code>WHATSAPP_APP_ID</code> e <code>WHATSAPP_CONFIG_ID</code> (o ID da app da Meta e
              o da configuração do Embedded Signup), além das duas abaixo, e faça um novo deploy.
            </p>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-paper/50">
            Variáveis da app da Meta
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {variaveis.map(([nome, presente]) => (
              <li key={nome} className={presente ? "text-paper/70" : "text-amber-300"}>
                {presente ? "✓" : "—"} {nome}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-paper/50">
            Endereço a colar no painel da Meta (campo <em>messages</em>):
          </p>
          <code className="mt-1 block break-all rounded-lg bg-black/40 px-3 py-2 text-xs text-accent">
            {baseUrl}/api/whatsapp
          </code>
          <p className="mt-2 text-xs text-paper/50">
            O simulador abaixo funciona sem nada disto — só precisa da
            ANTHROPIC_API_KEY.
          </p>
        </div>
      </div>

      {/* Quem pode dar ordens */}
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-paper/50">
          Quem pode usar o assistente
        </h3>
        <p className="mt-1 text-xs text-paper/50">
          É o telefone do perfil que identifica a pessoa. Com telefone, qualquer
          colaborador pode consultar dados; registar despesas, horas ou viaturas
          exige Oficina ou Custos e margens. Sem telefone, as mensagens dela são
          ignoradas.
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          {ligados.length === 0 && (
            <li className="text-paper/50">
              Ainda não há colaboradores.
            </li>
          )}
          {ligados.map((p) => (
            <li
              key={p.nome + p.telefone}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 py-2"
            >
              <span className="text-paper">{p.nome}</span>
              <span className="text-paper/60">
                {p.secoes.length
                  ? `Consulta + ${p.secoes.map((s) => (s === "oficina" ? "Oficina" : "Custos")).join(" + ")}`
                  : "Só consulta"}
                {" · "}
                {p.telefone ? (
                  p.telefone
                ) : (
                  <span className="text-amber-300">telefone em falta</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <WhatsAppSimulator />

      {/* Histórico. Mostra-se sempre: "nada chegou" também é um diagnóstico —
          quer dizer que a Meta não está a entregar, ou que o App Secret está
          errado (esses pedidos são recusados antes de se gravar o que quer que
          seja, e só aparecem nos logs do Netlify). */}
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-paper/50">
          Últimas mensagens recebidas
        </h3>
        {!ultimas || ultimas.length === 0 ? (
          <div className="mt-2 space-y-1 text-sm text-paper/60">
            <p>Ainda não chegou nenhuma mensagem do WhatsApp.</p>
            <p className="text-xs text-paper/50">
              Se já enviou uma: confirme na Meta que o campo <em>messages</em>{" "}
              está subscrito no webhook, e experimente o botão <em>Test</em>{" "}
              ao lado dele. Se mesmo assim nada aparecer aqui, veja os logs das
              funções no Netlify e procure «api/whatsapp» — um App Secret
              errado só aparece lá.
            </p>
          </div>
        ) : (
          <ul className="mt-3 space-y-2 text-sm text-paper/70">
            {ultimas.map((m) => (
              <li key={m.wam_id} className="border-b border-white/10 pb-2">
                <span className="text-paper/50">
                  {new Date(m.received_at).toLocaleString("pt-PT")} · {m.from_phone}
                </span>
                <span className="block">
                  {m.last_error ? (
                    <span className="text-red-300">{m.last_error}</span>
                  ) : m.reply_sent_at ? (
                    <span className="text-emerald-300">respondida</span>
                  ) : m.processed_at ? (
                    "processada, sem resposta enviada"
                  ) : (
                    "recebida, ainda a processar"
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
