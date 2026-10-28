// Clínica Única v1.1 — modo real, Gineco primeiro.
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
    contador: 1,
  };
}
function migrar(d) {
  let mudou = false;
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

  if (rota === "/api/health") return enviar(res, 200, { ok: true, servico: "clinica-unica", versao: "v1.1", modo: "real", ia_configurada: Boolean(process.env.GEMINI_API_KEY), modelo_ia: MODELO_IA, cache_ia: cacheIA.size, agendamentos: db.agendamentos.length, area_profissional_protegida: true, login_profissional_tem_conta: db.usuariosProfissionais.length > 0, whatsapp_provedor: process.env.WHATSAPP_PROVIDER || "nao_configurado" });
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
    const ag = { id: db.contador++, codigo: codigo(), nome: b.nome, telefone: b.telefone, profissionalId: b.profissionalId, data: b.data, hora: b.hora, tipoConsulta: b.tipoConsulta || "", modalidade: localId === "online" ? "Online" : "Presencial", localId, linkMeet: "", motivo: b.motivo || "", canal: b.canal || "site", status: "aguardando", criadoEm: new Date().toISOString() };
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

  // Arquivos estáticos
  let file = path.join(PUBLIC_DIR, rota === "/" ? "index.html" : rota);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("Não encontrado"); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "text/plain" });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => console.log(`Clínica Única v1.1 em http://localhost:${PORT}`));
