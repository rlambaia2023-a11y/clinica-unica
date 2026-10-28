// Clínica Única v1 — Gineco primeiro.
// Sistema próprio, código próprio, sem dependências.
// Paciente agenda, confirma, cancela e entra na lista de espera.
// Profissional vê a agenda do dia, faz check-in e registra a nota da consulta.
// Regras vigentes: pt-BR, só Gemini (nunca OpenAI), sem dado real de paciente
// nesta demonstração. Antes de usar com pacientes de verdade: login do
// profissional, volume persistente e WhatsApp oficial.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3104;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "dados.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const HORARIOS = ["08:00", "09:00", "10:00", "11:00", "14:00", "15:00", "16:00", "17:00"];

// Cache em memória para a nota por IA: mesma entrada, mesma resposta,
// sem gastar cota de novo. Em 429 o sistema para na hora, sem tentar outro modelo.
const cacheIA = new Map();
const MODELO_IA = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
// Código de acesso da área do profissional. Se PROF_CODE não estiver
// definido, a área fica aberta (modo demonstração) e o /api/health avisa.
const PROF_CODE = process.env.PROF_CODE || "";
function profOk(req, res) {
  if (!PROF_CODE) return true;
  if (req.headers["x-prof-code"] === PROF_CODE) return true;
  enviar(res, 401, { ok: false, erro: "Área do profissional: informe o código de acesso correto." });
  return false;
}

function hojeSP(dias = 0) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return fmt.format(d);
}
function codigo() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}
function seed() {
  return {
    clinica: {
      nome: "Gineco — Consultas da Dra. Mayara Miranda",
      cidade: "Maragogipe e São Félix, BA — mais consultas online",
      locais: [
        { id: "bom-doutor", nome: "Centro Médico O Bom Doutor", endereco: "Endereço a confirmar — não encontrado em busca pública na Bahia", cidade: "Bahia", status: "a_confirmar", fonte: "Informado pela clínica; endereço não localizado em 2026-10-28" },
        { id: "maraclin", nome: "Clínica Maraclin", endereco: "R. Dr. Maurício Rebouças, 118", cidade: "Maragogipe, BA", cep: "44420-000", telefone: "+55 75 99716-2346", horario: "Segunda a sexta, 06:00 às 16:00", latitude: -12.77843541, longitude: -38.91965014, status: "confirmado", fonte: "Places, place_id 2271439086574961, verificado em 2026-10-28" },
        { id: "santa-casa-sao-felix", nome: "Santa Casa de Misericórdia São Félix", endereco: "Rua Nova, 1", cidade: "São Félix, BA", cep: "44360-000", telefone: "+55 75 3425-2616", horario: "Hospital — horário a confirmar com a unidade", latitude: -12.6058098, longitude: -38.97010586, status: "confirmado", fonte: "Places, place_id 1255224395250432, verificado em 2026-10-28" },
      ],
      // WhatsApp informado em 2026-10-28. A resposta não disse se ele pode
      // aparecer na página, então fica SÓ interno (lembretes e remarcação
      // para quem já agendou). Nunca fixo no código: vem da variável
      // WHATSAPP_INTERNO. Não exibir na página pública até confirmar.
      whatsappInterno: process.env.WHATSAPP_INTERNO || "",
      telefonePublico: "a confirmar se o WhatsApp pode aparecer na página",
      modalidades: ["Presencial", "Online"],
      pagamento: "Particular",
      diasAtendimento: "Todos os dias — horários exatos e duração da consulta ainda a confirmar; a grade atual é 08:00 às 11:00 e 14:00 às 17:00, de 1 em 1 hora",
      politicaCancelamento: "sem_cancelamento",
      politicaCancelamentoTexto: "Conforme a política da clínica, não há cancelamento pela página. Para remarcar, fale pelo WhatsApp informado na sua consulta.",
      fotoAutorizada: true,
      fotoArquivo: null,
      teleconsulta: "Google Meet, gratuito. Criação automática pela conta mh.cuidarsaude@gmail.com ainda NÃO está ligada: essa conta ainda não autorizou o acesso no Google (pendência do MH Cuidar). Enquanto isso, a profissional cria o Meet grátis na conta dela e cola o link na agenda; a paciente vê o link só na própria consulta online.",
      aviso: "Demonstração. Não use com pacientes reais antes de confirmar endereço completo, dias e horários exatos, duração da consulta e link da teleconsulta, e ligar login, volume e WhatsApp oficial.",
    },
    profissionais: [
      { id: "mayara", nome: "Dra. Mayara Miranda", especialidade: "Ginecologia e Obstetrícia", descricao: "Consultas ginecológicas, pré-natal e clínica geral. Idealizadora do Gineco-AI." },
    ],
    tiposConsulta: ["Consulta ginecológica", "Pré-natal", "Clínica geral", "Outro motivo — descrever abaixo"],
    agendamentos: [],
    listaEspera: [],
    prontuarios: [],
    contador: 1,
  };
}
function carregar() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const d = seed();
    fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
    return d;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}
let db = carregar();
function salvar() { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }

function slots(profissionalId, data) {
  return HORARIOS.map((hora) => {
    const ocupado = db.agendamentos.find((a) => a.profissionalId === profissionalId && a.data === data && a.hora === hora && a.status !== "cancelado");
    return { hora, livre: !ocupado, agendamentoId: ocupado?.id || null };
  });
}

