// Clínica Única v1.4 — modo real, Gineco primeiro + módulo Tirzepatida.
// v1.4 acrescenta a importação Tirzepatida pela página (POST /api/tirz/importar),
// só para a profissional logada, com backup antes de gravar. Ainda sem deploy.
// Módulo Tirzepatida (código próprio, sem copiar o Base44): coleções
// tirz* separadas dos pacientes da Gineco, só para a profissional logada.
// Os clientes Tirz não viram pacientes da Gineco; o link pacienteId só
// existe quando o telefone bate exatamente com um paciente já cadastrado.
// Sistema próprio, código próprio, sem dependências.
// Paciente agenda, confirma e vê suas consultas. A área do profissional
// exige login com senha criptografada (scrypt) e sessão por cookie.
// Regras vigentes: pt-BR, só Gemini (nunca OpenAI), sem inventar link,
// endereço, horário ou envio de mensagem.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3104;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "dados.json");
const PUBLIC_DIR = path.join(__dirname, "public");

// Grade real, editável em data/dados.json, sem precisar mudar código.
// Duração padrão: 60 minutos por consulta, até a profissional confirmar outra.
// Maraclin usa os horários da ficha pública (seg a sex, 06:00 às 16:00).
// Santa Casa usa a grade padrão da clínica até confirmar com a unidade.
// Online atende todos os dias, conforme a resposta "todos" da profissional.
// Bom Doutor NÃO entra na grade: sem endereço confirmado, não é reservável.
const CONFIG_HORARIOS_PADRAO = {
  duracaoMinutos: 60,
  locais: {
    maraclin: { dias: [1, 2, 3, 4, 5], horarios: ["06:00", "07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00"] },
    "santa-casa-sao-felix": { dias: [1, 2, 3, 4, 5], horarios: ["08:00", "09:00", "10:00", "11:00", "14:00", "15:00", "16:00", "17:00"] },
    online: { dias: [0, 1, 2, 3, 4, 5, 6], horarios: ["08:00", "09:00", "10:00", "11:00", "14:00", "15:00", "16:00", "17:00"] },
  },
};

// Cache em memória para a nota por IA: mesma entrada, mesma resposta,
// sem gastar cota de novo. Em 429 o sistema para na hora, sem tentar outro modelo.
const cacheIA = new Map();
const MODELO_IA = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
// Sessões só em memória: reiniciar o servidor encerra os logins, o que é seguro.
const sessoes = new Map();

