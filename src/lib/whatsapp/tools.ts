import type Anthropic from "@anthropic-ai/sdk";
import {
  AssignLeadInput,
  CAR_STATUS_TARGETS,
  COST_CATEGORIES,
  CarStatusInput,
  CostInput,
  CreateCarInput,
  HoursInput,
  LEAD_STATUS_TARGETS,
  LeadNoteInput,
  LeadStatusInput,
  MAX_TEXT,
  NOTE_KINDS,
  RegisterInput,
  TestimonialInput,
  UpdateCarInput,
} from "@/lib/whatsapp/actions";
import { BODY_TYPES, FUEL_TYPES, TRANSMISSIONS } from "@/lib/schemas";

/**
 * As ferramentas do assistente interno, em duas classes — e a classe vê-se no
 * nome, de propósito:
 *
 *   procurar_* / resumo_* / consultar_*  → LEITURA. São executadas de verdade.
 *   propor_*                             → PROPOSTA. Não escrevem nada. Terminam o ciclo.
 *
 * O modelo resolve e propõe; quem escreve é o nosso código, depois do «sim» da
 * pessoa. Por isso um erro de interpretação, ou uma mensagem que tente
 * manipulá-lo, não consegue por si alterar nada.
 *
 * Os registos são identificados por identificadores curtos — V1 (viaturas), C1
 * (contactos), T1 (testemunhos), P1 (colaboradores) — e nunca pelo id da base
 * de dados: um identificador que não venha de uma procura feita nesta mensagem
 * é rejeitado, e é isso que impede o modelo de inventar um registo.
 *
 * Não há nenhuma ferramenta de apagar, nem de propor apagar: o que se apaga,
 * apaga-se no backoffice.
 */

export const TOOL = {
  search: "procurar_viatura",
  summary: "resumo_viatura",
  query: "consultar_dados",
  searchLead: "procurar_contacto",
  searchTestimonial: "procurar_testemunho",
  searchStaff: "procurar_colaborador",
  register: "propor_registo_viatura",
  cost: "propor_despesa",
  hours: "propor_horas",
  createCar: "propor_viatura_rascunho",
  updateCar: "propor_editar_viatura",
  carStatus: "propor_estado_viatura",
  leadStatus: "propor_estado_contacto",
  assignLead: "propor_responsavel_contacto",
  leadNote: "propor_nota_contacto",
  testimonial: "propor_testemunho",
  photos: "propor_fotos_viatura",
} as const;

/** Uma ferramenta de proposta foi chamada → o ciclo pára aqui. */
export const PROPOSAL_TOOLS: readonly string[] = [
  TOOL.register,
  TOOL.cost,
  TOOL.hours,
  TOOL.createCar,
  TOOL.updateCar,
  TOOL.carStatus,
  TOOL.leadStatus,
  TOOL.assignLead,
  TOOL.leadNote,
  TOOL.testimonial,
];

const viaturaProp = {
  type: "string" as const,
  description: "Identificador devolvido por procurar_viatura, ex.: V1.",
};
const contactoProp = {
  type: "string" as const,
  description: "Identificador devolvido por procurar_contacto, ex.: C1.",
};

