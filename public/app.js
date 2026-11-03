let profissionais = [], escolha = {}, ultimoTextoConfirmacao = "", clinicaInfo = "";
const $ = (id) => document.getElementById(id);
const api = (rota, metodo, corpo) => fetch(rota, { method: metodo || "GET", headers: { "Content-Type": "application/json" }, body: corpo ? JSON.stringify(corpo) : undefined }).then((r) => r.json());

document.querySelectorAll("nav button").forEach((b) => b.onclick = () => {
  document.querySelectorAll("nav button").forEach((x) => x.classList.remove("ativo"));
  b.classList.add("ativo");
  document.querySelectorAll(".aba").forEach((s) => s.classList.add("escondido"));
  $("aba-" + b.dataset.aba).classList.remove("escondido");
  if (b.dataset.aba === "profissional") atualizarAuth();
});

async function atualizarAuth() {
  const d = await api("/api/profissional/eu");
  const div = $("authProf");
  if (!div) return;
  if (d.logado) {
    div.innerHTML = `<p>Logada como <strong>${d.email}</strong>.</p><div class="linha"><button id="btnLogout" type="button">Sair</button></div>`;
    $("btnLogout").onclick = async () => { await api("/api/profissional/logout", "POST", {}); atualizarAuth(); };
  } else if (!d.temConta) {
    div.innerHTML = `<p><strong>Criar a primeira conta profissional</strong> (só aparece uma vez, até a primeira conta existir):</p><div class="linha"><input id="authEmail" type="email" placeholder="E-mail da profissional"><input id="authSenha" type="password" placeholder="Senha (mínimo 8 caracteres)"><button id="btnCadastro" type="button">Criar conta</button></div><p id="authMsg" class="resposta"></p>`;
    $("btnCadastro").onclick = async () => {
      const r = await api("/api/profissional/cadastro", "POST", { email: $("authEmail").value, senha: $("authSenha").value });
      $("authMsg").textContent = r.ok ? r.mensagem : r.erro;
      if (r.ok) atualizarAuth();
    };
  } else {
    div.innerHTML = `<p><strong>Entrar na área do profissional:</strong></p><div class="linha"><input id="authEmail" type="email" placeholder="E-mail"><input id="authSenha" type="password" placeholder="Senha"><button id="btnLogin" type="button">Entrar</button></div><p id="authMsg" class="resposta"></p>`;
    $("btnLogin").onclick = async () => {
      const r = await api("/api/profissional/login", "POST", { email: $("authEmail").value, senha: $("authSenha").value });
      $("authMsg").textContent = r.ok ? `Bem-vinda, ${r.email}.` : r.erro;
      if (r.ok) atualizarAuth();
    };
  }
}

function datasProximas() {
  const sel = $("selData"); sel.innerHTML = "";
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const opt = document.createElement("option"); opt.value = iso;
    opt.textContent = d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
    sel.appendChild(opt);
  }
  $("agendaData").value = new Date().toISOString().slice(0, 10);
}

