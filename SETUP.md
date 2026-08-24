# BB Soluções — base do projeto

Sistema unificado para integradora solar: cadastro de clientes e usinas, esteira de
projetos, ordens de serviço e monitoramento agregado dos portais de fabricante.

Stack: Next.js 15 + TypeScript, PostgreSQL, Drizzle ORM.

## Rodando

```bash
npm install
cp .env.example .env    # preencha APP_ENCRYPTION_KEY e as credenciais Growatt
npm run db:seed
npm run dev
```

O banco roda em container, **na porta 5434**:

```bash
docker run -d --name bb-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=bbsolucoes -p 5434:5432 postgres:16
```

> **Por que 5434 e não 5432:** esta máquina já tem o serviço `postgresql-x64-17`
> instalado ocupando a 5432, e o `doceria-db` de outro projeto ocupando a 5433.
> Quando o container tentou a 5432, quem respondia do lado de fora era o Postgres
> nativo — `psql` dentro do container funcionava, mas a aplicação levava
> `28P01 password authentication failed` sem explicação. Se mudar de máquina,
> confira a porta antes.

> **Se o `db:migrate` travar:** aqui no Windows ele fica parado em "applying
> migrations" e sai com código 0 sem criar nada. O caminho que funciona é aplicar
> o SQL direto, e ele é equivalente:
>
> ```bash
> docker exec -i bb-pg psql -U postgres -d bbsolucoes -v ON_ERROR_STOP=1 < drizzle/0000_violet_kree.sql
> ```
>
> Vale conferir de novo quando houver mais migrations — pode ser específico
> desta combinação de shell e driver.

## Importando as usinas do Growatt OSS

A API de sessão não autentica a conta de distribuidor e o token da OpenAPI v1
depende da Growatt responder. Enquanto isso, o próprio OSS exporta a Plant List:

```bash
python scripts/xls-para-csv.py "Plantlistdata.xls"
npm run import:growatt -- "Plantlistdata.csv"
```

O botão fica na Plant Management List, em **Export List** (canto superior
direito) ou **Export** (abaixo da tabela). O importador é idempotente: casa pelo
nome da usina e atualiza em vez de duplicar.

Três armadilhas dessa exportação, já tratadas no código:

- **O arquivo é `.xls` de Excel 97-2003** (OLE2), que nenhuma biblioteca JS de
  planilha lê. Daí o conversor em Python.
- **O cabeçalho está na linha 2**, não na 1 — a primeira linha traz o nome e o
  código da empresa.
- **`PV Panels Power` vem em watts**, não em kWp, apesar de a tela mostrar
  "60kWp". A soma da coluna bruta bate com o total do painel, o que confirma a
  unidade. Importar sem dividir por mil inflaria toda usina em mil vezes.

E uma que **não** é do código: 40 das 136 usinas têm potência cadastrada abaixo
de 1 kWp, com valores de 2 W a 999 W, e essas mesmas usinas já geraram centenas
de milhares de kWh. É erro de cadastro no portal, provavelmente kWp digitado em
campo de watts. Enquanto não for corrigido na origem, qualquer alerta de
"geração abaixo do esperado" vai disparar errado nessas usinas.

## Autenticação

Login por e-mail e senha. O seed cria cinco usuários, um por papel, todos com a
senha `bbsolucoes` — ou o que estiver em `SEED_SENHA`. Serve só para desenvolver:
**antes de qualquer instalação real, cada pessoa precisa da sua senha**, senão o
usuário nominal, que é o motivo de existir login separado, não vale nada.

```
adm@bbsolucoes.local         engenharia@bbsolucoes.local
vendas@bbsolucoes.local      tecnico@bbsolucoes.local
                             estoque@bbsolucoes.local
```

Três decisões que valem registro:

**Senha com `scrypt` do próprio Node.** É uma função de derivação de chave de
verdade, lenta e custosa em memória de propósito. Evita bcrypt e argon2, que
compilam código nativo e dão trabalho no Windows e no deploy.

**Sessão em tabela, guardando o SHA-256 do token.** Se o banco vazar, ninguém
monta um cookie válido a partir dele. E sessão em tabela é revogável: tirar o
acesso de alguém desligado é um `DELETE`, não esperar o token vencer. Desativar
o usuário também derruba na hora.

**Duas camadas.** O middleware só olha se o cookie existe — ele roda no Edge e
não alcança o banco. Quem de fato protege é `exigirUsuario()`, chamado em toda
página que mostra dado de cliente, e esse confere a sessão no banco. Página nova
que esqueça de chamar fica desprotegida, então é o primeiro item a conferir numa
revisão.

O formulário de login **não depende de JavaScript**: a action redireciona com o
erro na URL. A primeira versão usava `useActionState` e a mensagem de erro nunca
aparecia, porque enquanto o React não hidrata o formulário faz um POST nativo e o
estado devolvido se perde. Numa tela de login isso é grave — é a primeira coisa
que carrega, às vezes em rede ruim, e errar a senha sem receber resposta parece
sistema travado.

## Classificação dos eventos da Growatt

