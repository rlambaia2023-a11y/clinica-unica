# Clínica Única v1 — Gineco primeiro — sistema criado

Sistema próprio, em português, sem copiar código, visual ou marca do Doctoralia.
Só as funções públicas foram analisadas e refeitas do zero, com melhorias.
Versionado localmente (git, sem remoto): primeiro commit em 2026-10-28.
Ainda NÃO publicado no GitHub nem na Railway.

## Rodar e publicar

Local:

```bash
node server.mjs
# http://localhost:3104
```

Variáveis (veja `.env.example`):

- `PORT`, `DATA_DIR` (na Railway: `/app/data`, com volume anexado)
- `GEMINI_API_KEY` (opcional; sem ela, a nota por IA avisa e não inventa resumo)
- `PROF_CODE` (código da área do profissional; sem ele, a área fica aberta
  em modo demonstração e o `/api/health` avisa)
- `WHATSAPP_INTERNO` (só interno; nunca fixo no código e nunca devolvido
  pela API pública)

Deploy na Railway: Dockerfile + `railway.json` já prontos, serviço a partir
deste código, volume em `/app/data` com `DATA_DIR=/app/data`. Sem volume,
um redeploy apaga os agendamentos.

Aviso honesto sobre o acesso: o `PROF_CODE` é um código compartilhado
simples, não um login individual com senha. Serve para a v1; antes de
guardar prontuários reais de pacientes, trocar por login próprio, no
modelo do Gineco-AI.

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

## O que ainda falta antes de usar com pacientes de verdade

- [ ] Endereço completo do Centro Médico O Bom Doutor
- [ ] Dias e horários exatos e duração da consulta ("todos" foi
      interpretado como todos os dias, grade atual 08:00 às 11:00 e
      14:00 às 17:00, de 1 em 1 hora)
- [ ] Login do profissional (hoje a área do profissional está aberta na demo)
- [ ] Envio real do lembrete por WhatsApp oficial ou CallMeBot, com
      confirmação e cancelamento em um toque dentro da mensagem
- [ ] Teleconsulta por vídeo
- [ ] Pagamento (Pix e cartão) — só com revisão antes de qualquer mudança
      em área de pagamento
- [ ] Volume persistente no Railway e backup dos dados
- [ ] LGPD: termo de consentimento, acesso do paciente ao próprio prontuário
      e registro de quem acessou o quê
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