async function carregar() {
  const d = await api("/api/clinica");
  profissionais = d.profissionais;
  clinicaInfo = d.clinica;
  $("nomeClinica").textContent = d.clinica.nome;
  $("avisoClinica").textContent = d.clinica.aviso;
  $("infoClinica").textContent = `Atendimento: ${(d.clinica.modalidades || []).join(" e ")}. Pagamento: ${d.clinica.pagamento || ""}. Consultas de ${d.duracaoMinutos || 60} minutos. ${d.clinica.politicaCancelamentoTexto || ""}`;
  $("filtroEsp").innerHTML = '<option value="">Todas</option>' + d.especialidades.map((e) => `<option>${e}</option>`).join("");
  $("tipoConsulta").innerHTML = (d.tiposConsulta || []).map((t) => `<option>${t}</option>`).join("");
  $("listaLocais").innerHTML = (d.clinica.locais || []).map((l) => `<div class="card"><strong>${l.nome}</strong><br>${l.endereco} — ${l.cidade}${l.cep ? ", CEP " + l.cep : ""}<br>${l.telefone ? "Tel: " + l.telefone + "<br>" : ""}${l.horario || ""}<br><em>${l.status === "confirmado" ? "Endereço verificado" : "Endereço a confirmar"}</em></div>`).join("");
  $("localId").innerHTML = (d.clinica.locais || []).map((l) => `<option value="${l.id}" ${l.reservavel ? "" : "disabled"}>${l.nome}${l.reservavel ? "" : " (endereço a confirmar — em breve)"}</option>`).join("") + '<option value="online">Online (Google Meet)</option>';
  $("localId").value = "online";
  $("agendaProf").innerHTML = profissionais.map((p) => `<option value="${p.id}">${p.nome} — ${p.especialidade}</option>`).join("");
  renderProfissionais();
  datasProximas();
  carregarSlots();
  atualizarAuth();
}
function renderProfissionais() {
  const filtro = $("filtroEsp").value;
  const lista = profissionais.filter((p) => !filtro || p.especialidade === filtro);
  $("listaProfissionais").innerHTML = lista.map((p) => `<div class="card ${escolha.profissionalId === p.id ? "selecionado" : ""}" data-id="${p.id}"><strong>${p.nome}</strong><br>${p.especialidade}<br>${p.descricao}</div>`).join("");
  document.querySelectorAll(".card").forEach((c) => c.onclick = () => { escolha.profissionalId = c.dataset.id; renderProfissionais(); carregarSlots(); atualizarEscolha(); });
}
async function carregarSlots() {
  if (!escolha.profissionalId) { escolha.profissionalId = profissionais[0]?.id; renderProfissionais(); }
  escolha.data = $("selData").value;
  escolha.localId = $("localId").value || "online";
  const d = await api(`/api/disponibilidade?profissional=${escolha.profissionalId}&data=${escolha.data}&local=${encodeURIComponent(escolha.localId)}`);
  if (d.motivo) { $("slots").innerHTML = `<p>${d.motivo}</p>`; atualizarEscolha(); return; }
  $("slots").innerHTML = (d.slots || []).map((s) => `<button type="button" class="${s.livre ? "livre" : "ocupado"}" ${s.livre ? "" : "disabled"} data-hora="${s.hora}">${s.hora} — ${s.livre ? "livre" : "ocupado"}</button>`).join("") || "<p>Sem atendimento neste dia neste local. Escolha outro dia ou outro local.</p>";
  document.querySelectorAll(".slots button.livre").forEach((b) => b.onclick = () => { escolha.hora = b.dataset.hora; atualizarEscolha(); });
  atualizarEscolha();
}
function atualizarEscolha() {
  const prof = profissionais.find((p) => p.id === escolha.profissionalId);
  $("escolha").textContent = prof && escolha.data && escolha.hora ? `${prof.nome}, ${escolha.data}, às ${escolha.hora}` : "nenhum ainda";
}
$("filtroEsp").onchange = renderProfissionais;
$("selData").onchange = carregarSlots;
$("localId").onchange = carregarSlots;

$("btnEntender").onclick = async () => {
  const d = await api("/api/entender", "POST", { texto: $("textoLivre").value });
  if (d.faltando.length) { $("respostaTexto").textContent = `Faltou informar ${d.faltando.join(" e ")}. Me diz esses dados que eu já mostro os horários.`; return; }
  const prof = d.sugestao?.profissional;
  $("respostaTexto").textContent = prof ? `Entendi: ${d.tipoConsulta || prof.especialidade} com ${prof.nome} em ${d.data}. Horários livres: ${d.sugestao.horarios.join(", ") || "nenhum neste dia"}. Escolha um acima para confirmar.` : "Esta clínica é Gineco: ginecologia e obstetrícia. Me diz se é consulta ginecológica ou pré-natal, e o dia.";
  if (prof) { escolha.profissionalId = prof.id; if (d.tipoConsulta) $("tipoConsulta").value = d.tipoConsulta; $("selData").value = d.data; renderProfissionais(); carregarSlots(); }
};

