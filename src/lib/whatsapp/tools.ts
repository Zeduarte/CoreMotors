import type Anthropic from "@anthropic-ai/sdk";
import {
  COST_CATEGORIES,
  CostInput,
  HoursInput,
  RegisterInput,
} from "@/lib/whatsapp/actions";

/**
 * As ferramentas do assistente interno, em duas classes — e a classe vê-se no
 * nome, de propósito:
 *
 *   procurar_* / resumo_*  → LEITURA. São executadas de verdade.
 *   propor_*               → PROPOSTA. Não escrevem nada. Terminam o ciclo.
 *
 * O modelo resolve e propõe; quem escreve é o nosso código, depois do «sim» da
 * pessoa. Por isso um erro de interpretação, ou uma mensagem que tente
 * manipulá-lo, não consegue por si alterar nada.
 *
 * As viaturas são identificadas por V1, V2, … e nunca pelo id da base de dados:
 * um identificador que não venha do último resultado de uma ferramenta é
 * rejeitado, e é isso que impede o modelo de inventar uma viatura.
 */

export const TOOL = {
  search: "procurar_viatura",
  summary: "resumo_viatura",
  query: "consultar_dados",
  register: "propor_registo_viatura",
  cost: "propor_despesa",
  hours: "propor_horas",
} as const;

/** Uma ferramenta de proposta foi chamada → o ciclo pára aqui. */
export const PROPOSAL_TOOLS: readonly string[] = [
  TOOL.register,
  TOOL.cost,
  TOOL.hours,
];

const viaturaProp = {
  type: "string" as const,
  description: "Identificador devolvido por procurar_viatura, ex.: V1.",
};

export const WA_TOOLS: Anthropic.Tool[] = [
  {
    name: TOOL.search,
    description:
      "Procura viaturas do stand a que este colaborador tem acesso. Usa-a " +
      "SEMPRE antes de propor uma despesa ou horas, para obter o " +
      "identificador da viatura. Todos os campos são opcionais, mas sem " +
      "nenhum não devolve nada. Devolve até 5 viaturas, com a matrícula.",
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
];

/** Validação do input de cada proposta, pelo nome da ferramenta. */
export const PROPOSAL_SCHEMA = {
  [TOOL.register]: RegisterInput,
  [TOOL.cost]: CostInput,
  [TOOL.hours]: HoursInput,
} as const;