`src/collectors/growatt/codigos.ts` traduz o evento bruto do portal em
severidade e, mais importante, em **precisa de visita ou não**. A divisão não é
palpite: é a do próprio manual de troubleshooting da Growatt, que separa

- **System fault** — tensão ou frequência da rede fora de faixa, falta de AC,
  isolação baixa, sobretemperatura, corrente residual. Condição de rede ou de
  ambiente, volta sozinha quando a causa passa. Mandar técnico é viagem perdida.
- **Inverter fault** — os `Error: 1xx`. Falha de hardware. O manual manda
  reiniciar e, persistindo, trocar a placa de controle ou o inversor.

Uma frase do manual vale para os dois casos e deve estar em qualquer alerta que
o sistema mandar: *"All faults will shut down the inverter immediately and wait
until the fault is cleared."* Qualquer falha significa geração parada — o que
muda entre as duas categorias é se alguém precisa pegar a estrada.

Um código `1xx` que não esteja na tabela ainda entra como crítico, porque a
família inteira é hardware. O importador lista os eventos que não bateram com
nada, para a tabela crescer com o que o parque realmente produz.

Fonte: *Troubleshooting for Growatt TL&MTL* (Ver 1.3), mais as listas públicas de
código das séries novas.

## A esteira é dado, não código

As 12 etapas do fluxo da BB Soluções vivem na tabela `etapa`, semeadas por
`src/db/seed.ts`. Não são um enum de propósito: o fluxo ainda está sendo
levantado com o cliente, sabidamente falta pelo menos a **instalação**, e cada
integradora tem o seu. Mexer na esteira é `INSERT`/`UPDATE`, não migration.

A coluna `ordem` anda de 10 em 10 justamente para caber etapa nova no meio sem
renumerar nada. O lugar reservado para a instalação é a ordem **100**, entre a
aprovação da concessionária (90) e o pedido de vistoria (110).

Sem Postgres na máquina, o caminho mais rápido é Docker:

```bash
docker run -d --name bb-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=bbsolucoes -p 5432:5432 postgres:16
```

## O que já existe

Só a camada de dados — 19 tabelas, migrations em `drizzle/`. Typecheck limpo e
**aplicado com sucesso** num Postgres 16 local.

```
src/db/
  index.ts              cliente Drizzle
  schema/
    enums.ts            todos os enums do domínio
    cadastro.ts         empresa, usuário, cliente, UC, usina, equipamento, portais
    operacao.ts         projeto (esteira), OS, checklist, anexos, comentários
    monitoramento.ts    leitura, leitura bruta, alerta, tarifa, notificação
    relations.ts        relações para o query builder
```

## Três decisões que já estão embutidas no schema

**Multi-tenant desde a primeira migration.** Toda tabela tem `empresa_id`. A BB
Soluções é a empresa nº 1, não a única. Isso custa quase nada agora e é reescrita
se for feito depois.

**A corrente do cadastro é a espinha.** `cliente → unidade_consumidora → usina →
equipamento → vinculo_portal`. O `vinculo_portal` é o que liga a nossa usina ao id
que ela tem lá no portal do fabricante — trocar de portal vira trocar um vínculo,
não remodelar o cadastro.

**Cadência de coleta é por conta de portal, não global.** Cada fabricante impõe um
teto diferente: a FoxESS aceita 1.440 chamadas/dia por dispositivo, a Solis atualiza
os dados a cada 5 minutos, e a Huawei limita o dia inteiro a
`Σ ⌈dispositivos_do_tipo ÷ 10⌉ + 24` chamadas — estourar devolve erro 407. Por isso
`conta_portal` carrega `cadencia_minutos` e `chamadas_dia_max`.

**Coletor idempotente.** `leitura` tem unique em `(equipamento_id, medido_em)`.
O coletor refaz janelas sobrepostas e grava com `ON CONFLICT DO NOTHING`, então
rodar duas vezes nunca duplica dado. `leitura_bruta` guarda o payload cru de cada
portal — parece desperdício até um fabricante mudar um campo sem avisar.

## O que ficou de fora de propósito

- **Particionamento da tabela `leitura`.** 144 usinas a cada 15 min dá ~14 mil
  linhas por dia. Postgres aguenta isso por anos. Particionar antes de o `EXPLAIN`
  pedir é enfeite.
- **Estoque e financeiro.** Só entram depois de saber o que a empresa já usa para
  emitir nota — o sistema novo tem que conviver com isso, não substituir.
- **Autenticação.** Próximo passo, junto com as primeiras telas.

## Próximos passos

1. Subir o Postgres e rodar a migration de verdade.
2. Coletor Growatt: puxa as 137 usinas da conta OSS e popula `usina` + `vinculo_portal`.
3. Tela de lista de usinas com status, destacando as que estão offline ou anormais.
4. Autenticação e papéis.

## Segurança

`.env` está no `.gitignore` e deve continuar. As credenciais de portal são gravadas
cifradas em `conta_portal.credenciais_cifradas`, com chave em `APP_ENCRYPTION_KEY` —
o banco não pode ser capaz de entregar acesso aos portais de ninguém se vazar.