function hojeSP(dias = 0) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return fmt.format(d);
}
function codigo() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}
function hashSenha(senha) {
  const sal = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(senha, sal, 64).toString("hex");
  return `scrypt:${sal}:${hash}`;
}
function verificarSenha(senha, armazenado) {
  try {
    const [, sal, hash] = armazenado.split(":");
    const teste = crypto.scryptSync(senha, sal, 64);
    return crypto.timingSafeEqual(teste, Buffer.from(hash, "hex"));
  } catch { return false; }
}
function lerCookie(req, nome) {
  const cab = req.headers.cookie || "";
  const item = cab.split(";").map((s) => s.trim()).find((s) => s.startsWith(nome + "="));
  return item ? decodeURIComponent(item.slice(nome.length + 1)) : "";
}
function sessaoProfissional(req) {
  const token = lerCookie(req, "sessao");
  if (!token) return null;
  const s = sessoes.get(token);
  if (!s || s.expiraEm < Date.now()) { sessoes.delete(token); return null; }
  return s;
}
function seed() {
  return {
    clinica: {
      nome: "Gineco — Consultas da Dra. Mayara Miranda",
      cidade: "Maragogipe e São Félix, BA — mais consultas online",
      locais: [
        { id: "bom-doutor", nome: "Centro Médico O Bom Doutor", endereco: "Endereço a confirmar — não encontrado em busca pública na Bahia", cidade: "Bahia", status: "a_confirmar", reservavel: false, fonte: "Informado pela clínica; endereço não localizado em 2026-10-28" },
        { id: "maraclin", nome: "Clínica Maraclin", endereco: "R. Dr. Maurício Rebouças, 118", cidade: "Maragogipe, BA", cep: "44420-000", telefone: "+55 75 99716-2346", horario: "Segunda a sexta, 06:00 às 16:00", latitude: -12.77843541, longitude: -38.91965014, status: "confirmado", reservavel: true, fonte: "Places, place_id 2271439086574961, verificado em 2026-10-28" },
        { id: "santa-casa-sao-felix", nome: "Santa Casa de Misericórdia São Félix", endereco: "Rua Nova, 1", cidade: "São Félix, BA", cep: "44360-000", telefone: "+55 75 3425-2616", horario: "Segunda a sexta, 08:00 às 17:00 — confirmar com a unidade", latitude: -12.6058098, longitude: -38.97010586, status: "confirmado", reservavel: true, fonte: "Places, place_id 1255224395250432, verificado em 2026-10-28" },
      ],
      // WhatsApp interno só via variável WHATSAPP_INTERNO, nunca fixo no
      // código e nunca devolvido pela API pública. Serve para lembretes e
      // remarcação com quem já agendou, não aparece na página pública.
      whatsappInterno: process.env.WHATSAPP_INTERNO || "",
      telefonePublico: "a confirmar se o WhatsApp pode aparecer na página",
      modalidades: ["Presencial", "Online"],
      pagamento: "Particular",
      duracaoMinutos: 60,
      politicaCancelamento: "sem_cancelamento",
      politicaCancelamentoTexto: "Conforme a política da clínica, não há cancelamento pela página. Para remarcar, fale pelo WhatsApp informado na sua consulta.",
      fotoAutorizada: true,
      fotoArquivo: null,
      teleconsulta: "Google Meet, gratuito. A profissional cria o Meet grátis na conta dela e cola o link na agenda; a paciente vê o link só na própria consulta online. Criação automática pela conta mh.cuidarsaude@gmail.com ainda não está ligada, porque essa conta ainda não autorizou o acesso no Google.",
      aviso: "Agendamento real da Gineco. Seus dados (nome, telefone e motivo) ficam só na clínica, para agendamento e lembrete. Você vê suas consultas informando seu WhatsApp em Minhas consultas.",
      privacidade: "Dados de paciente não são vendidos nem compartilhados. Prontuário só é visto pela profissional logada.",
    },
    profissionais: [
      { id: "mayara", nome: "Dra. Mayara Miranda", especialidade: "Ginecologia e Obstetrícia", descricao: "Consultas ginecológicas, pré-natal e clínica geral. Idealizadora do Gineco-AI." },
    ],
    tiposConsulta: ["Consulta ginecológica", "Pré-natal", "Clínica geral", "Outro motivo — descrever abaixo"],
    configHorarios: CONFIG_HORARIOS_PADRAO,
    usuariosProfissionais: [],
    agendamentos: [],
    listaEspera: [],
    prontuarios: [],
    // Fase 1 da expansão (código próprio, sem copiar outro sistema):
    // pacientes é a ficha central. Evolução, anamnese, procedimento,
    // plano e prescrição penduram nela, sempre por pacienteId.
    // O banco começa vazio de pacientes novos; só agendamentos antigos
    // geram fichas na migração abaixo, pelo nome e telefone já salvos.
    pacientes: [],
    evolucoes: [],
    anamneses: [],
    procedimentos: [],
    planosTratamento: [],
    prescricoes: [],
    // Módulo Tirzepatida, importado do TirzTracker (Base44) pelo script
    // scripts/import-tirz.mjs. Coleções separadas, nunca misturadas com
    // pacientes da Gineco. Foto: só a referência foto_url, sem baixar foto.
    tirzClientes: [],
    tirzEstoque: [],
    tirzMovimentacoes: [],
    tirzPesos: [],
    tirzFotos: [],
    contador: 1,
  };
}
const TIPOS_PRESCRICAO = ["Receituário", "Atestado", "Declaração", "Carta", "Solicitação de Exames", "Solicitação de Cirurgia", "Laudo"];
function soDigitos(t) { return String(t || "").replace(/\D/g, ""); }
function pacientePorTelefone(tel) {
  const d = soDigitos(tel);
  if (!d) return null;
  return db.pacientes.find((p) => soDigitos(p.telefone) === d) || null;
}
function criarOuAtualizarPaciente({ nome, telefone, email }) {
  if (!nome || !telefone) return null;
  const existente = pacientePorTelefone(telefone);
  if (existente) {
    if (email && !existente.email) existente.email = email;
    return existente;
  }
  const p = { id: db.contador++, nome, telefone, email: email || "", dataNascimento: "", observacoes: "", criadoEm: new Date().toISOString() };
  db.pacientes.push(p);
  return p;
}
function prontuarioDoPaciente(pacienteId) {
  const id = Number(pacienteId);
  const p = db.pacientes.find((x) => x.id === id);
  if (!p) return null;
  const ags = db.agendamentos.filter((a) => a.pacienteId === id || soDigitos(a.telefone) === soDigitos(p.telefone));
  const idsAg = new Set(ags.map((a) => a.id));
  return {
    paciente: p,
    agendamentos: ags.sort((a, b) => (b.data + b.hora).localeCompare(a.data + a.hora)),
    prontuariosAntigos: (db.prontuarios || []).filter((r) => idsAg.has(r.agendamentoId)),
    evolucoes: (db.evolucoes || []).filter((r) => r.pacienteId === id).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)),
    anamneses: (db.anamneses || []).filter((r) => r.pacienteId === id).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)),
    procedimentos: (db.procedimentos || []).filter((r) => r.pacienteId === id).sort((a, b) => (b.data || b.criadoEm).localeCompare(a.data || a.criadoEm)),
    planosTratamento: (db.planosTratamento || []).filter((r) => r.pacienteId === id).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)),
    prescricoes: (db.prescricoes || []).filter((r) => r.pacienteId === id).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)),
  };
}
// ---- Módulo Tirzepatida: helpers próprios, sem copiar o Base44 ----
function tirzNumero(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function tirzBool(v) {
  if (v === true || String(v).toLowerCase() === "true") return true;
  if (v === false || String(v).toLowerCase() === "false") return false;
  return null;
}
function tirzPacienteIdPorTelefone(telefone) {
  const d = soDigitos(telefone);
  if (!d) return null;
  const p = (db.pacientes || []).find((x) => soDigitos(x.telefone) === d);
  return p ? p.id : null;
}
function tirzLista(c) {
  // Lista sem CPF completo e sem observações: só o necessário para achar
  // o cliente na lista. CPF, nascimento e observações só no detalhe.
  const { cpf, data_nascimento, observacoes, ...resto } = c;
  void cpf; void data_nascimento; void observacoes;
  return resto;
}
function tirzResumo() {
  const clientes = db.tirzClientes || [];
  const estoque = db.tirzEstoque || [];
  const hoje = hojeSP(0);
  const em30 = hojeSP(30);
  const proximasAplicacoes = clientes.filter((c) => c.proxima_aplicacao && c.proxima_aplicacao >= hoje && c.proxima_aplicacao <= em30)
    .sort((a, b) => a.proxima_aplicacao.localeCompare(b.proxima_aplicacao))
    .slice(0, 20).map((c) => ({ id: c.id, data: c.proxima_aplicacao }));
  const vencimentosProximos = clientes.filter((c) => c.data_vencimento && c.data_vencimento >= hoje && c.data_vencimento <= em30)
    .sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento))
    .slice(0, 20).map((c) => ({ id: c.id, data: c.data_vencimento }));
  return {
    totalClientes: clientes.length,
    clientesAtivos: clientes.filter((c) => c.ativo === true).length,
    pagamentoPendente: clientes.filter((c) => c.status_pagamento === "pendente").length,
    pagamentoPago: clientes.filter((c) => c.status_pagamento === "pago").length,
    estoqueTotal: estoque.length,
    estoqueBaixo: estoque.filter((e) => (e.quantidade ?? 0) <= 3).map((e) => ({ dose: e.dose, quantidade: e.quantidade })),
    totalMovimentacoes: (db.tirzMovimentacoes || []).length,
    totalPesos: (db.tirzPesos || []).length,
    totalFotos: (db.tirzFotos || []).length,
    proximasAplicacoes,
    vencimentosProximos,
  };
}
function migrar(d) {
  let mudou = false;
  for (const chave of ["agendamentos", "listaEspera", "prontuarios", "usuariosProfissionais", "pacientes", "evolucoes", "anamneses", "procedimentos", "planosTratamento", "prescricoes", "tirzClientes", "tirzEstoque", "tirzMovimentacoes", "tirzPesos", "tirzFotos"]) {
    if (!Array.isArray(d[chave])) { d[chave] = []; mudou = true; }
  }
  // Fichas a partir de agendamentos antigos: um paciente por telefone.
  // Não cria paciente inventado e não importa dado de nenhum outro sistema.
  if (Array.isArray(d.agendamentos)) {
    for (const a of d.agendamentos) {
      if (!a.pacienteId) {
        const existente = d.pacientes.find((p) => String(p.telefone || "").replace(/\D/g, "") === String(a.telefone || "").replace(/\D/g, "") && a.telefone);
        if (existente) { a.pacienteId = existente.id; mudou = true; }
        else if (a.nome && a.telefone) {
          const p = { id: d.contador++, nome: a.nome, telefone: a.telefone, email: "", dataNascimento: "", observacoes: "", criadoEm: a.criadoEm || new Date().toISOString() };
          d.pacientes.push(p); a.pacienteId = p.id; mudou = true;
        }
      }
    }
  }
  if (!d.clinica) { d.clinica = seed().clinica; mudou = true; }
  if (!Array.isArray(d.profissionais)) { d.profissionais = seed().profissionais; mudou = true; }
  if (!Array.isArray(d.tiposConsulta)) { d.tiposConsulta = seed().tiposConsulta; mudou = true; }
  if (!d.configHorarios) { d.configHorarios = CONFIG_HORARIOS_PADRAO; mudou = true; }
  if (!d.usuariosProfissionais) { d.usuariosProfissionais = []; mudou = true; }
  if (d.clinica && typeof d.clinica.aviso === "string" && d.clinica.aviso.startsWith("Demonstração")) {
    d.clinica.aviso = seed().clinica.aviso; d.clinica.privacidade = seed().clinica.privacidade; d.clinica.duracaoMinutos = 60; mudou = true;
  }
  if (d.clinica && Array.isArray(d.clinica.locais)) {
    for (const local of d.clinica.locais) {
      if (local.id === "bom-doutor" && local.reservavel !== false) { local.reservavel = false; mudou = true; }
      if (local.id === "maraclin" && local.reservavel !== true) { local.reservavel = true; mudou = true; }
      if (local.id === "santa-casa-sao-felix" && local.reservavel !== true) { local.reservavel = true; mudou = true; }
    }
  }
  return mudou;
}
function carregar() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const d = seed();
    fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
    return d;
  }
  const d = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  if (migrar(d)) fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
  return d;
}
let db = carregar();
function salvar() { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }

