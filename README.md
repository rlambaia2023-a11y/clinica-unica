# Clínica Única v1.1 — modo real — Gineco primeiro

Sistema próprio, em português, sem copiar código, visual ou marca do Doctoralia.
Só as funções públicas foram analisadas e refeitas do zero, com melhorias.
Versionado localmente (git) e publicado em 2026-10-28.

- GitHub: https://github.com/rlambaia2023-a11y/clinica-unica
- Railway: projeto `clinica-unica`, serviço `clinica-unica`,
  https://clinica-unica-production.up.railway.app/
  Volume `clinica-unica-volume` em /app/data, variáveis DATA_DIR=/app/data
  e GEMINI_MODEL=gemini-3.5-flash-lite. Verificado ao vivo: página 200,
  /api/health ok:true, área do profissional protegida por login.

A v1.1 saiu da demonstração: login do profissional com senha
criptografada, grade real por local, volume persistente na Railway e
envio de lembrete por WhatsApp com status honesto (o código está pronto;
o envio só acontece com provedor e credenciais configurados).

PENDENTE antes de divulgar para pacientes: criar a primeira conta
profissional na própria página (aba Área do profissional) e definir
GEMINI_API_KEY e as variáveis do WhatsApp na Railway.

## Rodar e publicar

Local:

```bash
node server.mjs
# http://localhost:3104
```

Variáveis (veja `.env.example`):