$("formAgendar").onsubmit = async (e) => {
  e.preventDefault();
  const d = await api("/api/agendar", "POST", { nome: $("nome").value, telefone: $("telefone").value, tipoConsulta: $("tipoConsulta").value, localId: $("localId").value, motivo: $("motivo").value, profissionalId: escolha.profissionalId, data: escolha.data, hora: escolha.hora, canal: "site" });
  if (!d.ok) { $("resultadoAgendar").textContent = d.erro; return; }
  const prof = profissionais.find((p) => p.id === d.agendamento.profissionalId);
  ultimoTextoConfirmacao = `Agendamento confirmado com ${prof.nome}, dia ${d.agendamento.data}, às ${d.agendamento.hora}. Seu código é ${d.agendamento.codigo}.`;
  $("resultadoAgendar").textContent = ultimoTextoConfirmacao + " Guarde o número do agendamento: " + d.agendamento.id;
  carregarSlots();
};
$("btnEspera").onclick = async () => {
  const d = await api("/api/lista-espera", "POST", { nome: $("nome").value, telefone: $("telefone").value, profissionalId: escolha.profissionalId, data: escolha.data, hora: escolha.hora, localId: $("localId").value });
  $("resultadoAgendar").textContent = d.ok ? "Você entrou na lista de espera. Se esse horário liberar, você é avisado primeiro." : d.erro;
};
$("btnCalc").onclick = async () => {
  const d = await api("/api/calculadora-gestacional", "POST", { dum: $("dum").value });
  $("resultadoCalc").textContent = d.ok ? `Idade gestacional: ${d.idadeGestacional}. Data provável do parto: ${d.dataProvavelParto}. ${d.aviso}` : d.erro;
};
$("btnOuvir").onclick = () => {
  if (!ultimoTextoConfirmacao) { alert("Faça um agendamento primeiro para ouvir a confirmação."); return; }
  const fala = new SpeechSynthesisUtterance(ultimoTextoConfirmacao); fala.lang = "pt-BR"; speechSynthesis.speak(fala);
};