function horariosPara(localId, data) {
  const cfg = (db.configHorarios && db.configHorarios.locais && db.configHorarios.locais[localId]) || CONFIG_HORARIOS_PADRAO.locais.online;
  const diaSemana = new Date(data + "T12:00:00").getDay();
  if (!cfg.dias.includes(diaSemana)) return [];
  return cfg.horarios;
}
function slots(profissionalId, data, localId) {
  const local = localId || "online";
  return horariosPara(local, data).map((hora) => {
    const ocupado = db.agendamentos.find((a) => a.profissionalId === profissionalId && a.data === data && a.hora === hora && a.localId === local && a.status !== "cancelado");
    return { hora, livre: !ocupado, agendamentoId: ocupado?.id || null };
  });
}
function localReservavel(localId) {
  if (localId === "online") return true;
  const local = (db.clinica.locais || []).find((l) => l.id === localId);
  return Boolean(local && local.reservavel);
}

// Entender um pedido digitado ou falado, sem IA: especialidade, dia e período.
// Se faltar informação, o sistema pergunta o que falta em vez de adivinhar.
function entenderTexto(textoRaw) {
  const t = (textoRaw || "").toLowerCase();
  const palavrasGineco = ["gineco", "ginecologia", "obstetr", "pré-natal", "pre-natal", "prenatal", "gestante", "gravidez", "preventivo", "rotina", "menopausa", "consulta"];
  const esp = palavrasGineco.some((p) => t.includes(p)) ? { chave: "ginecologia e obstetrícia" } : null;
  const tipoConsulta = t.includes("pré-natal") || t.includes("pre-natal") || t.includes("prenatal") || t.includes("gestante") || t.includes("gravidez") ? "Pré-natal" : t.includes("gineco") || t.includes("preventivo") || t.includes("rotina") ? "Consulta ginecológica" : null;
  const diasSemana = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  let data = null;
  if (t.includes("hoje")) data = hojeSP(0);
  else if (t.includes("amanhã") || t.includes("amanha")) data = hojeSP(1);
  else {
    const idx = diasSemana.findIndex((d) => t.includes(d));
    if (idx >= 0) {
      const hoje = new Date();
      const atual = hoje.getDay();
      let dif = (idx - atual + 7) % 7;
      if (dif === 0) dif = 7;
      data = hojeSP(dif);
    }
  }
  const periodo = t.includes("manhã") || t.includes("manha") ? "manha" : t.includes("tarde") ? "tarde" : null;
  const faltando = [];
  if (!esp) faltando.push("o tipo de consulta (ginecológica ou pré-natal)");
  if (!data) faltando.push("o dia");
  return { especialidade: esp?.chave || null, tipoConsulta, data, periodo, faltando };
}

function lerCorpo(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}
function enviar(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}
function profOk(req, res) {
  if (sessaoProfissional(req)) return true;
  enviar(res, 401, { ok: false, erro: "Área do profissional: faça login para continuar." });
  return false;
}
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" };

