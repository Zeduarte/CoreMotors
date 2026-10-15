import { canonicalBrand } from "@/lib/brand-name";
import { COST_LABELS } from "@/lib/operations";
import { formatPlate } from "@/lib/plate";
import type { PendingAction } from "@/lib/whatsapp/actions";

/**
 * As frases que o colaborador lê — e o formulário da imagem que as acompanha.
 *
 * UMA função para a pergunta e para o recibo, com o tempo verbal como
 * parâmetro: assim a confirmação e o recibo não podem discordar entre si. Se
 * fossem duas funções, um dia uma mudava e a outra não, e a pessoa confirmava
 * uma coisa e recebia a confirmação de outra. A imagem (`previewCard`) sai dos
 * MESMOS valores, aqui ao lado, pela mesma razão.
 *
 * Nada disto é escrito pelo modelo. O texto é gerado a partir dos valores já
 * validados, por isso o valor que a pessoa lê é forçosamente o valor que fica
 * gravado.
 */

/**
 * Euros com cêntimos quando existem.
 *
 * Não se usa o `formatPrice` de `src/lib/format.ts` porque esse arredonda
 * (`maximumFractionDigits: 0`) — bom para o preço de um anúncio, mas num recibo
 * de despesa 450,50 € não pode aparecer como "451 €".
 */
