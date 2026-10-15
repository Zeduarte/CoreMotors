import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "./ActionForm";
import { retryNotifications,expireReservationsNow,requeueNotification } from "@/lib/actions/operations";
import {
  requeueWhatsAppNotification,
  saveWhatsAppNotificationSettings,
  sendWhatsAppTestNotification,
} from "@/lib/actions/notifications";
import { notificationEvent, type TemplateFamily } from "@/lib/notification-events";
import { NOTIFICATION_TEMPLATES, templateLanguage, templateName } from "@/lib/whatsapp/send-template";

const lisboa = (iso: string) => new Date(iso).toLocaleString("pt-PT", { timeZone: "Europe/Lisbon" });

type Aviso = {
  id: string; event: string | null; recipient_id: string | null; attempts: number; last_error: string | null;
  created_at: string; delivered_at: string | null; cancelled_at: string | null; claimed_at: string | null;
};

/**
 * Em que estado está um aviso, para quem não conhece a fila. O motivo é o que a
 * Meta respondeu (ou porque não se enviou); o token nunca chega a estas linhas.
 */
function estado(j: Aviso): { text: string; tone: string; retry: boolean } {
  if (j.delivered_at) return { text: "Enviado", tone: "text-emerald-300", retry: false };
  if (j.cancelled_at) return { text: `Não enviado — ${j.last_error ?? "cancelado"}`, tone: "text-paper/50", retry: false };
  if (j.attempts >= 8) return { text: `Falhou — ${j.last_error ?? "sem motivo"}`, tone: "text-red-300", retry: true };
  if (j.claimed_at) {
    // Pode ter chegado: não se repete sozinho, decide o administrador.
    if (j.last_error) return { text: `Por confirmar — ${j.last_error}`, tone: "text-amber-300", retry: true };
    const parado = Date.now() - new Date(j.claimed_at).getTime() > 10 * 60_000;
    return parado
      ? { text: "Por confirmar — o envio não terminou; veja se chegou antes de repetir", tone: "text-amber-300", retry: true }
      : { text: "A enviar…", tone: "text-paper/60", retry: false };
  }
  if (j.last_error) return { text: `A repetir — ${j.last_error}`, tone: "text-amber-300", retry: false };
  return { text: "Na fila", tone: "text-paper/60", retry: false };
}