// Envio de lembrete por WhatsApp, sem fingir envio.
// Provedores: meta (oficial, exige token, phone_id e template) ou callmebot
// (exige apikey). Sem provedor configurado, devolve não enviado com o motivo.
async function enviarWhatsApp(telefone, mensagem) {
  const provedor = process.env.WHATSAPP_PROVIDER || "";
  const numero = telefone.replace(/\D/g, "");
  if (provedor === "meta") {
    if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_ID || !process.env.WHATSAPP_TEMPLATE) return { enviado: false, provedor, motivo: "WhatsApp oficial não configurado: faltam WHATSAPP_TOKEN, WHATSAPP_PHONE_ID ou WHATSAPP_TEMPLATE." };
    try {
      const r = await fetch(`https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
        body: JSON.stringify({ messaging_product: "whatsapp", to: numero, type: "template", template: { name: process.env.WHATSAPP_TEMPLATE, language: { code: "pt_BR" } } }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return { enviado: false, provedor, motivo: `WhatsApp oficial devolveu erro: ${j.error?.message || r.status}.` };
      return { enviado: true, provedor };
    } catch { return { enviado: false, provedor, motivo: "Falha ao chamar o WhatsApp oficial." }; }
  }
  if (provedor === "callmebot") {
    if (!process.env.WHATSAPP_APIKEY) return { enviado: false, provedor, motivo: "CallMeBot não configurado: falta WHATSAPP_APIKEY." };
    try {
      const r = await fetch(`https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(numero)}&text=${encodeURIComponent(mensagem)}&apikey=${encodeURIComponent(process.env.WHATSAPP_APIKEY)}`);
      const texto = await r.text();
      if (!r.ok || texto.toLowerCase().includes("error")) return { enviado: false, provedor, motivo: "CallMeBot devolveu erro." };
      return { enviado: true, provedor };
    } catch { return { enviado: false, provedor, motivo: "Falha ao chamar o CallMeBot." }; }
  }
  return { enviado: false, provedor: "", motivo: "WhatsApp não configurado. Defina WHATSAPP_PROVIDER (meta ou callmebot) e as credenciais dele nas variáveis." };
}
function textoLembrete(a) {
  const prof = db.profissionais.find((p) => p.id === a.profissionalId);
  const local = a.localId === "online" ? "online (Google Meet)" : (db.clinica.locais || []).find((l) => l.id === a.localId)?.nome || "";
  let texto = `Lembrete da Gineco: sua consulta com ${prof?.nome} é amanhã, ${a.data}, às ${a.hora}, em ${local}. Para confirmar, abra suas consultas na página. Para remarcar, fale pelo WhatsApp da clínica.`;
  if (a.modalidade === "Online" && a.linkMeet) texto += ` Link do Google Meet: ${a.linkMeet}`;
  return texto;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const rota = url.pathname;

  if (rota === "/api/health") return enviar(res, 200, { ok: true, servico: "clinica-unica", versao: "v1.4", modo: "real", ia_configurada: Boolean(process.env.GEMINI_API_KEY), modelo_ia: MODELO_IA, cache_ia: cacheIA.size, agendamentos: db.agendamentos.length, pacientes: (db.pacientes || []).length, prescricoes: (db.prescricoes || []).length, tiposPrescricao: TIPOS_PRESCRICAO, area_profissional_protegida: true, login_profissional_tem_conta: db.usuariosProfissionais.length > 0, whatsapp_provedor: process.env.WHATSAPP_PROVIDER || "nao_configurado", tirz: { clientes: (db.tirzClientes || []).length, estoque: (db.tirzEstoque || []).length, movimentacoes: (db.tirzMovimentacoes || []).length, pesos: (db.tirzPesos || []).length, fotos: (db.tirzFotos || []).length } });
  if (rota === "/api/clinica") {
    const { whatsappInterno, ...clinicaPublica } = db.clinica;
    return enviar(res, 200, { clinica: clinicaPublica, profissionais: db.profissionais, especialidades: [...new Set(db.profissionais.map((p) => p.especialidade))], tiposConsulta: db.tiposConsulta || [], duracaoMinutos: (db.configHorarios && db.configHorarios.duracaoMinutos) || 60 });
  }
  if (rota === "/api/disponibilidade") {
    const prof = url.searchParams.get("profissional"), data = url.searchParams.get("data"), local = url.searchParams.get("local") || "online";
    if (!prof || !data) return enviar(res, 400, { ok: false, erro: "Informe profissional e data." });
    if (!localReservavel(local)) return enviar(res, 200, { ok: true, slots: [], motivo: "Este local ainda não tem endereço confirmado e não está aberto para reserva." });
    return enviar(res, 200, { ok: true, slots: slots(prof, data, local) });
  }
  if (rota === "/api/meus-agendamentos") {
    const tel = (url.searchParams.get("telefone") || "").replace(/\D/g, "");
    return enviar(res, 200, { ok: true, agendamentos: db.agendamentos.filter((a) => a.telefone.replace(/\D/g, "") === tel).sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora)) });
  }
  if (rota === "/api/profissional/eu") {
    const s = sessaoProfissional(req);
    return enviar(res, 200, { ok: true, temConta: db.usuariosProfissionais.length > 0, logado: Boolean(s), email: s?.email || "" });
  }
  if (rota === "/api/lembretes") {
    if (!profOk(req, res)) return;
    const amanha = hojeSP(1);
    const lista = db.agendamentos.filter((a) => a.data === amanha && (a.status === "aguardando" || a.status === "confirmado"));
    return enviar(res, 200, { ok: true, data: amanha, lembretes: lista.map((a) => ({ ...a, mensagem: textoLembrete(a) })) });
  }
  if (rota === "/api/agenda") {
    if (!profOk(req, res)) return;
    const prof = url.searchParams.get("profissional"), data = url.searchParams.get("data") || hojeSP(0);
    const lista = db.agendamentos.filter((a) => (!prof || a.profissionalId === prof) && a.data === data).sort((a, b) => a.hora.localeCompare(b.hora));
    return enviar(res, 200, { ok: true, data, agenda: lista });
  }
  if (req.method === "GET" && rota === "/api/lista-espera") {
    if (!profOk(req, res)) return;
    return enviar(res, 200, { ok: true, listaEspera: db.listaEspera });
  }

  if (req.method === "POST" && rota === "/api/profissional/cadastro") {
    const b = await lerCorpo(req);
    if (db.usuariosProfissionais.length > 0) return enviar(res, 403, { ok: false, erro: "Já existe uma conta profissional. Use o login." });
    if (!b.email || !b.email.includes("@") || !b.senha || b.senha.length < 8) return enviar(res, 400, { ok: false, erro: "Informe um e-mail válido e uma senha com pelo menos 8 caracteres." });
    const usuario = { id: db.contador++, email: b.email.toLowerCase(), senhaHash: hashSenha(b.senha), criadoEm: new Date().toISOString() };
    db.usuariosProfissionais.push(usuario); salvar();
    return enviar(res, 201, { ok: true, mensagem: "Conta profissional criada. Faça login para usar a área do profissional." });
  }
  if (req.method === "POST" && rota === "/api/profissional/login") {
    const b = await lerCorpo(req);
    const usuario = db.usuariosProfissionais.find((u) => u.email === (b.email || "").toLowerCase());
    if (!usuario || !verificarSenha(b.senha || "", usuario.senhaHash)) return enviar(res, 401, { ok: false, erro: "E-mail ou senha incorretos." });
    const token = crypto.randomUUID();
    sessoes.set(token, { email: usuario.email, expiraEm: Date.now() + 12 * 60 * 60 * 1000 });
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Set-Cookie": `sessao=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${12 * 60 * 60}` });
    return res.end(JSON.stringify({ ok: true, email: usuario.email }));
  }
  if (req.method === "POST" && rota === "/api/profissional/logout") {
    sessoes.delete(lerCookie(req, "sessao"));
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Set-Cookie": "sessao=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (req.method === "POST" && rota === "/api/entender") {
    const { texto } = await lerCorpo(req);
    const ent = entenderTexto(texto);
    let sugestao = null;
    if (ent.especialidade && ent.data) {
      const prof = db.profissionais.find((p) => p.especialidade.toLowerCase() === ent.especialidade);
      if (prof) {
        const livres = slots(prof.id, ent.data, "online").filter((s) => s.livre && (!ent.periodo || (ent.periodo === "manha" ? s.hora < "12:00" : s.hora >= "12:00")));
        sugestao = { profissional: prof, horarios: livres.map((s) => s.hora) };
      }
    }
    return enviar(res, 200, { ok: true, ...ent, sugestao });
  }

  if (req.method === "POST" && rota === "/api/agendar") {
    const b = await lerCorpo(req);
    const localId = b.localId || "online";
    if (!b.nome || !b.telefone || !b.profissionalId || !b.data || !b.hora) return enviar(res, 400, { ok: false, erro: "Faltam nome, telefone, profissional, data ou hora." });
    if (!localReservavel(localId)) return enviar(res, 400, { ok: false, erro: "Este local ainda não tem endereço confirmado e não está aberto para reserva. Escolha Maraclin, Santa Casa ou online." });
    if (!slots(b.profissionalId, b.data, localId).find((s) => s.hora === b.hora && s.livre)) return enviar(res, 409, { ok: false, erro: "Esse horário já está ocupado ou não atende neste dia e local. Entre na lista de espera que avisamos se liberar." });
    const paciente = criarOuAtualizarPaciente({ nome: b.nome, telefone: b.telefone, email: b.email || "" });
    const ag = { id: db.contador++, codigo: codigo(), nome: b.nome, telefone: b.telefone, pacienteId: paciente?.id || null, profissionalId: b.profissionalId, data: b.data, hora: b.hora, tipoConsulta: b.tipoConsulta || "", modalidade: localId === "online" ? "Online" : "Presencial", localId, linkMeet: "", motivo: b.motivo || "", canal: b.canal || "site", status: "aguardando", criadoEm: new Date().toISOString() };
    db.agendamentos.push(ag); salvar();
    return enviar(res, 201, { ok: true, agendamento: ag });
  }
  if (req.method === "POST" && rota === "/api/confirmar") {
    const { id } = await lerCorpo(req);
    const ag = db.agendamentos.find((a) => a.id === Number(id));
    if (!ag) return enviar(res, 404, { ok: false, erro: "Agendamento não encontrado." });
    ag.status = "confirmado"; salvar();
    return enviar(res, 200, { ok: true, agendamento: ag });
  }
  if (req.method === "POST" && rota === "/api/cancelar") {
    const { id } = await lerCorpo(req);
    if (db.clinica.politicaCancelamento === "sem_cancelamento") return enviar(res, 403, { ok: false, erro: db.clinica.politicaCancelamentoTexto });
    const ag = db.agendamentos.find((a) => a.id === Number(id));
    if (!ag) return enviar(res, 404, { ok: false, erro: "Agendamento não encontrado." });
    ag.status = "cancelado";
    const espera = db.listaEspera.find((e) => e.profissionalId === ag.profissionalId && e.data === ag.data && e.hora === ag.hora && e.status === "aguardando");
    if (espera) { espera.status = "vaga_liberada"; }
    salvar();
    return enviar(res, 200, { ok: true, agendamento: ag, vagaLiberadaPara: espera || null });
  }
  if (req.method === "POST" && rota === "/api/lista-espera") {
    const b = await lerCorpo(req);
    const localId = b.localId || "online";
    if (!b.nome || !b.telefone || !b.profissionalId || !b.data || !b.hora) return enviar(res, 400, { ok: false, erro: "Faltam dados para a lista de espera." });
    if (!localReservavel(localId)) return enviar(res, 400, { ok: false, erro: "Este local ainda não tem endereço confirmado e não está aberto para reserva." });
    const item = { id: db.contador++, ...b, localId, status: "aguardando", criadoEm: new Date().toISOString() };
    db.listaEspera.push(item); salvar();
    return enviar(res, 201, { ok: true, item });
  }
  if (req.method === "POST" && rota === "/api/lembretes/enviar") {
    if (!profOk(req, res)) return;
    const amanha = hojeSP(1);
    const lista = db.agendamentos.filter((a) => a.data === amanha && (a.status === "aguardando" || a.status === "confirmado") && !a.lembreteEnviadoEm);
    const resultados = [];
    for (const a of lista) {
      const r = await enviarWhatsApp(a.telefone, textoLembrete(a));
      if (r.enviado) { a.lembreteEnviadoEm = new Date().toISOString(); }
      resultados.push({ agendamentoId: a.id, nome: a.nome, ...r });
    }
    salvar();
    return enviar(res, 200, { ok: true, data: amanha, resultados });
  }
  if (req.method === "POST" && rota === "/api/checkin") {
    if (!profOk(req, res)) return;
    const { id } = await lerCorpo(req);
    const ag = db.agendamentos.find((a) => a.id === Number(id));
    if (!ag) return enviar(res, 404, { ok: false, erro: "Agendamento não encontrado." });
    ag.status = "compareceu"; salvar();
    return enviar(res, 200, { ok: true, agendamento: ag });
  }
  if (req.method === "POST" && rota === "/api/prontuario") {
    if (!profOk(req, res)) return;
    const b = await lerCorpo(req);
    if (!b.agendamentoId || !b.nota) return enviar(res, 400, { ok: false, erro: "Informe o agendamento e a nota." });
    const reg = { id: db.contador++, agendamentoId: Number(b.agendamentoId), nota: b.nota, origem: b.origem || "profissional", revisadoPeloProfissional: true, criadoEm: new Date().toISOString() };
    db.prontuarios.push(reg); salvar();
    return enviar(res, 201, { ok: true, prontuario: reg });
  }
  if (req.method === "POST" && rota === "/api/nota-ia") {
    if (!profOk(req, res)) return;
    const { texto } = await lerCorpo(req);
    if (!texto) return enviar(res, 400, { ok: false, erro: "Envie o texto da consulta para organizar." });
    if (cacheIA.has(texto)) return enviar(res, 200, { ok: true, cache: true, modelo: MODELO_IA, resumo: cacheIA.get(texto) });
    if (!process.env.GEMINI_API_KEY) return enviar(res, 200, { ok: false, ia_disponivel: false, mensagem: "IA não configurada. Configure GEMINI_API_KEY para ligar o resumo — sem chave, nenhum resumo é inventado." });
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO_IA}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: `Organize o relato abaixo em: queixa, história, exame e conduta sugerida para revisão. Não feche diagnóstico sozinho e sinalize o que está incerto. Relato: ${texto}` }] }] }),
      });
      if (r.status === 429) return enviar(res, 429, { ok: false, erro: "Cota do Gemini esgotada. O sistema parou aqui, sem tentar outro modelo." });
      const j = await r.json();
      const resumo = j.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
      if (!resumo) return enviar(res, 502, { ok: false, erro: "A IA não devolveu um resumo. Tente de novo mais tarde." });
      cacheIA.set(texto, resumo);
      return enviar(res, 200, { ok: true, cache: false, modelo: MODELO_IA, resumo });
    } catch (e) { return enviar(res, 502, { ok: false, erro: "Falha ao chamar a IA. Nenhum resumo foi salvo." }); }
  }

  if (req.method === "POST" && rota === "/api/calculadora-gestacional") {
    const { dum } = await lerCorpo(req);
    const inicio = new Date(dum + "T12:00:00");
    if (isNaN(inicio)) return enviar(res, 400, { ok: false, erro: "Informe a data da última menstruação (DUM) no formato ano-mês-dia." });
    const hoje = new Date(hojeSP(0) + "T12:00:00");
    const dias = Math.floor((hoje - inicio) / 86400000);
    if (dias < 0) return enviar(res, 400, { ok: false, erro: "A DUM não pode ser uma data futura." });
    const dpp = new Date(inicio); dpp.setDate(dpp.getDate() + 280);
    const semanas = Math.floor(dias / 7), diasResto = dias % 7;
    return enviar(res, 200, { ok: true, idadeGestacional: `${semanas} semanas e ${diasResto} dia(s)`, dataProvavelParto: dpp.toISOString().slice(0, 10), aviso: "Resultado informativo, calculado pela regra de Naegele (DUM + 280 dias). A profissional confirma na consulta, principalmente se o ciclo for irregular ou houver ultrassom." });
  }

  if (req.method === "POST" && rota === "/api/teleconsulta") {
    if (!profOk(req, res)) return;
    const { id, linkMeet } = await lerCorpo(req);
    const ag = db.agendamentos.find((a) => a.id === Number(id));
    if (!ag) return enviar(res, 404, { ok: false, erro: "Agendamento não encontrado." });
    if (ag.modalidade !== "Online") return enviar(res, 400, { ok: false, erro: "Só consulta online tem link do Google Meet." });
    if (!/^https:\/\/meet\.google\.com\/[a-z0-9-]+$/i.test((linkMeet || "").trim())) return enviar(res, 400, { ok: false, erro: "Cole um link válido do Google Meet, começando por https://meet.google.com/." });
    ag.linkMeet = linkMeet.trim(); salvar();
    return enviar(res, 200, { ok: true, agendamento: ag });
  }

  // ---- Fase 1: pacientes, prontuário e prescrever (só profissional logado) ----
  if (rota === "/api/pacientes" && req.method === "GET") {
    if (!profOk(req, res)) return;
    const busca = (url.searchParams.get("busca") || "").toLowerCase();
    const lista = (db.pacientes || []).filter((p) => !busca || p.nome.toLowerCase().includes(busca) || soDigitos(p.telefone).includes(soDigitos(busca))).sort((a, b) => a.nome.localeCompare(b.nome)).map((p) => ({
      ...p,
      totalAgendamentos: db.agendamentos.filter((a) => a.pacienteId === p.id).length,
      totalPrescricoes: (db.prescricoes || []).filter((r) => r.pacienteId === p.id).length,
    }));
    return enviar(res, 200, { ok: true, pacientes: lista });
  }
  if (rota === "/api/pacientes" && req.method === "POST") {
    if (!profOk(req, res)) return;
    const b = await lerCorpo(req);
    if (!b.nome || !b.telefone) return enviar(res, 400, { ok: false, erro: "Informe nome e telefone do paciente." });
    const existente = pacientePorTelefone(b.telefone);
    if (existente) {
      existente.nome = b.nome; if (b.email !== undefined) existente.email = b.email; if (b.dataNascimento !== undefined) existente.dataNascimento = b.dataNascimento; if (b.observacoes !== undefined) existente.observacoes = b.observacoes;
      salvar(); return enviar(res, 200, { ok: true, paciente: existente, mensagem: "Paciente já existia pelo telefone e foi atualizado." });
    }
    const p = { id: db.contador++, nome: b.nome, telefone: b.telefone, email: b.email || "", dataNascimento: b.dataNascimento || "", observacoes: b.observacoes || "", criadoEm: new Date().toISOString() };
    db.pacientes.push(p); salvar();
    return enviar(res, 201, { ok: true, paciente: p });
  }
  const mPaciente = rota.match(/^\/api\/pacientes\/(\d+)$/);
  if (mPaciente && req.method === "GET") {
    if (!profOk(req, res)) return;
    const pront = prontuarioDoPaciente(mPaciente[1]);
    if (!pront) return enviar(res, 404, { ok: false, erro: "Paciente não encontrado." });
    return enviar(res, 200, { ok: true, ...pront });
  }
  const mSub = rota.match(/^\/api\/pacientes\/(\d+)\/(evolucoes|anamneses|procedimentos|planos)$/);
  if (mSub && req.method === "POST") {
    if (!profOk(req, res)) return;
    const pacienteId = Number(mSub[1]);
    if (!db.pacientes.find((p) => p.id === pacienteId)) return enviar(res, 404, { ok: false, erro: "Paciente não encontrado." });
    const b = await lerCorpo(req);
    const colecao = { evolucoes: "evolucoes", anamneses: "anamneses", procedimentos: "procedimentos", planos: "planosTratamento" }[mSub[2]];
    const texto = b.texto || b.descricao || b.titulo || "";
    if (!texto && mSub[2] !== "anamneses") return enviar(res, 400, { ok: false, erro: "Escreva o conteúdo antes de salvar." });
    if (mSub[2] === "anamneses" && !b.queixa && !b.historia && !texto) return enviar(res, 400, { ok: false, erro: "Preencha pelo menos a queixa ou a história na anamnese." });
    const reg = { id: db.contador++, pacienteId, agendamentoId: b.agendamentoId ? Number(b.agendamentoId) : null, texto, titulo: b.titulo || "", queixa: b.queixa || "", historia: b.historia || "", antecedentes: b.antecedentes || "", alergias: b.alergias || "", medicamentosUso: b.medicamentosUso || "", nome: b.nome || "", descricao: b.descricao || "", etapas: b.etapas || "", data: b.data || hojeSP(0), criadoEm: new Date().toISOString() };
    db[colecao].push(reg); salvar();
    return enviar(res, 201, { ok: true, registro: reg });
  }
  if (rota === "/api/prescrever" && req.method === "POST") {
    if (!profOk(req, res)) return;
    const b = await lerCorpo(req);
    if (!TIPOS_PRESCRICAO.includes(b.tipo)) return enviar(res, 400, { ok: false, erro: `Tipo inválido. Use um destes: ${TIPOS_PRESCRICAO.join(", ")}.` });
    if (!db.pacientes.find((p) => p.id === Number(b.pacienteId))) return enviar(res, 404, { ok: false, erro: "Paciente não encontrado. Cadastre o paciente antes de prescrever." });
    if (!b.texto) return enviar(res, 400, { ok: false, erro: "Escreva o conteúdo do documento antes de salvar." });
    const doc = { id: db.contador++, pacienteId: Number(b.pacienteId), tipo: b.tipo, titulo: b.titulo || b.tipo, texto: b.texto, itens: b.itens || "", data: b.data || hojeSP(0), criadoEm: new Date().toISOString() };
    db.prescricoes.push(doc); salvar();
    return enviar(res, 201, { ok: true, prescricao: doc });
  }
  if (rota === "/api/prescricoes" && req.method === "GET") {
    if (!profOk(req, res)) return;
    const pid = url.searchParams.get("pacienteId");
    const lista = (db.prescricoes || []).filter((r) => !pid || r.pacienteId === Number(pid)).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
    return enviar(res, 200, { ok: true, prescricoes: lista, tipos: TIPOS_PRESCRICAO });
  }
  if (rota === "/api/profissional/resumo" && req.method === "GET") {
    if (!profOk(req, res)) return;
    const hoje = hojeSP(0), amanha = hojeSP(1);
    const proximos = db.agendamentos.filter((a) => a.data >= hoje && a.status !== "cancelado").sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora)).slice(0, 10);
    return enviar(res, 200, { ok: true, hoje, amanha, totalPacientes: (db.pacientes || []).length, hojeTotal: db.agendamentos.filter((a) => a.data === hoje).length, amanhaTotal: db.agendamentos.filter((a) => a.data === amanha).length, proximos });
  }

  // ---- Módulo Tirzepatida: só profissional logada, coleção separada ----
  if (rota === "/api/tirz/resumo" && req.method === "GET") {
    if (!profOk(req, res)) return;
    return enviar(res, 200, { ok: true, resumo: tirzResumo() });
  }
  if (rota === "/api/tirz/clientes" && req.method === "GET") {
    if (!profOk(req, res)) return;
    const busca = (url.searchParams.get("busca") || "").toLowerCase();
    const status = url.searchParams.get("status") || "";
    const dose = url.searchParams.get("dose") || "";
    const lista = (db.tirzClientes || []).filter((c) =>
      (!busca || c.nome.toLowerCase().includes(busca) || soDigitos(c.telefone).includes(soDigitos(busca))) &&
      (!status || c.status_pagamento === status) &&
      (!dose || c.dose === dose || c.dose_final === dose)
    ).sort((a, b) => a.nome.localeCompare(b.nome)).map(tirzLista);
    return enviar(res, 200, { ok: true, clientes: lista, total: lista.length });
  }
  const mTirzCliente = rota.match(/^\/api\/tirz\/clientes\/(\d+)$/);
  if (mTirzCliente && req.method === "GET") {
    if (!profOk(req, res)) return;
    const c = (db.tirzClientes || []).find((x) => x.id === Number(mTirzCliente[1]));
    if (!c) return enviar(res, 404, { ok: false, erro: "Cliente Tirzepatida não encontrado." });
    return enviar(res, 200, {
      ok: true, cliente: c,
      pesos: (db.tirzPesos || []).filter((p) => p.tirzClienteId === c.id).sort((a, b) => (b.data || "").localeCompare(a.data || "")),
      movimentacoes: (db.tirzMovimentacoes || []).filter((m) => m.tirzClienteId === c.id).sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || "")),
      fotos: (db.tirzFotos || []).filter((f) => f.tirzClienteId === c.id).sort((a, b) => (b.data_envio || "").localeCompare(a.data_envio || "")),
    });
  }
  if (rota === "/api/tirz/estoque" && req.method === "GET") {
    if (!profOk(req, res)) return;
    const lista = (db.tirzEstoque || []).map((e) => ({ ...e, estoqueBaixo: (e.quantidade ?? 0) <= 3 }));
    return enviar(res, 200, { ok: true, estoque: lista });
  }
  if (rota === "/api/tirz/relatorios" && req.method === "GET") {
    if (!profOk(req, res)) return;
    const clientes = db.tirzClientes || [];
    const ativos = clientes.filter((c) => c.ativo === true);
    const somaMensalidadesAtivas = ativos.reduce((s, c) => s + (tirzNumero(c.valor_mensalidade) || 0), 0);
    const porDose = {};
    for (const c of clientes) { const d = c.dose_final || c.dose || "não informada"; porDose[d] = (porDose[d] || 0) + 1; }
    return enviar(res, 200, {
      ok: true, relatorio: {
        totalClientes: clientes.length, clientesAtivos: ativos.length,
        pagamentoPendente: clientes.filter((c) => c.status_pagamento === "pendente").length,
        pagamentoPago: clientes.filter((c) => c.status_pagamento === "pago").length,
        mensalidadesAtivas: somaMensalidadesAtivas,
        avisoMensalidades: "Soma de valor_mensalidade apenas de clientes ativos. Não é receita paga: a entidade Pagamento estava zerada no Base44.",
        porDose,
        totalMovimentacoes: (db.tirzMovimentacoes || []).length,
        entradas: (db.tirzMovimentacoes || []).filter((m) => m.tipo === "entrada").reduce((s, m) => s + (tirzNumero(m.quantidade) || 0), 0),
        saidas: (db.tirzMovimentacoes || []).filter((m) => m.tipo === "saida").reduce((s, m) => s + (tirzNumero(m.quantidade) || 0), 0),
      },
    });
  }
  if (rota === "/api/tirz/clientes" && req.method === "POST") {
    if (!profOk(req, res)) return;
    const b = await lerCorpo(req);
    if (!b.nome || !b.telefone) return enviar(res, 400, { ok: false, erro: "Informe nome e telefone do cliente Tirzepatida." });
    const c = {
      id: db.contador++, base44Id: null, pacienteId: tirzPacienteIdPorTelefone(b.telefone),
      nome: b.nome, cpf: b.cpf || "", data_nascimento: b.data_nascimento || "", telefone: b.telefone, email: b.email || "",
      dose: b.dose || "", dose_inicial: b.dose_inicial || "", dose_final: b.dose_final || "", tipo_venda: b.tipo_venda || "",
      peso_inicial: tirzNumero(b.peso_inicial), peso_final: tirzNumero(b.peso_final), valor_mensalidade: tirzNumero(b.valor_mensalidade),
      data_atendimento: b.data_atendimento || "", proxima_aplicacao: b.proxima_aplicacao || "", data_vencimento: b.data_vencimento || "",
      status_pagamento: b.status_pagamento || "pendente", ativo: b.ativo === undefined ? true : Boolean(b.ativo),
      lembrete_ativo: b.lembrete_ativo === undefined ? true : Boolean(b.lembrete_ativo), observacoes: b.observacoes || "",
      criadoEm: new Date().toISOString(),
    };
    db.tirzClientes.push(c); salvar();
    return enviar(res, 201, { ok: true, cliente: c });
  }
  if (rota === "/api/tirz/pesos" && req.method === "POST") {
    if (!profOk(req, res)) return;
    const b = await lerCorpo(req);
    const cliente = (db.tirzClientes || []).find((c) => c.id === Number(b.tirzClienteId));
    if (!cliente) return enviar(res, 404, { ok: false, erro: "Cliente Tirzepatida não encontrado." });
    if (!b.data || tirzNumero(b.peso) === null) return enviar(res, 400, { ok: false, erro: "Informe a data e o peso em kg." });
    const p = { id: db.contador++, base44Id: null, tirzClienteId: cliente.id, data: b.data, peso: tirzNumero(b.peso), observacao: b.observacao || "", criadoEm: new Date().toISOString() };
    db.tirzPesos.push(p);
    cliente.peso_final = p.peso;
    salvar();
    return enviar(res, 201, { ok: true, peso: p });
  }
  if (rota === "/api/tirz/movimentacoes" && req.method === "POST") {
    if (!profOk(req, res)) return;
    const b = await lerCorpo(req);
    if (!b.dose || !["entrada", "saida"].includes(b.tipo) || tirzNumero(b.quantidade) === null || tirzNumero(b.quantidade) <= 0) return enviar(res, 400, { ok: false, erro: "Informe dose, tipo entrada ou saída, e quantidade maior que zero." });
    let item = (db.tirzEstoque || []).find((e) => e.dose === b.dose);
    if (!item) {
      item = { id: db.contador++, base44Id: null, dose: b.dose, quantidade: 0, doses_por_caixa: 4, alerta_minimo: 3, criadoEm: new Date().toISOString() };
      db.tirzEstoque.push(item);
    }
    const qtd = tirzNumero(b.quantidade);
    if (b.tipo === "saida" && (item.quantidade ?? 0) - qtd < 0) return enviar(res, 400, { ok: false, erro: "Saída maior que o estoque disponível. O estoque não pode ficar negativo." });
    item.quantidade = (item.quantidade ?? 0) + (b.tipo === "entrada" ? qtd : -qtd);
    const cliente = b.tirzClienteId ? (db.tirzClientes || []).find((c) => c.id === Number(b.tirzClienteId)) : null;
    const m = { id: db.contador++, base44Id: null, tirzClienteId: cliente?.id || null, cliente_id: b.cliente_id || cliente?.base44Id || null, cliente_nome: cliente?.nome || b.cliente_nome || "", dose: b.dose, tipo: b.tipo, quantidade: qtd, motivo: b.motivo || "", observacao: b.observacao || "", criadoEm: new Date().toISOString() };
    db.tirzMovimentacoes.push(m); salvar();
    return enviar(res, 201, { ok: true, movimentacao: m, estoque: item });
  }
  // ---- Importação Tirzepatida (JSON montado a partir dos CSVs), só profissional logada ----
  // Mesmas regras do script local scripts/import-tirz.mjs: clientes primeiro,
  // idempotente por base44Id (clientes, movimentações, pesos e fotos) e por
  // dose (estoque); movimentações importadas são histórico e NÃO alteram o
  // estoque; fotos guardam só a referência foto_url, sem baixar foto; não
  // importa created_by nem created_by_id; um campo usuarios, se vier, é só
  // contado como ignorado, nunca como paciente; clientes Tirz continuam
  // separados dos pacientes da Gineco. Antes de gravar, faz backup de
  // DATA_FILE para DATA_FILE.bak-<carimbo>, só se o arquivo existir.
  // Corpo inválido é rejeitado sem gravar nada. A resposta traz só
  // contagens e o nome do backup, sem dados de paciente.
  if (rota === "/api/tirz/importar" && req.method === "POST") {
    if (!profOk(req, res)) return;
    const b = await lerCorpo(req);
    const conjuntos = ["clientes", "estoque", "movimentacoes", "pesos", "fotos", "usuarios"];
    if (!b || typeof b !== "object" || Array.isArray(b)) return enviar(res, 400, { ok: false, erro: "Envie um objeto JSON com os conjuntos clientes, estoque, movimentacoes, pesos e fotos. Nada foi importado." });
    for (const chave of conjuntos) {
      if (b[chave] !== undefined && !Array.isArray(b[chave])) return enviar(res, 400, { ok: false, erro: `O conjunto ${chave} precisa ser uma lista. Nada foi importado.` });
    }
    if (!conjuntos.slice(0, 5).some((chave) => Array.isArray(b[chave]))) return enviar(res, 400, { ok: false, erro: "Envie pelo menos um conjunto para importar. Nada foi importado." });
    for (const chave of conjuntos.slice(0, 5)) {
      for (const item of b[chave] || []) {
        if (!item || typeof item !== "object" || Array.isArray(item)) return enviar(res, 400, { ok: false, erro: `Um item de ${chave} não é um objeto válido. Nada foi importado.` });
      }
    }
    let backup = null;
    if (fs.existsSync(DATA_FILE)) {
      const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
      backup = `dados.json.bak-${carimbo}`;
      fs.copyFileSync(DATA_FILE, path.join(DATA_DIR, backup));
    }
    if (!db.contador) db.contador = 1;
    const mapaCliente = new Map();
    for (const c of db.tirzClientes || []) {
      if (c.base44Id !== null && c.base44Id !== undefined && c.base44Id !== "") mapaCliente.set(String(c.base44Id), c.id);
    }
    const base44IdDe = (r) => (r.base44Id !== undefined && r.base44Id !== null && r.base44Id !== "" ? String(r.base44Id) : null);
    for (const r of b.clientes || []) {
      const base44Id = base44IdDe(r);
      const dados = {
        base44Id, nome: r.nome || "", cpf: r.cpf || "", data_nascimento: r.data_nascimento || "", telefone: r.telefone || "", email: r.email || "",
        dose: r.dose || "", dose_inicial: r.dose_inicial || "", dose_final: r.dose_final || "", tipo_venda: r.tipo_venda || "",
        peso_inicial: tirzNumero(r.peso_inicial), peso_final: tirzNumero(r.peso_final), valor_mensalidade: tirzNumero(r.valor_mensalidade),
        data_atendimento: r.data_atendimento || "", proxima_aplicacao: r.proxima_aplicacao || "", data_vencimento: r.data_vencimento || "",
        status_pagamento: r.status_pagamento || "pendente", ativo: tirzBool(r.ativo), lembrete_ativo: tirzBool(r.lembrete_ativo), observacoes: r.observacoes || "",
      };
      const existente = base44Id ? (db.tirzClientes || []).find((c) => c.base44Id !== null && String(c.base44Id) === base44Id) : null;
      if (existente) { Object.assign(existente, dados, { pacienteId: tirzPacienteIdPorTelefone(r.telefone) }); mapaCliente.set(base44Id, existente.id); }
      else { const c = { id: db.contador++, pacienteId: tirzPacienteIdPorTelefone(r.telefone), ...dados, criadoEm: new Date().toISOString() }; db.tirzClientes.push(c); if (base44Id) mapaCliente.set(base44Id, c.id); }
    }
    for (const r of b.estoque || []) {
      if (!r.dose) continue;
      const existente = (db.tirzEstoque || []).find((e) => e.dose === r.dose);
      if (existente) { existente.quantidade = tirzNumero(r.quantidade) ?? 0; if (r.base44Id) existente.base44Id = String(r.base44Id); }
      else db.tirzEstoque.push({ id: db.contador++, base44Id: r.base44Id ? String(r.base44Id) : null, dose: r.dose, quantidade: tirzNumero(r.quantidade) ?? 0, doses_por_caixa: 4, alerta_minimo: 3, criadoEm: new Date().toISOString() });
    }
    for (const r of b.movimentacoes || []) {
      const base44Id = base44IdDe(r);
      const dados = {
        base44Id, tirzClienteId: r.cliente_id ? (mapaCliente.get(String(r.cliente_id)) || null) : null, cliente_id: r.cliente_id ? String(r.cliente_id) : null,
        cliente_nome: r.cliente_nome || "", dose: r.dose || "", tipo: r.tipo || "", quantidade: tirzNumero(r.quantidade), motivo: r.motivo || "", observacao: r.observacao || "",
      };
      const existente = base44Id ? (db.tirzMovimentacoes || []).find((m) => m.base44Id !== null && String(m.base44Id) === base44Id) : null;
      if (existente) Object.assign(existente, dados); else db.tirzMovimentacoes.push({ id: db.contador++, ...dados, criadoEm: new Date().toISOString() });
    }
    for (const r of b.pesos || []) {
      const base44Id = base44IdDe(r);
      const dados = { base44Id, tirzClienteId: r.cliente_id ? (mapaCliente.get(String(r.cliente_id)) || null) : null, data: r.data || "", peso: tirzNumero(r.peso), observacao: r.observacao || "" };
      const existente = base44Id ? (db.tirzPesos || []).find((p) => p.base44Id !== null && String(p.base44Id) === base44Id) : null;
      if (existente) Object.assign(existente, dados); else db.tirzPesos.push({ id: db.contador++, ...dados, criadoEm: new Date().toISOString() });
    }
    for (const r of b.fotos || []) {
      const base44Id = base44IdDe(r);
      const dados = { base44Id, tirzClienteId: r.cliente_id ? (mapaCliente.get(String(r.cliente_id)) || null) : null, semana: r.semana || "", nome_foto: r.nome_foto || "", legenda: r.legenda || "", foto_url: r.foto_url || "", data_envio: r.data_envio || "" };
      const existente = base44Id ? (db.tirzFotos || []).find((f) => f.base44Id !== null && String(f.base44Id) === base44Id) : null;
      if (existente) Object.assign(existente, dados); else db.tirzFotos.push({ id: db.contador++, ...dados, criadoEm: new Date().toISOString() });
    }
    const usuariosIgnorados = Array.isArray(b.usuarios) ? b.usuarios.length : 0;
    salvar();
    return enviar(res, 200, { ok: true, backup, clientes: (db.tirzClientes || []).length, estoque: (db.tirzEstoque || []).length, movimentacoes: (db.tirzMovimentacoes || []).length, pesos: (db.tirzPesos || []).length, fotos: (db.tirzFotos || []).length, usuariosIgnorados });
  }

  // Arquivos estáticos
  let file = path.join(PUBLIC_DIR, rota === "/" ? "index.html" : rota);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("Não encontrado"); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "text/plain" });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => console.log(`Clínica Única v1.4 em http://localhost:${PORT}`));