$("btnBuscar").onclick = async () => {
  const d = await api(`/api/meus-agendamentos?telefone=${encodeURIComponent($("buscaTel").value)}`);
  $("listaMeus").innerHTML = (d.agendamentos || []).map((a) => {
    const prof = profissionais.find((p) => p.id === a.profissionalId);
    const botaoCancelar = clinicaInfo.politicaCancelamento === "sem_cancelamento" ? `<br>${clinicaInfo.politicaCancelamentoTexto}` : ` <button onclick="acao(${a.id},'cancelar')">Cancelar</button>`;
    const meet = a.modalidade === "Online" ? (a.linkMeet ? `<br><a href="${a.linkMeet}" target="_blank" rel="noopener">Entrar na teleconsulta (Google Meet)</a>` : `<br>O link do Google Meet aparece aqui antes da consulta.`) : "";
    const local = (clinicaInfo.locais || []).find((l) => l.id === a.localId)?.nome || (a.localId === "online" ? "Online" : "");
    return `<div class="item"><strong>${prof?.nome}</strong> — ${a.tipoConsulta || ""} — ${a.modalidade || ""} — ${local} — ${a.data} às ${a.hora} — ${a.status}<br>Código: ${a.codigo} · Agendamento nº ${a.id}${meet}<br><button onclick="acao(${a.id},'confirmar')">Confirmar</button>${botaoCancelar}</div>`;
  }).join("") || "<p>Nenhuma consulta encontrada para esse WhatsApp.</p>";
};
window.acao = async (id, tipo) => {
  const d = await api(`/api/${tipo}`, "POST", { id });
  alert(d.ok ? (tipo === "cancelar" && d.vagaLiberadaPara ? "Cancelado. A vaga foi liberada para a primeira pessoa da lista de espera." : "Pronto!") : d.erro);
  $("btnBuscar").click();
};
async function carregarLembretesProf() {
  const d = await api("/api/lembretes");
  if (!d.ok) { $("listaLembretesProf").innerHTML = `<p>${d.erro}</p>`; return; }
  $("listaLembretesProf").innerHTML = (d.lembretes || []).map((a) => `<div class="item">${a.mensagem}</div>`).join("") || "<p>Nenhum lembrete para amanhã no momento.</p>";
}
$("btnVerLembretes").onclick = carregarLembretesProf;
$("btnEnviarLembretes").onclick = async () => {
  const d = await api("/api/lembretes/enviar", "POST", {});
  if (!d.ok) { $("resultadoLembretes").textContent = d.erro; return; }
  $("resultadoLembretes").textContent = (d.resultados || []).length ? (d.resultados || []).map((r) => `${r.nome}: ${r.enviado ? "enviado pelo WhatsApp" : "não enviado — " + r.motivo}`).join(" | ") : "Nenhum lembrete pendente para amanhã.";
};
$("btnAgenda").onclick = async () => {
  const d = await api(`/api/agenda?profissional=${$("agendaProf").value}&data=${$("agendaData").value}`);
  if (!d.ok) { $("listaAgenda").innerHTML = `<p>${d.erro}</p>`; return; }
  $("listaAgenda").innerHTML = (d.agenda || []).map((a) => {
    const meet = a.modalidade === "Online" ? (a.linkMeet ? `<br><a href="${a.linkMeet}" target="_blank" rel="noopener">Abrir Google Meet</a>` : `<br><button onclick="colarMeet(${a.id})">Colar link do Google Meet</button>`) : "";
    return `<div class="item"><strong>${a.hora} — ${a.nome}</strong> (${a.telefone}) — ${a.tipoConsulta || ""} — ${a.modalidade || ""} — ${a.status}<br>${a.motivo || ""}${meet}<br><button onclick="checkin(${a.id})">Check-in: chegou</button></div>`;
  }).join("") || "<p>Nenhuma consulta neste dia.</p>";
};
window.checkin = async (id) => { const d = await api("/api/checkin", "POST", { id }); alert(d.ok ? "Check-in registrado." : d.erro); $("btnAgenda").click(); };
window.colarMeet = async (id) => {
  const linkMeet = prompt("Cole o link do Google Meet desta consulta (começando por https://meet.google.com/):");
  if (!linkMeet) return;
  const d = await api("/api/teleconsulta", "POST", { id, linkMeet });
  alert(d.ok ? "Link do Meet salvo. A paciente já vê o link na própria consulta." : d.erro);
  $("btnAgenda").click();
};
$("btnNotaIA").onclick = async () => {
  const d = await api("/api/nota-ia", "POST", { texto: $("textoConsulta").value });
  $("resumoIA").textContent = d.ok ? (d.cache ? "[reaproveitado do cache] " : "") + d.resumo : (d.mensagem || d.erro);
};
$("btnSalvarNota").onclick = async () => {
  const d = await api("/api/prontuario", "POST", { agendamentoId: $("notaAgId").value, nota: $("resumoIA").textContent, origem: "profissional+ia" });
  $("resultadoNota").textContent = d.ok ? "Nota salva no prontuário, já revisada pelo profissional." : d.erro;
};
let pacienteSelecionado = null;
let listaPacientesCache = [];
async function carregarPacientes() {
  const d = await api(`/api/pacientes?busca=${encodeURIComponent($("buscaPaciente").value || "")}`);
  if (!d.ok) { $("listaPacientes").innerHTML = `<p>${d.erro}</p>`; return; }
  listaPacientesCache = d.pacientes || [];
  $("prescPaciente").innerHTML = listaPacientesCache.map((p) => `<option value="${p.id}">${p.nome} — ${p.telefone}</option>`).join("") || "<option value=''>Nenhum paciente ainda</option>";
  $("listaPacientes").innerHTML = listaPacientesCache.map((p) => `<div class="item"><strong>${p.nome}</strong> — ${p.telefone}${p.email ? " — " + p.email : ""}<br>${p.totalAgendamentos} consulta(s) · ${p.totalPrescricoes} documento(s)<br><button onclick="abrirProntuario(${p.id})">Abrir prontuário</button></div>`).join("") || "<p>Nenhum paciente cadastrado ainda.</p>";
}
window.abrirProntuario = async (id) => {
  const d = await api(`/api/pacientes/${id}`);
  if (!d.ok) { alert(d.erro); return; }
  pacienteSelecionado = d.paciente;
  $("pacienteSelecionadoTexto").textContent = `Paciente selecionado: ${d.paciente.nome} — ${d.paciente.telefone}`;
  const sec = (titulo, itens) => `<h3>${titulo}</h3>` + (itens.length ? itens.map((x) => `<div class="item">${x.data ? x.data + " — " : ""}${[x.titulo, x.nome, x.texto, x.descricao, x.etapas, x.queixa, x.historia, x.antecedentes, x.alergias, x.medicamentosUso, x.itens].filter(Boolean).join(" · ")}</div>`).join("") : "<p>Nenhum registro.</p>");
  $("detalhePaciente").innerHTML =
    `<p><strong>${d.paciente.nome}</strong> — ${d.paciente.telefone} — ${d.paciente.email || "sem e-mail"} — nascimento: ${d.paciente.dataNascimento || "não informado"}<br>${d.paciente.observacoes || ""}</p>` +
    sec("Consultas", d.agendamentos, "") + sec("Evoluções", d.evolucoes, "") + sec("Anamneses", d.anamneses, "") + sec("Procedimentos", d.procedimentos, "") + sec("Planos de tratamento", d.planosTratamento, "") + sec("Documentos prescritos", d.prescricoes, "");
  $("prescPaciente").value = String(id);
  carregarPrescricoes();
};
async function carregarPrescricoes() {
  const pid = $("prescPaciente").value;
  if (!pid) { $("listaPrescricoes").innerHTML = ""; return; }
  const d = await api(`/api/prescricoes?pacienteId=${pid}`);
  $("listaPrescricoes").innerHTML = (d.prescricoes || []).map((r) => `<div class="item"><strong>${r.tipo}</strong> — ${r.data}<br>${r.titulo}<br>${r.texto}<br>${r.itens ? "Itens: " + r.itens : ""}<br><button onclick="window.print()">Imprimir esta página</button></div>`).join("") || "<p>Nenhum documento para este paciente ainda.</p>";
}
$("btnResumo").onclick = async () => {
  const d = await api("/api/profissional/resumo");
  if (!d.ok) { $("listaResumo").innerHTML = `<p>${d.erro}</p>`; return; }
  $("listaResumo").innerHTML = `<p>Pacientes: ${d.totalPacientes} · Hoje: ${d.hojeTotal} consulta(s) · Amanhã: ${d.amanhaTotal} consulta(s)</p>` + (d.proximos || []).map((a) => `<div class="item"><strong>${a.data} às ${a.hora} — ${a.nome}</strong> (${a.telefone}) — ${a.tipoConsulta || ""} — ${a.status}</div>`).join("");
  carregarPacientes();
};
$("formPaciente").onsubmit = async (e) => {
  e.preventDefault();
  const d = await api("/api/pacientes", "POST", { nome: $("pacNome").value, telefone: $("pacTelefone").value, email: $("pacEmail").value, dataNascimento: $("pacNascimento").value, observacoes: $("pacObs").value });
  $("resultadoPaciente").textContent = d.ok ? (d.mensagem || "Paciente salvo.") : d.erro;
  if (d.ok) carregarPacientes();
};
$("btnBuscarPaciente").onclick = carregarPacientes;
function precisaPaciente() { if (!pacienteSelecionado) { $("resultadoProntuario").textContent = "Abra o prontuário de um paciente primeiro, na lista acima."; return false; } return true; }
$("formEvolucao").onsubmit = async (e) => { e.preventDefault(); if (!precisaPaciente()) return; const d = await api(`/api/pacientes/${pacienteSelecionado.id}/evolucoes`, "POST", { texto: $("evoTexto").value }); $("resultadoProntuario").textContent = d.ok ? "Evolução salva." : d.erro; if (d.ok) abrirProntuario(pacienteSelecionado.id); };
$("formAnamnese").onsubmit = async (e) => { e.preventDefault(); if (!precisaPaciente()) return; const d = await api(`/api/pacientes/${pacienteSelecionado.id}/anamneses`, "POST", { queixa: $("anaQueixa").value, historia: $("anaHistoria").value, antecedentes: $("anaAntecedentes").value, alergias: $("anaAlergias").value, medicamentosUso: $("anaMedicamentos").value }); $("resultadoProntuario").textContent = d.ok ? "Anamnese salva." : d.erro; if (d.ok) abrirProntuario(pacienteSelecionado.id); };
$("formProcedimento").onsubmit = async (e) => { e.preventDefault(); if (!precisaPaciente()) return; const d = await api(`/api/pacientes/${pacienteSelecionado.id}/procedimentos`, "POST", { nome: $("procNome").value, descricao: $("procDescricao").value, data: $("procData").value }); $("resultadoProntuario").textContent = d.ok ? "Procedimento salvo." : d.erro; if (d.ok) abrirProntuario(pacienteSelecionado.id); };
$("formPlano").onsubmit = async (e) => { e.preventDefault(); if (!precisaPaciente()) return; const d = await api(`/api/pacientes/${pacienteSelecionado.id}/planos`, "POST", { titulo: $("planoTitulo").value, etapas: $("planoEtapas").value }); $("resultadoProntuario").textContent = d.ok ? "Plano salvo." : d.erro; if (d.ok) abrirProntuario(pacienteSelecionado.id); };
$("formPrescrever").onsubmit = async (e) => {
  e.preventDefault();
  const d = await api("/api/prescrever", "POST", { pacienteId: $("prescPaciente").value, tipo: $("prescTipo").value, titulo: $("prescTitulo").value, texto: $("prescTexto").value, itens: $("prescItens").value });
  $("resultadoPrescrever").textContent = d.ok ? `${d.prescricao.tipo} salvo para o paciente.` : d.erro;
  if (d.ok) carregarPrescricoes();
};
$("prescPaciente").onchange = carregarPrescricoes;

