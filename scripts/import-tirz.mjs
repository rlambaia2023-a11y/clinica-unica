// Importação Tirzepatida para a Clínica Única — código próprio, sem dependências.
// Lê os CSVs exportados do TirzTracker (Base44) e grava nas coleções
// tirz* de data/dados.json, sem misturar com os pacientes da Gineco.
// Idempotente por base44Id: rodar de novo atualiza, não duplica.
// NÃO importa created_by, created_by_id, nem o CSV de usuários como paciente.
// Foto: guarda só a referência foto_url, sem baixar nenhuma foto.
// Movimentações importadas são histórico: não alteram a quantidade do
// estoque, que vem do próprio Estoque_export.csv. Só a rota
// POST /api/tirz/movimentacoes altera o estoque, no uso do dia a dia.
//
// Uso:
//   node scripts/import-tirz.mjs [pasta-dos-csvs] [arquivo-dados.json]
// Padrões: pasta dos CSVs em TIRZ_CSV_DIR ou
//   ~/workspace/browser_downloads/sess-3264309704
//   dados em DATA_FILE ou scripts/../data/dados.json
import fs from "node:fs";
import path from "node:path";

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const csvDir = process.argv[2] || process.env.TIRZ_CSV_DIR || path.join(process.env.HOME || "", "workspace", "browser_downloads", "sess-3264309704");
const dataFile = process.argv[3] || process.env.DATA_FILE || path.join(scriptDir, "..", "data", "dados.json");