export const WA_TOOLS: Anthropic.Tool[] = [
  {
    name: TOOL.search,
    description:
      "Procura viaturas do stand a que este colaborador tem acesso. Usa-a " +
      "SEMPRE antes de propor uma despesa, horas ou uma alteração a uma " +
      "viatura, para obter o identificador. Todos os campos são opcionais, " +
      "mas sem nenhum não devolve nada. Devolve até 5 viaturas, com a matrícula.",
    input_schema: {
      type: "object",
      properties: {
        matricula: { type: "string", description: "Matrícula, com ou sem hífenes." },
        marca: { type: "string", description: "Marca, ex.: BMW." },
        modelo: { type: "string", description: "Modelo, ex.: 320." },
        cor: { type: "string", description: "Cor, ex.: preto." },
        texto: {
          type: "string",
          description: "O que a pessoa escreveu sobre a viatura, tal e qual.",
        },
      },
      required: [],
    },
  },
  {
    name: TOOL.summary,
    description:
      "Custos já lançados, horas registadas e estado de uma viatura. Usa-a " +
      "para responder a perguntas de consulta. Não altera nada.",
    input_schema: {
      type: "object",
      properties: { viatura: viaturaProp },
      required: ["viatura"],
    },
  },
  {
    name: TOOL.query,
    description:
      "Lê qualquer dado do stand: viaturas (cars), fotos, contactos/leads, " +
      "propostas, reservas, oficina, custos, horas, testemunhos, utilizadores, " +
      "definições, estatísticas… As tabelas e colunas estão no contexto. Só " +
      "leitura. Usa filtros em vez de trazer tudo; para totais usa agregar. " +
      "Valores de texto comparam-se com 'contem' (sem distinguir maiúsculas).",
    input_schema: {
      type: "object",
      properties: {
        tabela: { type: "string", description: "Nome da tabela, ex.: cars." },
        colunas: {
          type: "array",
          items: { type: "string" },
          description: "Colunas a devolver. Omite para todas.",
        },
        filtros: {
          type: "array",
          items: {
            type: "object",
            properties: {
              coluna: { type: "string" },
              op: {
                type: "string",
                enum: ["eq", "neq", "gt", "gte", "lt", "lte", "contem", "em", "vazio", "preenchido"],
              },
              valor: {
                description: "Texto, número ou booleano; para 'em', uma lista.",
              },
            },
            required: ["coluna", "op"],
          },
        },
        ordenar: {
          type: "object",
          properties: { coluna: { type: "string" }, descendente: { type: "boolean" } },
          required: ["coluna"],
        },
        limite: { type: "integer", description: "1 a 50; por defeito 20." },
        agregar: {
          type: "object",
          description: "Em vez de linhas, um número: contar, somar, media, minimo, maximo.",
          properties: {
            funcao: { type: "string", enum: ["contar", "somar", "media", "minimo", "maximo"] },
            coluna: { type: "string", description: "Obrigatória exceto para contar." },
            agrupar_por: { type: "string", description: "Coluna para agrupar o resultado." },
          },
          required: ["funcao"],
        },
      },
      required: ["tabela"],
    },
  },
  {
    name: TOOL.searchLead,
    description:
      "Procura contactos (leads) para PROPOR uma alteração (estado, " +
      "responsável, nota). Devolve até 5, cada um com um identificador C1, C2… " +
      "Para só consultar, usa consultar_dados.",
    input_schema: {
      type: "object",
      properties: {
        texto: {
          type: "string",
          description: "Nome, telefone, email ou viatura do contacto, como a pessoa escreveu.",
        },
        estado: { type: "string", enum: [...LEAD_STATUS_TARGETS], description: "Só contactos neste estado." },
      },
      required: [],
    },
  },
  {
    name: TOOL.searchStaff,
    description:
      "Procura um colaborador pelo nome, para o atribuir como responsável de " +
      "um contacto. Devolve até 5, com identificador P1, P2…",
    input_schema: {
      type: "object",
      properties: { nome: { type: "string", description: "Nome do colaborador." } },
      required: ["nome"],
    },
  },
  {
    name: TOOL.searchTestimonial,
    description:
      "Procura testemunhos para os aprovar ou rejeitar. Devolve até 5, com " +
      "identificador T1, T2… Os por aprovar vêm primeiro.",
    input_schema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "Nome do autor ou parte do texto." },
        por_aprovar: { type: "boolean", description: "true para só os que ainda não estão publicados." },
      },
      required: [],
    },
  },
  {
    name: TOOL.register,
    description:
      "Propõe registar uma viatura nova na oficina. Só quando tiveres o nome " +
      "(marca e modelo) e a matrícula. Não registra: a pessoa confirma depois.",
    input_schema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Marca e modelo, ex.: Audi A1." },
        matricula: { type: "string", description: "Matrícula, ex.: 00-TE-00." },
        tipo: { type: "string", enum: ["car", "motorcycle"] },
      },
      required: ["nome", "matricula"],
    },
  },
  {
    name: TOOL.cost,
    description:
      "Propõe lançar uma despesa numa viatura. Categorias: transport " +
      "(transporte), parts (peças e material), labour (mão de obra), " +
      "preparation (preparação), other (outros). Não lança: a pessoa confirma.",
    input_schema: {
      type: "object",
      properties: {
        viatura: viaturaProp,
        categoria: { type: "string", enum: [...COST_CATEGORIES] },
        valor: { type: "number", description: "Valor em euros." },
        descricao: {
          type: "string",
          description: "O trabalho ou material, como a pessoa descreveu.",
        },
        data: { type: "string", description: "AAAA-MM-DD. Omite para hoje." },
      },
      required: ["viatura", "categoria", "valor", "descricao"],
    },
  },
  {
    name: TOOL.hours,
    description:
      "Propõe registar horas de oficina. Precisas da hora de início E de fim — " +
      "uma duração não serve. Não registra: a pessoa confirma.",
    input_schema: {
      type: "object",
      properties: {
        viatura: viaturaProp,
        data: { type: "string", description: "AAAA-MM-DD." },
        inicio: { type: "string", description: "HH:MM." },
        fim: { type: "string", description: "HH:MM." },
        noite: {
          type: "boolean",
          description: "true se o trabalho passou da meia-noite.",
        },
        descricao: { type: "string", description: "O trabalho realizado." },
      },
      required: ["viatura", "data", "inicio", "fim"],
    },
  },
  {
    name: TOOL.createCar,
    description:
      "Propõe criar uma viatura nova no stock, em RASCUNHO (não aparece no " +
      "site). Precisas de marca, modelo, ano, km, combustível, caixa, segmento " +
      "e preço (ou sob consulta) — pergunta o que faltar. Não cria: a pessoa confirma.",
    input_schema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["car", "motorcycle"] },
        marca: { type: "string" },
        modelo: { type: "string" },
        versao: { type: "string", description: "Versão/motorização, ex.: 320d M Sport. Opcional." },
        ano: { type: "integer" },
        km: { type: "integer", description: "Quilómetros." },
        combustivel: { type: "string", enum: [...FUEL_TYPES] },
        caixa: { type: "string", enum: [...TRANSMISSIONS] },
        segmento: { type: "string", enum: [...BODY_TYPES] },
        preco: { type: "integer", description: "Preço de venda em euros." },
        sob_consulta: { type: "boolean", description: "true se o preço é sob consulta." },
        matricula: { type: "string", description: "Opcional." },
        cor: { type: "string", description: "Opcional." },
        portas: { type: "integer", description: "Opcional (mota: 0)." },
        lugares: { type: "integer", description: "Opcional." },
      },
      required: ["tipo", "marca", "modelo", "ano", "km", "combustivel", "caixa", "segmento"],
    },
  },
  {
    name: TOOL.updateCar,
    description:
      "Propõe alterar uma viatura: preço, quilómetros, frase de destaque " +
      "(tagline) e/ou descrição. Só os campos que mudam. Não altera: a pessoa confirma.",
    input_schema: {
      type: "object",
      properties: {
        viatura: viaturaProp,
        preco: { type: "integer", description: "Novo preço em euros." },
        sob_consulta: { type: "boolean", description: "true para passar a preço sob consulta." },
        km: { type: "integer", description: "Quilómetros." },
        tagline: { type: "string", description: "Frase de destaque (até 160 caracteres)." },
        descricao: { type: "string", description: `Descrição nova (até ${MAX_TEXT} caracteres).` },
      },
      required: ["viatura"],
    },
  },
  {
    name: TOOL.carStatus,
    description:
      "Propõe mudar o estado de uma viatura: published (publicar no site) ou " +
      "draft (rascunho). Para reserved ou sold chama-a na mesma: o sistema " +
      "explica onde se faz. Não altera: a pessoa confirma.",
    input_schema: {
      type: "object",
      properties: {
        viatura: viaturaProp,
        estado: { type: "string", enum: [...CAR_STATUS_TARGETS] },
      },
      required: ["viatura", "estado"],
    },
  },
  {
    name: TOOL.leadStatus,
    description:
      "Propõe mudar o estado de um contacto: new, contacted, proposal, lost " +
      "(com o motivo) ou closed. Para won chama-a na mesma: o sistema explica. " +
      "Não altera: a pessoa confirma.",
    input_schema: {
      type: "object",
      properties: {
        contacto: contactoProp,
        estado: { type: "string", enum: [...LEAD_STATUS_TARGETS] },
        motivo: { type: "string", description: "Motivo de perda. Obrigatório para lost." },
      },
      required: ["contacto", "estado"],
    },
  },
  {
    name: TOOL.assignLead,
    description:
      "Propõe atribuir o responsável de um contacto. Não altera: a pessoa confirma.",
    input_schema: {
      type: "object",
      properties: {
        contacto: contactoProp,
        responsavel: {
          type: "string",
          description: "Identificador devolvido por procurar_colaborador, ex.: P1.",
        },
      },
      required: ["contacto", "responsavel"],
    },
  },
  {
    name: TOOL.leadNote,
    description:
      "Propõe registar uma nota (ou chamada, mensagem, proposta, visita) num " +
      "contacto. Não regista: a pessoa confirma.",
    input_schema: {
      type: "object",
      properties: {
        contacto: contactoProp,
        texto: { type: "string", description: `O que aconteceu (até ${MAX_TEXT} caracteres).` },
        tipo: { type: "string", enum: [...NOTE_KINDS], description: "Por defeito note." },
      },
      required: ["contacto", "texto"],
    },
  },
  {
    name: TOOL.testimonial,
    description:
      "Propõe aprovar (publicar no site) ou rejeitar (retirar do site) um " +
      "testemunho. Não altera: a pessoa confirma.",
    input_schema: {
      type: "object",
      properties: {
        testemunho: {
          type: "string",
          description: "Identificador devolvido por procurar_testemunho, ex.: T1.",
        },
        acao: { type: "string", enum: ["aprovar", "rejeitar"] },
      },
      required: ["testemunho", "acao"],
    },
  },
  // Fica fora de PROPOSAL_TOOLS: as fotografias não vêm do modelo, vêm da
  // conversa (as que a pessoa mandou e estão à espera). O handle trata-a à parte.
  {
    name: TOOL.photos,
    description:
      "Propõe juntar à galeria de uma viatura as fotografias que a pessoa " +
      "mandou e estão à espera. Só a viatura: as fotografias são todas as que " +
      "estão à espera. Não junta: a pessoa confirma.",
    input_schema: {
      type: "object",
      properties: { viatura: viaturaProp },
      required: ["viatura"],
    },
  },
];

/** Validação do input de cada proposta, pelo nome da ferramenta. */
export const PROPOSAL_SCHEMA = {
  [TOOL.register]: RegisterInput,
  [TOOL.cost]: CostInput,
  [TOOL.hours]: HoursInput,
  [TOOL.createCar]: CreateCarInput,
  [TOOL.updateCar]: UpdateCarInput,
  [TOOL.carStatus]: CarStatusInput,
  [TOOL.leadStatus]: LeadStatusInput,
  [TOOL.assignLead]: AssignLeadInput,
  [TOOL.leadNote]: LeadNoteInput,
  [TOOL.testimonial]: TestimonialInput,
} as const;