// ---- Módulo Tirzepatida, só dentro da área do profissional ----
function tirzEsc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
$("btnTirzResumo").onclick = async () => {
  const d = await api("/api/tirz/resumo");
  if (!d.ok) { $("listaTirzResumo").innerHTML = `<p>${tirzEsc(d.erro)}</p>`; return; }
  const r = d.resumo;
  $("listaTirzResumo").innerHTML = `<p>Clientes: ${r.totalClientes} · Ativos: ${r.clientesAtivos} · Pagamento pendente: ${r.pagamentoPendente} · Pago: ${r.pagamentoPago} · Movimentações: ${r.totalMovimentacoes} · Pesos: ${r.totalPesos} · Fotos: ${r.totalFotos}</p><p>Estoque baixo (quantidade até 3): ${(r.estoqueBaixo || []).map((e) => `${tirzEsc(e.dose)}: ${e.quantidade}`).join(", ") || "nenhum"}</p><p>Próximas aplicações em 30 dias: ${r.proximasAplicacoes.length} · Vencimentos em 30 dias: ${r.vencimentosProximos.length}</p>`;
};
$("btnTirzEstoque").onclick = async () => {
  const d = await api("/api/tirz/estoque");
  if (!d.ok) { $("listaTirzEstoque").innerHTML = `<p>${tirzEsc(d.erro)}</p>`; return; }
  $("listaTirzEstoque").innerHTML = (d.estoque || []).map((e) => `<div class="item"><strong>${tirzEsc(e.dose)}</strong> — ${e.quantidade} dose(s)${e.estoqueBaixo ? " — <strong>estoque baixo</strong>" : ""}</div>`).join("") || "<p>Sem estoque cadastrado.</p>";
};
$("btnTirzRelatorios").onclick = async () => {
  const d = await api("/api/tirz/relatorios");
  if (!d.ok) { $("listaTirzRelatorios").innerHTML = `<p>${tirzEsc(d.erro)}</p>`; return; }
  const r = d.relatorio;
  $("listaTirzRelatorios").innerHTML = `<p>Clientes: ${r.totalClientes} · Ativos: ${r.clientesAtivos} · Pendente: ${r.pagamentoPendente} · Pago: ${r.pagamentoPago}</p><p>Mensalidades ativas: R$ ${Number(r.mensalidadesAtivas || 0).toFixed(2).replace(".", ",")}</p><p>${tirzEsc(r.avisoMensalidades)}</p><p>Por dose: ${Object.entries(r.porDose || {}).map(([k, v]) => `${tirzEsc(k)}: ${v}`).join(", ") || "—"}</p><p>Movimentações: ${r.totalMovimentacoes} · Entradas: ${r.entradas} · Saídas: ${r.saidas}</p>`;
};
async function carregarTirzClientes() {
  const q = new URLSearchParams({ busca: $("tirzBusca").value || "", status: $("tirzStatus").value || "", dose: $("tirzDose").value || "" }).toString();
  const d = await api(`/api/tirz/clientes?${q}`);
  if (!d.ok) { $("listaTirzClientes").innerHTML = `<p>${tirzEsc(d.erro)}</p>`; return; }
  $("listaTirzClientes").innerHTML = (d.clientes || []).map((c) => `<div class="item"><strong>${tirzEsc(c.nome)}</strong> — ${tirzEsc(c.telefone)} — dose: ${tirzEsc(c.dose_final || c.dose || "—")} — ${tirzEsc(c.status_pagamento || "—")} — próxima aplicação: ${tirzEsc(c.proxima_aplicacao || "—")}<br><button onclick="abrirTirzCliente(${c.id})">Abrir detalhe</button></div>`).join("") || "<p>Nenhum cliente Tirzepatida encontrado.</p>";
}
$("btnBuscarTirz").onclick = carregarTirzClientes;
window.abrirTirzCliente = async (id) => {
  const d = await api(`/api/tirz/clientes/${id}`);
  if (!d.ok) { alert(d.erro); return; }
  const c = d.cliente;
  $("detalheTirzCliente").innerHTML = `<h3>${tirzEsc(c.nome)}</h3><p>Telefone: ${tirzEsc(c.telefone)} · E-mail: ${tirzEsc(c.email || "—")} · CPF: ${tirzEsc(c.cpf || "—")} · Nascimento: ${tirzEsc(c.data_nascimento || "—")}<br>Dose inicial: ${tirzEsc(c.dose_inicial || "—")} · Dose atual: ${tirzEsc(c.dose_final || c.dose || "—")} · Peso inicial: ${c.peso_inicial ?? "—"} · Peso atual: ${c.peso_final ?? "—"}<br>Mensalidade: ${c.valor_mensalidade ?? "—"} · Atendimento: ${tirzEsc(c.data_atendimento || "—")} · Próxima aplicação: ${tirzEsc(c.proxima_aplicacao || "—")} · Vencimento: ${tirzEsc(c.data_vencimento || "—")} · Pagamento: ${tirzEsc(c.status_pagamento || "—")}<br>${tirzEsc(c.observacoes || "")}</p>` +
    `<h4>Pesos</h4>` + ((d.pesos || []).map((p) => `<div class="item">${tirzEsc(p.data)} — ${p.peso} kg${p.observacao ? " — " + tirzEsc(p.observacao) : ""}</div>`).join("") || "<p>Nenhum peso registrado.</p>") +
    `<h4>Movimentações</h4>` + ((d.movimentacoes || []).map((m) => `<div class="item">${tirzEsc(m.tipo)} — ${tirzEsc(m.dose)} — ${m.quantidade} — ${tirzEsc(m.motivo || "")}</div>`).join("") || "<p>Nenhuma movimentação deste cliente.</p>") +
    `<h4>Fotos</h4>` + ((d.fotos || []).map((f) => `<div class="item">${tirzEsc(f.semana || "")} — ${tirzEsc(f.nome_foto || "")} — referência: ${tirzEsc(f.foto_url || "")} — ${tirzEsc(f.data_envio || "")}</div>`).join("") || "<p>Nenhuma foto registrada.</p>");
};
$("formTirzCliente").onsubmit = async (e) => {
  e.preventDefault();
  const d = await api("/api/tirz/clientes", "POST", { nome: $("tirzNome").value, telefone: $("tirzTelefone").value, cpf: $("tirzCpf").value, email: $("tirzEmail").value, dose_final: $("tirzDoseFinal").value, dose: $("tirzDoseFinal").value, proxima_aplicacao: $("tirzProxima").value, data_vencimento: $("tirzVencimento").value, valor_mensalidade: $("tirzMensalidade").value ? Number($("tirzMensalidade").value) : null });
  $("resultadoTirzCliente").textContent = d.ok ? "Cliente Tirzepatida salvo." : d.erro;
  if (d.ok) carregarTirzClientes();
};
$("formTirzPeso").onsubmit = async (e) => {
  e.preventDefault();
  const d = await api("/api/tirz/pesos", "POST", { tirzClienteId: $("tirzPesoClienteId").value, data: $("tirzPesoData").value, peso: Number($("tirzPesoValor").value), observacao: $("tirzPesoObs").value });
  $("resultadoTirzPeso").textContent = d.ok ? "Peso salvo." : d.erro;
};
$("formTirzMovimentacao").onsubmit = async (e) => {
  e.preventDefault();
  const d = await api("/api/tirz/movimentacoes", "POST", { dose: $("tirzMovDose").value, tipo: $("tirzMovTipo").value, quantidade: Number($("tirzMovQtd").value), tirzClienteId: $("tirzMovClienteId").value || null, motivo: $("tirzMovMotivo").value });
  $("resultadoTirzMov").textContent = d.ok ? `Movimentação salva. Estoque de ${d.estoque.dose}: ${d.estoque.quantidade}.` : d.erro;
  if (d.ok) $("btnTirzEstoque").click();
};
// Importação Tirz por CSV: parser próprio, sem dependência, com aspas,
// vírgula dentro de aspas, aspas duplas escapadas e quebra de linha
// dentro de campo. Só importa ao clicar em importar; o resultado mostra
// contagens e erros, nunca nomes de pacientes.
function tirzParseCsv(texto) {
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
function tirzLerCsv(arquivo) {
  return new Promise((resolve, reject) => {
    if (!arquivo) { resolve([]); return; }
    const leitor = new FileReader();
    leitor.onload = () => { try { resolve(tirzParseCsv(String(leitor.result))); } catch (e) { reject(e); } };
    leitor.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    leitor.readAsText(arquivo);
  });
}
$("formTirzImportar").onsubmit = async (e) => {
  e.preventDefault();
  const resultado = $("resultadoTirzImportar");
  resultado.textContent = "Lendo os CSVs...";
  try {
    const clientesCsv = await tirzLerCsv($("tirzCsvCliente").files[0]);
    const estoqueCsv = await tirzLerCsv($("tirzCsvEstoque").files[0]);
    const movCsv = await tirzLerCsv($("tirzCsvMovimentacao").files[0]);
    const pesosCsv = await tirzLerCsv($("tirzCsvPeso").files[0]);
    const fotosCsv = await tirzLerCsv($("tirzCsvFoto").files[0]);
    const payload = {
      clientes: clientesCsv.map((r) => ({ base44Id: r.id, nome: r.nome, cpf: r.cpf, data_nascimento: r.data_nascimento, telefone: r.telefone, email: r.email, dose: r.dose, dose_inicial: r.dose_inicial, dose_final: r.dose_final, tipo_venda: r.tipo_venda, peso_inicial: r.peso_inicial, peso_final: r.peso_final, valor_mensalidade: r.valor_mensalidade, data_atendimento: r.data_atendimento, proxima_aplicacao: r.proxima_aplicacao, data_vencimento: r.data_vencimento, status_pagamento: r.status_pagamento, ativo: r.ativo, lembrete_ativo: r.lembrete_ativo, observacoes: r.observacoes })),
      estoque: estoqueCsv.map((r) => ({ base44Id: r.id, dose: r.dose, quantidade: r.quantidade })),
      movimentacoes: movCsv.map((r) => ({ base44Id: r.id, cliente_id: r.cliente_id, cliente_nome: r.cliente_nome, dose: r.dose, tipo: r.tipo, quantidade: r.quantidade, motivo: r.motivo, observacao: r.observacao })),
      pesos: pesosCsv.map((r) => ({ base44Id: r.id, cliente_id: r.cliente_id, data: r.data, peso: r.peso, observacao: r.observacao })),
      fotos: fotosCsv.map((r) => ({ base44Id: r.id, cliente_id: r.cliente_id, semana: r.semana, nome_foto: r.nome_foto, legenda: r.legenda, foto_url: r.foto_url, data_envio: r.data_envio })),
    };
    const d = await api("/api/tirz/importar", "POST", payload);
    if (!d.ok) { resultado.textContent = d.erro; return; }
    resultado.textContent = `Importação concluída. Clientes: ${d.clientes} · Estoque: ${d.estoque} · Movimentações: ${d.movimentacoes} · Pesos: ${d.pesos} · Fotos: ${d.fotos}${d.backup ? ` · Backup: ${d.backup}` : ""}.`;
    carregarTirzClientes();
  } catch (err) {
    resultado.textContent = "Não foi possível ler um dos CSVs. Confira o arquivo e tente de novo.";
  }
};
async function carregarLocaisProf() {
  const d = await api("/api/clinica");
  const locais = d.clinica?.locais || [];
  $("listaLocaisProf").innerHTML = locais.map((l) => `<div class="item"><strong>${l.nome}</strong><br>${l.endereco}${l.cidade ? " — " + l.cidade : ""}<br>${l.reservavel ? "Disponível para reserva" : "Não disponível para reserva"}</div>`).join("") || "<p>Nenhum local cadastrado ainda.</p>";
}
$("btnVerLocais").onclick = carregarLocaisProf;
$("formLocal").onsubmit = async (e) => {
  e.preventDefault();
  const d = await api("/api/locais", "POST", { nome: $("localNome").value, endereco: $("localEndereco").value, cidade: $("localCidade").value, cep: $("localCep").value, telefone: $("localTelefone").value, horario: $("localHorario").value, reservavel: $("localReservavel").checked });
  $("resultadoLocal").textContent = d.ok ? `Local "${d.local.nome}" salvo. Ele já aparece na lista pública e na escolha de local do agendamento.` : d.erro;
  if (d.ok) { carregar(); carregarLocaisProf(); }
};
carregar();