function parseCsv(texto) {
  const linhas = [];
  let linha = [], campo = "", entreAspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else entreAspas = false;
      } else campo += c;
    } else if (c === '"') entreAspas = true;
    else if (c === ",") { linha.push(campo); campo = ""; }
    else if (c === "\n") { linha.push(campo); linhas.push(linha); linha = []; campo = ""; }
    else if (c !== "\r") campo += c;
  }
  if (campo !== "" || linha.length) { linha.push(campo); linhas.push(linha); }
  const cab = (linhas.shift() || []).map((h) => h.trim());
  return linhas.filter((l) => l.some((v) => String(v).trim() !== "")).map((l) => {
    const o = {};
    cab.forEach((h, i) => { o[h] = l[i] ?? ""; });
    return o;
  });
}
function acharCsv(fragmento) {
  const arquivos = fs.existsSync(csvDir) ? fs.readdirSync(csvDir) : [];
  const achado = arquivos.find((f) => f.includes(fragmento));
  if (!achado) throw new Error(`CSV não encontrado em ${csvDir}: ${fragmento}`);
  return path.join(csvDir, achado);
}
function lerCsv(fragmento) { return parseCsv(fs.readFileSync(acharCsv(fragmento), "utf8")); }
function soDigitos(t) { return String(t || "").replace(/\D/g, ""); }
function numero(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function boolOuNulo(v) {
  if (String(v).toLowerCase() === "true") return true;
  if (String(v).toLowerCase() === "false") return false;
  return null;
}
function proximoId(db) {
  const ids = [];
  for (const chave of Object.keys(db)) {
    if (Array.isArray(db[chave])) for (const r of db[chave]) if (Number.isFinite(Number(r.id))) ids.push(Number(r.id));
  }
  const max = ids.length ? Math.max(...ids) : 0;
  if (!db.contador || db.contador <= max) db.contador = max + 1;
  return db.contador++;
}

let backup = null;
let db;
if (fs.existsSync(dataFile)) {
  const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
  backup = `${dataFile}.bak-${carimbo}`;
  fs.copyFileSync(dataFile, backup);
  db = JSON.parse(fs.readFileSync(dataFile, "utf8"));
} else {
  db = { pacientes: [], contador: 1 };
}
for (const chave of ["agendamentos", "listaEspera", "prontuarios", "usuariosProfissionais", "pacientes", "evolucoes", "anamneses", "procedimentos", "planosTratamento", "prescricoes", "tirzClientes", "tirzEstoque", "tirzMovimentacoes", "tirzPesos", "tirzFotos"]) {
  if (!Array.isArray(db[chave])) db[chave] = [];
}
const pacienteIdPorTelefone = (tel) => {
  const d = soDigitos(tel);
  if (!d) return null;
  const p = db.pacientes.find((x) => soDigitos(x.telefone) === d);
  return p ? p.id : null;
};

// Clientes Tirz — coleção separada, link opcional só por telefone exato.
const clientesCsv = lerCsv("Cliente_export");
const mapaCliente = new Map();
for (const r of clientesCsv) {
  const existente = db.tirzClientes.find((c) => c.base44Id === r.id);
  const dados = {
    base44Id: r.id, nome: r.nome, cpf: r.cpf, data_nascimento: r.data_nascimento,
    telefone: r.telefone, email: r.email, dose: r.dose, dose_inicial: r.dose_inicial,
    dose_final: r.dose_final, tipo_venda: r.tipo_venda,
    peso_inicial: numero(r.peso_inicial), peso_final: numero(r.peso_final),
    valor_mensalidade: numero(r.valor_mensalidade), data_atendimento: r.data_atendimento,
    proxima_aplicacao: r.proxima_aplicacao, data_vencimento: r.data_vencimento,
    status_pagamento: r.status_pagamento || "pendente", ativo: boolOuNulo(r.ativo),
    lembrete_ativo: boolOuNulo(r.lembrete_ativo), observacoes: r.observacoes,
  };
  if (existente) {
    Object.assign(existente, dados, { pacienteId: pacienteIdPorTelefone(r.telefone) });
    mapaCliente.set(r.id, existente.id);
  } else {
    const c = { id: proximoId(db), pacienteId: pacienteIdPorTelefone(r.telefone), ...dados, criadoEm: new Date().toISOString() };
    db.tirzClientes.push(c);
    mapaCliente.set(r.id, c.id);
  }
}

// Estoque — um item por dose, idempotente pela dose.
const estoqueCsv = lerCsv("Estoque_export");
for (const r of estoqueCsv) {
  const existente = db.tirzEstoque.find((e) => e.dose === r.dose);
  if (existente) {
    existente.quantidade = numero(r.quantidade) ?? 0;
    existente.base44Id = r.id;
  } else {
    db.tirzEstoque.push({ id: proximoId(db), base44Id: r.id, dose: r.dose, quantidade: numero(r.quantidade) ?? 0, doses_por_caixa: 4, alerta_minimo: 3, criadoEm: new Date().toISOString() });
  }
}

// Movimentações — histórico, sem alterar o estoque importado.
const movCsv = lerCsv("MovimentacaoEstoque_export");
for (const r of movCsv) {
  const dados = {
    base44Id: r.id, tirzClienteId: mapaCliente.get(r.cliente_id) || null, cliente_id: r.cliente_id || null,
    cliente_nome: r.cliente_nome || "", dose: r.dose, tipo: r.tipo, quantidade: numero(r.quantidade),
    motivo: r.motivo || "", observacao: r.observacao || "",
  };
  const existente = db.tirzMovimentacoes.find((m) => m.base44Id === r.id);
  if (existente) Object.assign(existente, dados);
  else db.tirzMovimentacoes.push({ id: proximoId(db), ...dados, criadoEm: new Date().toISOString() });
}

// Pesos.
const pesosCsv = lerCsv("HistoricoPeso_export");
for (const r of pesosCsv) {
  const dados = { base44Id: r.id, tirzClienteId: mapaCliente.get(r.cliente_id) || null, data: r.data, peso: numero(r.peso), observacao: r.observacao || "" };
  const existente = db.tirzPesos.find((p) => p.base44Id === r.id);
  if (existente) Object.assign(existente, dados);
  else db.tirzPesos.push({ id: proximoId(db), ...dados, criadoEm: new Date().toISOString() });
}

// Fotos — só a referência foto_url, sem baixar foto.
const fotosCsv = lerCsv("FotoEvolucao_export");
for (const r of fotosCsv) {
  const dados = { base44Id: r.id, tirzClienteId: mapaCliente.get(r.cliente_id) || null, semana: r.semana, nome_foto: r.nome_foto, legenda: r.legenda, foto_url: r.foto_url, data_envio: r.data_envio };
  const existente = db.tirzFotos.find((f) => f.base44Id === r.id);
  if (existente) Object.assign(existente, dados);
  else db.tirzFotos.push({ id: proximoId(db), ...dados, criadoEm: new Date().toISOString() });
}

// Usuários: contagem só para o log, nunca como paciente.
let usuariosIgnorados = 0;
try { usuariosIgnorados = lerCsv("TirzTracker-users").length; } catch { usuariosIgnorados = 0; }

fs.mkdirSync(path.dirname(dataFile), { recursive: true });
fs.writeFileSync(dataFile, JSON.stringify(db, null, 2));
console.log(`Backup: ${backup || "nenhum (arquivo de dados não existia)"}`);
console.log(`Dados: ${dataFile}`);
console.log(`tirzClientes: ${db.tirzClientes.length} (linhas no CSV: ${clientesCsv.length})`);
console.log(`tirzEstoque: ${db.tirzEstoque.length} (linhas no CSV: ${estoqueCsv.length})`);
console.log(`tirzMovimentacoes: ${db.tirzMovimentacoes.length} (linhas no CSV: ${movCsv.length})`);
console.log(`tirzPesos: ${db.tirzPesos.length} (linhas no CSV: ${pesosCsv.length})`);
console.log(`tirzFotos: ${db.tirzFotos.length} (linhas no CSV: ${fotosCsv.length})`);
console.log(`Usuários ignorados (não importados como pacientes): ${usuariosIgnorados}`);