- `PORT`, `DATA_DIR` (na Railway: `/app/data`, com volume anexado)
- `GEMINI_API_KEY` (opcional; sem ela, a nota por IA avisa e não inventa resumo)
- `WHATSAPP_PROVIDER` (meta ou callmebot) + credenciais do provedor
  escolhido: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TEMPLATE`
  (oficial) ou `WHATSAPP_APIKEY` (CallMeBot). Sem provedor, o botão de
  envio de lembretes devolve "não enviado" com o motivo, sem fingir envio.
- `WHATSAPP_INTERNO` (só interno; nunca fixo no código e nunca devolvido
  pela API pública)

Deploy na Railway: Dockerfile + `railway.json` já prontos, serviço a partir
deste código, volume em `/app/data` com `DATA_DIR=/app/data`. Sem volume,
um redeploy apaga os agendamentos.

Login do profissional (v1.1, sem código compartilhado): a primeira conta
é criada na própria página, na aba Área do profissional, uma única vez;
depois o cadastro fecha e só o login funciona. A senha é guardada com
scrypt (sal + hash), nunca em texto aberto, e a sessão dura 12 horas
por cookie HttpOnly. Sem conta criada, a área fica fechada (401), o que
é o comportamento certo no modo real.

Primeira clínica: **Gineco — Consultas da Dra. Mayara Miranda**
(ginecologia e obstetrícia, Centro Médico O Bom Doutor e consultas online).
O Gineco-AI continua separado, com protocolos, calculadoras completas e
busca inteligente; aqui fica a camada de agendamento da clínica.

## Rodar localmente

```bash
node server.mjs
# abre http://localhost:3104
```

Sem dependências para instalar. Os dados ficam em `data/dados.json`.
Para persistir no Railway depois, rode com `DATA_DIR=/app/data` e volume
anexado — sem volume, um redeploy apaga os dados, como já acontece no
fbbrmuseia.

## O que a v1 já faz (e o Doctoralia também faz)

- Busca dentro da clínica por especialidade e profissional
- Agenda online com dia e hora livres, presencial por enquanto
- Paciente confirma, remarca na prática cancelando e marcando de novo, e cancela
- Lembrete da consulta de amanhã (lista pronta para envio)
- Área do profissional com agenda do dia e check-in de chegada
- Perfil do profissional com especialidade e descrição

## O que a v1 já faz melhor

1. **Agendar falando ou digitando** — “ginecologia amanhã de manhã” vira
   sugestão de horários. Se faltar especialidade ou dia, o sistema pergunta
   o que falta em vez de adivinhar.
2. **Lista de espera que preenche a falta** — ao cancelar, a primeira pessoa
   da lista daquele horário fica marcada como “vaga liberada”.
3. **Confirmação em voz alta** — botão “Ouvir confirmação” lê o agendamento
   em pt-BR, útil para quem não enxerga bem a tela ou prefere ouvir.
4. **Nota da consulta com IA só para organizar** — só Gemini, modelo Lite
   por padrão (`GEMINI_MODEL`, padrão `gemini-3.5-flash-lite`), cache de
   texto idêntico e parada imediata em 429, sem tentar outro modelo.
   Sem chave, nenhum resumo é inventado: o sistema avisa que a IA não
   está configurada. A nota só vira prontuário depois de revisão do
   profissional.
5. **Botões grandes e fluxo curto** — pensado para paciente idoso e para
   quem usa o celular com pressa.

## O que a versão Gineco já tem a mais

- Agendamento por texto com vocabulário gineco/obstétrico: “pré-natal
  amanhã de manhã” já identifica o tipo de consulta e sugere horários.
- Tipo de consulta no agendamento: consulta ginecológica, pré-natal ou
  outro motivo descrito pela paciente.
- Calculadora gestacional: DUM → idade gestacional e data provável do
  parto (regra de Naegele, +280 dias), sempre com o aviso de que é
  informativo e que a profissional confirma na consulta.

## Dados confirmados com a Dra. Mayara em 2026-10-28

- Nome: Dra. Mayara Miranda, ginecologia e obstetrícia
- Atendimento: presencial e online, nenhum tipo só presencial
- Tipos: consulta ginecológica, pré-natal e clínica geral
- Pagamento: particular
- Cancelamento: não há cancelamento pela página — o sistema bloqueia
  o cancelamento e orienta a remarcação pelo WhatsApp
- Foto: autorizada, arquivo ainda a enviar
- WhatsApp: informado, guardado SÓ interno e excluído da resposta da
  API pública, porque a resposta não disse se ele pode aparecer na página

## Teleconsulta: Google Meet, gratuito

- Escolha em 2026-10-28: Google Meet.
- Como funciona hoje, sem custo e sem API: a profissional cria a reunião
  grátis na conta dela (meet.google.com, "Nova reunião"), copia o link e
  cola na agenda, no botão "Colar link do Google Meet". A paciente vê o
  link só na própria consulta online, em "Minhas consultas". O sistema
  nunca inventa um link: só aceita link real no formato do Google, e
  rejeita link em consulta presencial.
- Criação automática do Meet pela conta mh.cuidarsaude@gmail.com ainda
  NÃO está ligada: essa conta ainda não autorizou o acesso no Google
  (pendência do MH Cuidar). Quando autorizar, dá para criar o Meet
  junto com o agendamento, sem colar link à mão.

## Locais de atendimento (verificados em 2026-10-28)

- **Clínica Maraclin** — R. Dr. Maurício Rebouças, 118, Maragogipe, BA,
  CEP 44420-000, tel. +55 75 99716-2346, segunda a sexta 06:00 às 16:00
  (Places, place_id 2271439086574961)
- **Santa Casa de Misericórdia São Félix** — Rua Nova, 1, São Félix, BA,
  CEP 44360-000, tel. +55 75 3425-2616 (Places, place_id 1255224395250432)
- **Centro Médico O Bom Doutor** — endereço NÃO encontrado em busca
  pública na Bahia em 2026-10-28 (os resultados com esse nome eram de
  Minas Gerais, Uruguai e uma série de TV). No sistema ele entra como
  "endereço a confirmar", sem endereço inventado. A paciente escolhe o
  local no agendamento, e o local aparece nas consultas dela e na agenda
  do profissional.

## Grade real por local (v1.1)

- Maraclin: segunda a sexta, 06:00 às 15:00, de 1 em 1 hora (ficha pública).
- Santa Casa de São Félix: segunda a sexta, 08:00 às 17:00, grade padrão
  da clínica — confirmar com a unidade.
- Online (Google Meet): todos os dias, 08:00 às 17:00.
- Centro Médico O Bom Doutor: fora da reserva até confirmar o endereço
  completo. Aparece na lista de locais, mas o botão de reserva fica
  desativado para ele.
- Duração: 60 minutos por consulta, editável em `data/dados.json`
  (`configHorarios.duracaoMinutos`), até a profissional confirmar outra.
- Teleconsulta: fluxo manual do Meet (a profissional cola o link real na
  agenda); criação automática pela conta mh.cuidarsaude@gmail.com ainda
  depende da autorização no Google.

## O que ainda falta

- [ ] Endereço completo do Centro Médico O Bom Doutor (sem ele, não é reservável)
- [ ] Confirmar com a unidade os horários da Santa Casa
- [ ] Confirmar a duração exata da consulta (padrão atual: 60 minutos)
- [ ] Criar a primeira conta profissional na página ao vivo
- [ ] Definir as credenciais do WhatsApp (oficial ou CallMeBot) na Railway
- [ ] Autorização no Google para criar o Meet automaticamente
- [ ] Pagamento (Pix e cartão) — só com revisão antes de qualquer mudança
      em área de pagamento
- [ ] LGPD: termo de consentimento e registro de quem acessou o quê
- [ ] Marketplace com várias clínicas — só depois que uma clínica estiver
      redonda; marketplace vazio não compete com rede pronta

## Endpoints

- `GET /api/health`, `GET /api/clinica`, `GET /api/disponibilidade`
- `POST /api/entender`, `POST /api/agendar`, `POST /api/confirmar`,
  `POST /api/cancelar`, `POST /api/lista-espera`
- `GET /api/meus-agendamentos`, `GET /api/lembretes`, `GET /api/agenda`
- `POST /api/checkin`, `POST /api/prontuario`, `POST /api/nota-ia`
- `POST /api/calculadora-gestacional`
- `POST /api/teleconsulta` (colar link do Google Meet na consulta online)
- `GET /api/profissional/eu`, `POST /api/profissional/cadastro`,
  `POST /api/profissional/login`, `POST /api/profissional/logout`
- `POST /api/lembretes/enviar` (só com login; devolve enviado ou não enviado com o motivo)
