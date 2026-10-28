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
carregar();