export function formatMoney(value: number): string {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** "2026-09-24" → "24/09/2026". */
export function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Quilómetros como no backoffice: "120 000 km". */
export function formatKm(value: number): string {
  return `${value.toLocaleString("pt-PT")} km`;
}

/** Preço de anúncio: `null` é «sob consulta». */
function priceText(value: number | null): string {
  return value === null ? "sob consulta" : formatMoney(value);
}

/** Um texto longo, numa linha e cortado — para referir, não para gravar. */
export function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/**
 * Como referir uma viatura numa frase: sempre com a matrícula, quando existe.
 *
 * A marca sai na grafia do catálogo: anúncios antigos foram gravados como
 * "Bmw", e o recibo não deve repetir o erro de quem os escreveu.
 */
export function vehicleLabel(v: {
  make: string;
  model: string;
  license_plate?: string | null;
}): string {
  const nome = `${canonicalBrand(v.make)} ${v.model}`.trim();
  return v.license_plate
    ? `${nome}, matrícula ${formatPlate(v.license_plate)}`
    : nome;
}

/** O estado da viatura como aparece no backoffice (StatusBadge). */
export const CAR_STATUS_LABEL: Record<string, string> = {
  workshop: "Na oficina",
  draft: "Rascunho",
  prepared: "Preparado",
  published: "Publicado",
  reserved: "Reservado",
  sold: "Vendido",
};

/** O estado do contacto como aparece na ficha do contacto, no backoffice. */
export const LEAD_STATUS_LABEL: Record<string, string> = {
  new: "Novo",
  contacted: "Em contacto",
  proposal: "Proposta",
  won: "Venda concluída",
  lost: "Perdido",
  closed: "Fechado",
};

/** Os tipos de «Registar contacto» do backoffice. */
export const NOTE_LABEL: Record<string, string> = {
  note: "Nota",
  call: "Chamada",
  message: "Mensagem",
  proposal: "Proposta",
  visit: "Visita / test drive",
};

const TIPO_LABEL: Record<string, string> = { car: "Carro", motorcycle: "Mota" };

function carTitle(a: Extract<PendingAction, { kind: "create_draft_car" }>): string {
  return [a.marca, a.modelo, a.versao].filter(Boolean).join(" ");
}

export type Tense = "futuro" | "passado";

/** A frase da acção, no tempo pedido. */
export function describeAction(action: PendingAction, tense: Tense): string {
  const futuro = tense === "futuro";
  switch (action.kind) {
    case "register_vehicle":
      return futuro
        ? `Vai ser registada na oficina a viatura ${action.nome}, matrícula ${formatPlate(action.matricula)}.`
        : `Registada na oficina a viatura ${action.nome}, matrícula ${formatPlate(action.matricula)}.`;
    case "add_cost": {
      const cat = COST_LABELS[action.categoria] ?? action.categoria;
      const fim = `${action.veiculo}, no valor de ${formatMoney(action.valor)} — ${action.descricao} (${cat}, ${formatDay(action.data)}).`;
      return futuro
        ? `Vai ser adicionada uma despesa ao ${fim}`
        : `Foi adicionada uma despesa ao ${fim}`;
    }
    case "log_hours": {
      const nota = action.descricao ? ` — ${action.descricao}` : "";
      const fim = `${action.veiculo}: ${action.inicio} às ${action.fim}, ${action.horas.toLocaleString("pt-PT")} h, em ${formatDay(action.data)}${nota}.`;
      return futuro ? `Vão ser registadas horas no ${fim}` : `Registadas horas no ${fim}`;
    }
    case "create_draft_car": {
      const qual = action.tipo === "motorcycle" ? "a mota" : "a viatura";
      const detalhes = [
        formatKm(action.km),
        action.combustivel,
        action.caixa,
        action.segmento,
        action.preco === null ? "preço sob consulta" : formatMoney(action.preco),
        action.matricula ? `matrícula ${formatPlate(action.matricula)}` : "",
        action.cor ? `cor ${action.cor}` : "",
      ].filter(Boolean);
      const fim = `${qual} ${carTitle(action)} (${action.ano}): ${detalhes.join(", ")}. Fica em rascunho: não aparece no site até ser publicada.`;
      return futuro ? `Vai ser criada em rascunho ${fim}` : `Criada em rascunho ${fim}`;
    }
    case "update_car": {
      const { novo, antes } = action;
      const partes: string[] = [];
      if (novo.preco !== undefined)
        partes.push(`preço ${priceText(novo.preco)} (era ${priceText(antes.preco)})`);
      if (novo.km !== undefined) partes.push(`${formatKm(novo.km)} (eram ${formatKm(antes.km)})`);
      if (novo.tagline !== undefined) partes.push(`frase de destaque «${novo.tagline}»`);
      if (novo.descricao !== undefined) partes.push(`descrição «${novo.descricao}»`);
      const fim = `a viatura ${action.veiculo}: ${partes.join("; ")}.`;
      return futuro ? `Vai ser alterada ${fim}` : `Alterada ${fim}`;
    }
    case "set_car_status": {
      const de = CAR_STATUS_LABEL[action.de] ?? action.de;
      const para = CAR_STATUS_LABEL[action.para] ?? action.para;
      const site = action.para === "published" ? " Fica visível no site." : " Deixa de aparecer no site.";
      return futuro
        ? `A viatura ${action.veiculo} vai passar de «${de}» a «${para}».${site}`
        : `A viatura ${action.veiculo} passou de «${de}» a «${para}».${site}`;
    }
    case "set_lead_status": {
      const de = LEAD_STATUS_LABEL[action.de] ?? action.de;
      const para = LEAD_STATUS_LABEL[action.para] ?? action.para;
      const motivo = action.motivo ? ` — motivo: ${action.motivo}` : "";
      return futuro
        ? `O contacto ${action.contacto} vai passar de «${de}» a «${para}»${motivo}.`
        : `O contacto ${action.contacto} passou de «${de}» a «${para}»${motivo}.`;
    }
    case "assign_lead":
      return futuro
        ? `O contacto ${action.contacto} vai ficar com ${action.responsavel} como responsável (antes: ${action.antes}).`
        : `O contacto ${action.contacto} ficou com ${action.responsavel} como responsável (antes: ${action.antes}).`;
    case "add_lead_note": {
      const tipo = (NOTE_LABEL[action.tipo] ?? "Nota").toLowerCase();
      const fim = `uma ${tipo} no contacto ${action.contacto}: «${action.texto}».`;
      return futuro ? `Vai ser registada ${fim}` : `Registada ${fim}`;
    }
    case "set_testimonial": {
      const qual = `o testemunho de ${action.autor} (${action.classificacao}/5): «${action.excerto}».`;
      if (action.publicar)
        return futuro ? `Vai ser aprovado e publicado no site ${qual}` : `Aprovado e publicado no site ${qual}`;
      return futuro ? `Vai ser retirado do site ${qual}` : `Retirado do site ${qual}`;
    }
    case "add_car_media":
      return describePhotos(action, futuro);
  }
}

/** «Vão ser juntadas 4 fotografias à viatura BMW 320, matrícula 33-AD-22.» */
function describePhotos(action: Extract<PendingAction, { kind: "add_car_media" }>, futuro: boolean): string {
  const n = action.fotos.length;
  const uma = n === 1;
  const fotos = uma ? "1 fotografia" : `${n} fotografias`;
  const verbo = futuro ? (uma ? "Vai ser juntada" : "Vão ser juntadas") : uma ? "Juntada" : "Juntadas";
  const capa = !action.ficha.semCapa
    ? ""
    : futuro
      ? uma ? " Passa a ser a capa." : " A primeira passa a ser a capa."
      : uma ? " Ficou como capa." : " A primeira ficou como capa.";
  const site =
    action.ficha.estado !== "published"
      ? ""
      : futuro
        ? " A viatura está publicada: aparecem logo no site."
        : " Já aparecem no site.";
  return `${verbo} ${fotos} à viatura ${action.veiculo}.${capa}${site}`;
}

/** A pergunta que fecha cada proposta (texto e legenda da imagem). */
export const CONFIRM_QUESTION = "Confirmar? Responda sim ou não.";

/** A pergunta completa, com o pedido de confirmação. */
export function confirmationMessage(action: PendingAction): string {
  return `${describeAction(action, "futuro")}\n\n${CONFIRM_QUESTION}`;
}

/** O recibo. */
export function receiptMessage(action: PendingAction): string {
  return describeAction(action, "passado");
}

// ---------------------------------------------------------------------------
// A imagem: o formulário do backoffice preenchido
// ---------------------------------------------------------------------------

export interface PreviewField {
  label: string;
  /** O valor que vai ficar gravado. */
  value: string;
  /** O valor gravado hoje, quando a proposta é uma alteração. */
  before?: string;
}

export interface PreviewCard {
  /** "Viaturas · editar viatura" — o separador e o formulário. */
  title: string;
  /** De que registo se trata (a viatura, o contacto…). */
  subject: string;
  fields: PreviewField[];
  /**
   * Miniaturas das fotografias a juntar (`data:image/jpeg;base64,…`). Só as
   * propostas de fotografias as têm, e é a rota da imagem que as preenche.
   */
  photos?: string[];
}

/**
 * Os campos da imagem de confirmação, tal como aparecem no formulário do
 * backoffice. Só rótulos e valores legíveis: nenhum identificador interno
 * (`carId`, `leadId`…) entra aqui, porque a imagem sai para o telemóvel.
 */
export function previewCard(action: PendingAction): PreviewCard {
  switch (action.kind) {
    case "register_vehicle":
      return {
        title: "Oficina · registar viatura",
        subject: action.nome,
        fields: [
          { label: "Viatura", value: action.nome },
          { label: "Matrícula", value: formatPlate(action.matricula) },
          { label: "Tipo", value: TIPO_LABEL[action.tipo] ?? action.tipo },
          { label: "Estado", value: CAR_STATUS_LABEL.workshop! },
        ],
      };
    case "add_cost":
      return {
        title: "Custos e margens · nova despesa",
        subject: action.veiculo,
        fields: [
          { label: "Categoria", value: COST_LABELS[action.categoria] ?? action.categoria },
          { label: "Valor", value: formatMoney(action.valor) },
          { label: "Data", value: formatDay(action.data) },
          { label: "Descrição", value: action.descricao },
        ],
      };
    case "log_hours":
      return {
        title: "Oficina · registo de horas",
        subject: action.veiculo,
        fields: [
          { label: "Data", value: formatDay(action.data) },
          { label: "Início", value: action.inicio },
          { label: "Fim", value: action.fim },
          { label: "Horas", value: `${action.horas.toLocaleString("pt-PT")} h` },
          ...(action.descricao ? [{ label: "Trabalho realizado", value: action.descricao }] : []),
        ],
      };
    case "create_draft_car":
      return {
        title: "Viaturas · nova viatura",
        subject: `${carTitle(action)} (${action.ano})`,
        fields: [
          { label: "Tipo", value: TIPO_LABEL[action.tipo] ?? action.tipo },
          { label: "Estado", value: CAR_STATUS_LABEL.draft! },
          { label: "Marca", value: action.marca },
          { label: "Modelo", value: action.modelo },
          ...(action.versao ? [{ label: "Versão", value: action.versao }] : []),
          { label: "Ano", value: String(action.ano) },
          { label: "Quilómetros", value: formatKm(action.km) },
          { label: "Combustível", value: action.combustivel },
          { label: "Caixa", value: action.caixa },
          { label: "Segmento", value: action.segmento },
          { label: "Preço", value: action.preco === null ? "Sob consulta" : formatMoney(action.preco) },
          ...(action.matricula ? [{ label: "Matrícula", value: formatPlate(action.matricula) }] : []),
          ...(action.cor ? [{ label: "Cor", value: action.cor }] : []),
          { label: "Portas", value: String(action.portas) },
          { label: "Lugares", value: String(action.lugares) },
        ],
      };
    case "update_car": {
      const { novo, antes } = action;
      const fields: PreviewField[] = [];
      if (novo.preco !== undefined)
        fields.push({ label: "Preço", value: priceText(novo.preco), before: priceText(antes.preco) });
      if (novo.km !== undefined)
        fields.push({ label: "Quilómetros", value: formatKm(novo.km), before: formatKm(antes.km) });
      if (novo.tagline !== undefined)
        fields.push({ label: "Frase de destaque", value: novo.tagline, before: antes.tagline || "—" });
      if (novo.descricao !== undefined)
        fields.push({ label: "Descrição", value: novo.descricao, before: antes.descricao || "—" });
      return { title: "Viaturas · editar viatura", subject: action.veiculo, fields };
    }
    case "set_car_status":
      return {
        title: "Viaturas · estado",
        subject: action.veiculo,
        fields: [
          {
            label: "Estado",
            value: CAR_STATUS_LABEL[action.para] ?? action.para,
            before: CAR_STATUS_LABEL[action.de] ?? action.de,
          },
        ],
      };
    case "set_lead_status":
      return {
        title: "Leads · acompanhamento comercial",
        subject: action.contacto,
        fields: [
          {
            label: "Estado",
            value: LEAD_STATUS_LABEL[action.para] ?? action.para,
            before: LEAD_STATUS_LABEL[action.de] ?? action.de,
          },
          ...(action.motivo ? [{ label: "Motivo de perda", value: action.motivo }] : []),
        ],
      };
    case "assign_lead":
      return {
        title: "Leads · acompanhamento comercial",
        subject: action.contacto,
        fields: [{ label: "Responsável", value: action.responsavel, before: action.antes }],
      };
    case "add_lead_note":
      return {
        title: "Leads · registar contacto",
        subject: action.contacto,
        fields: [
          { label: "Tipo", value: NOTE_LABEL[action.tipo] ?? action.tipo },
          { label: "Resumo", value: action.texto },
        ],
      };
    case "set_testimonial":
      return {
        title: action.publicar ? "Testemunhos · aprovar" : "Testemunhos · rejeitar",
        subject: action.autor,
        fields: [
          { label: "Nome", value: action.autor },
          { label: "Classificação", value: `${action.classificacao}/5` },
          { label: "Testemunho", value: action.excerto },
          {
            label: "Publicado no site",
            value: action.publicar ? "Sim" : "Não",
            before: action.publicar ? "Não" : "Sim",
          },
        ],
      };
    case "add_car_media": {
      // Como os outros cartões de viatura: título, matrícula, ano e preço,
      // para a pessoa ver que é a viatura certa antes de dizer «sim».
      const f = action.ficha;
      return {
        title: "Viaturas · fotografias",
        subject: action.veiculo,
        fields: [
          { label: "Viatura", value: f.titulo },
          ...(f.matricula ? [{ label: "Matrícula", value: formatPlate(f.matricula) }] : []),
          ...(f.ano ? [{ label: "Ano", value: String(f.ano) }] : []),
          { label: "Preço", value: f.preco === null ? "Sob consulta" : formatMoney(f.preco) },
          { label: "Estado", value: CAR_STATUS_LABEL[f.estado] ?? f.estado },
          { label: "Fotografias novas", value: String(action.fotos.length) },
          { label: "Já na galeria", value: String(f.existentes) },
          ...(f.semCapa ? [{ label: "Capa", value: "A primeira destas" }] : []),
        ],
      };
    }
  }
}