export async function NotificationStatus() {
 const db=await createClient();
 const webhookColumns="id,attempts,last_error,created_at,next_attempt_at";
 let webhook=await db.from("notification_jobs").select(webhookColumns).eq("channel","webhook").is("delivered_at",null).order("created_at").limit(30);
 // Sem a migração 0036 ainda não há canais: a lista é a de sempre.
 if(webhook.error)webhook=await db.from("notification_jobs").select(webhookColumns).is("delivered_at",null).order("created_at").limit(30);
 const {data:jobs,error}=webhook;

 const [{data:settings,error:settingsError},{data:avisos},{data:pessoas}]=await Promise.all([
  db.from("notification_settings").select("whatsapp_enabled").eq("id",1).maybeSingle(),
  db.from("notification_jobs").select("id,event,recipient_id,attempts,last_error,created_at,delivered_at,cancelled_at,claimed_at").eq("channel","whatsapp").order("created_at",{ascending:false}).limit(25),
  db.from("profiles").select("id,full_name"),
 ]);
 const nome=new Map((pessoas??[]).map(p=>[p.id,p.full_name?.trim()||"Sem nome"]));
 const familias=Object.keys(NOTIFICATION_TEMPLATES) as TemplateFamily[];

 return <>
 <section className="card space-y-5 p-5">
  <div>
   <h2 className="text-lg font-semibold">Avisos por WhatsApp</h2>
   <p className="mt-1 text-sm text-paper/60">Quando entra algo novo no backoffice — um contacto do site, uma proposta, uma reserva, um testemunho por aprovar, uma viatura nova — cada colaborador com telefone no perfil recebe uma mensagem sobre o que é da sua área e do tipo de viatura a que tem acesso. Cada um escolhe os avisos em «O meu perfil».</p>
  </div>
  {settingsError?<p className="text-sm text-amber-300">Falta aplicar a migração 0036_whatsapp_notifications.sql.</p>:<>
  <ActionForm action={saveWhatsAppNotificationSettings} className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
   <label className="flex items-start gap-2 text-sm text-paper">
    <input type="checkbox" name="whatsapp_enabled" defaultChecked={!!settings?.whatsapp_enabled} className="mt-0.5 h-4 w-4 shrink-0 accent-accent"/>
    <span>Enviar avisos por WhatsApp à equipa{settings?.whatsapp_enabled?" (ligado)":" (desligado)"}</span>
   </label>
   <p className="text-xs text-paper/50">Ligue só depois de a Meta aprovar os quatro modelos abaixo — antes disso, cada aviso seria recusado. Desligado, nada fica na fila.</p>
  </ActionForm>

  <div className="space-y-3">
   <h3 className="text-sm font-semibold uppercase tracking-wider text-paper/50">Modelos a aprovar na Meta</h3>
   <p className="text-xs text-paper/50">A Meta só deixa a empresa iniciar conversas com modelos aprovados. Crie-os no WhatsApp Manager da conta do número ligado acima: categoria <em>Utility</em>, idioma <code>{templateLanguage()}</code>, com o nome e o texto exatos (as instruções completas estão em <code>docs/WHATSAPP_TEMPLATES.md</code>).</p>
   <ul className="space-y-3">{familias.map(f=><li key={f} className="rounded-lg border border-white/10 p-3 text-xs">
    <p className="font-semibold text-accent">{templateName(f)}</p>
    <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-paper/70">{NOTIFICATION_TEMPLATES[f].body}</pre>
   </li>)}</ul>
   <ActionForm action={sendWhatsAppTestNotification} label="Enviar teste para o meu telefone" success="Teste enviado: veja o seu WhatsApp." className="space-y-2">
    <p className="text-xs text-paper/50">Envia os quatro modelos, com valores de exemplo, para o telefone do seu perfil — mesmo com os avisos desligados. Se a Meta recusar algum, o motivo aparece aqui.</p>
   </ActionForm>
  </div>

  <div>
   <h3 className="text-sm font-semibold uppercase tracking-wider text-paper/50">Últimos avisos</h3>
   {!avisos?.length?<p className="mt-2 text-sm text-paper/60">Ainda não foi enviado nenhum aviso.</p>:
   <ul className="mt-3 space-y-2 text-sm">{avisos.map(a=>{const s=estado(a);return <li key={a.id} className="border-b border-white/10 pb-2">
    <span className="text-paper/50">{lisboa(a.created_at)} · {a.recipient_id?nome.get(a.recipient_id)??"Colaborador removido":"—"}</span>
    <span className="block text-paper/80">{(a.event&&notificationEvent(a.event)?.label)??a.event}</span>
    <span className={`block ${s.tone}`}>{s.text}</span>
    {s.retry&&<ActionForm action={requeueWhatsAppNotification} label="Voltar a tentar" success="Aviso de volta à fila." className="mt-2"><input type="hidden" name="id" value={a.id}/></ActionForm>}
   </li>;})}</ul>}
  </div>
  </>}
 </section>

 <section className="card space-y-4 p-5"><h2 className="text-lg font-semibold">Notificações e reservas</h2><p className="text-sm text-paper/60">Os envios pendentes (webhook e WhatsApp) são repetidos pelo processamento periódico. As reservas são libertadas quando termina o prazo.</p>
 {error?<p role="alert">Não foi possível carregar as notificações.</p>:<ul className="space-y-2 text-sm">{jobs?.map(j=><li key={j.id}>{j.attempts>=8?"Requer atenção":j.last_error?"A repetir":"Pendente"} · {j.attempts} tentativas{j.last_error&&` · ${j.last_error}`}{j.attempts>=8&&<ActionForm action={requeueNotification} label="Voltar a tentar" className="mt-2"><input type="hidden" name="id" value={j.id}/></ActionForm>}</li>)}</ul>}
 <div className="flex flex-wrap gap-3"><ActionForm action={retryNotifications} label="Processar notificações" className=""/><ActionForm action={expireReservationsNow} label="Libertar reservas expiradas" className=""/></div>
 </section>
 </>;
}