// Entender um pedido digitado ou falado, sem IA: especialidade, dia e período.
// Se faltar informação, o sistema pergunta o que falta em vez de adivinhar.
function entenderTexto(textoRaw) {
  const t = (textoRaw || "").toLowerCase();
  // Esta clínica é Gineco: só ginecologia e obstetrícia. Outro assunto não
  // é adivinhado nem encaixado em outra especialidade.
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
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const rota = url.pathname;

  if (rota === "/api/health") return enviar(res, 200, { ok: true, servico: "clinica-unica", versao: "v1", ia_configurada: Boolean(process.env.GEMINI_API_KEY), modelo_ia: MODELO_IA, cache_ia: cacheIA.size, agendamentos: db.agendamentos.length, area_profissional_protegida: Boolean(PROF_CODE) });
  if (rota === "/api/clinica") {
    // O WhatsApp interno nunca sai nesta resposta pública, mesmo que a API
    // fique exposta depois. Ele só serve para lembretes e remarcação interna.
    const { whatsappInterno, ...clinicaPublica } = db.clinica;
    return enviar(res, 200, { clinica: clinicaPublica, profissionais: db.profissionais, especialidades: [...new Set(db.profissionais.map((p) => p.especialidade))], tiposConsulta: db.tiposConsulta || [] });
  }
  if (rota === "/api/disponibilidade") {
    const prof = url.searchParams.get("profissional"), data = url.searchParams.get("data");
    if (!prof || !data) return enviar(res, 400, { ok: false, erro: "Informe profissional e data." });
    return enviar(res, 200, { ok: true, slots: slots(prof, data) });
  }
  if (rota === "/api/meus-agendamentos") {
    const tel = (url.searchParams.get("telefone") || "").replace(/\D/g, "");
    return enviar(res, 200, { ok: true, agendamentos: db.agendamentos.filter((a) => a.telefone.replace(/\D/g, "") === tel).sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora)) });
  }
  if (rota === "/api/lembretes") {
    if (!profOk(req, res)) return;
    const amanha = hojeSP(1);
    const lista = db.agendamentos.filter((a) => a.data === amanha && (a.status === "aguardando" || a.status === "confirmado"));
    return enviar(res, 200, { ok: true, data: amanha, lembretes: lista.map((a) => ({ ...a, mensagem: `Lembrete: sua consulta com ${db.profissionais.find((p) => p.id === a.profissionalId)?.nome} é amanhã, ${a.data}, às ${a.hora}. Responda para confirmar ou cancelar.` })) });
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

  if (req.method === "POST" && rota === "/api/entender") {
    const { texto } = await lerCorpo(req);
    const ent = entenderTexto(texto);
    let sugestao = null;
    if (ent.especialidade && ent.data) {
      const prof = db.profissionais.find((p) => p.especialidade.toLowerCase() === ent.especialidade);
      if (prof) {
        const livres = slots(prof.id, ent.data).filter((s) => s.livre && (!ent.periodo || (ent.periodo === "manha" ? s.hora < "12:00" : s.hora >= "12:00")));
        sugestao = { profissional: prof, horarios: livres.map((s) => s.hora) };
      }
    }
    return enviar(res, 200, { ok: true, ...ent, sugestao });
  }

  if (req.method === "POST" && rota === "/api/agendar") {
    const b = await lerCorpo(req);
    if (!b.nome || !b.telefone || !b.profissionalId || !b.data || !b.hora) return enviar(res, 400, { ok: false, erro: "Faltam nome, telefone, profissional, data ou hora." });
    if (!slots(b.profissionalId, b.data).find((s) => s.hora === b.hora && s.livre)) return enviar(res, 409, { ok: false, erro: "Esse horário já está ocupado. Entre na lista de espera que avisamos se liberar." });
    const ag = { id: db.contador++, codigo: codigo(), nome: b.nome, telefone: b.telefone, profissionalId: b.profissionalId, data: b.data, hora: b.hora, tipoConsulta: b.tipoConsulta || "", modalidade: b.modalidade || "", localId: b.localId || "", linkMeet: "", motivo: b.motivo || "", canal: b.canal || "site", status: "aguardando", criadoEm: new Date().toISOString() };
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
    // A vaga liberada vai para a primeira pessoa da lista de espera daquele horário.
    const espera = db.listaEspera.find((e) => e.profissionalId === ag.profissionalId && e.data === ag.data && e.hora === ag.hora && e.status === "aguardando");
    if (espera) { espera.status = "vaga_liberada"; }
    salvar();
    return enviar(res, 200, { ok: true, agendamento: ag, vagaLiberadaPara: espera || null });
  }
  if (req.method === "POST" && rota === "/api/lista-espera") {
    const b = await lerCorpo(req);
    if (!b.nome || !b.telefone || !b.profissionalId || !b.data || !b.hora) return enviar(res, 400, { ok: false, erro: "Faltam dados para a lista de espera." });
    const item = { id: db.contador++, ...b, status: "aguardando", criadoEm: new Date().toISOString() };
    db.listaEspera.push(item); salvar();
    return enviar(res, 201, { ok: true, item });
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
    if (!process.env.GEMINI_API_KEY) return enviar(res, 200, { ok: false, ia_disponivel: false, mensagem: "IA não configurada nesta demonstração. Configure GEMINI_API_KEY para ligar o resumo — sem chave, nenhum resumo é inventado." });
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
    // Nunca inventar um link do Meet: só aceitar um link real, no formato do Google.
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

server.listen(PORT, () => console.log(`Clínica Única v1 em http://localhost:${PORT}`));
