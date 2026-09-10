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

## Os sete portais e o estado de cada API

| Portal | Usinas | Caminho oficial | Situação |
| --- | --- | --- | --- |
| Growatt | 138 | OpenAPI v1, token emitido | seriais não indexados; 2º e-mail em 10/09; planilha cobre |
| Hoymiles | 4 | Open API oficial, **paga** | doc e tabela de preços recebidas; falta pedir a chave |
| Solis | 1 | SolisCloud API, ativação pelo suporte | **funcionando** (chave testada em 08/09/2026) |
| FoxESS | 1 | OpenAPI, chave no OpenPlatform | **funcionando** |
| SolarPortal+ | 1? | GoodWe SEMS, NDA pelo comercial | e-mail enviado; falta saber se a chave vale no white-label |
| NEP | 0? | não tem API | e-mail enviado; falta conferir a contagem no app |
| Huawei | 16 | FusionSolar Northbound API | API liga; a conta da API não enxerga as usinas |

**Growatt: o OSS e o ShineServer são dois sistemas, não dois endereços.** A conta
de distribuidor do OSS — a que exporta a Plant List das 137 usinas — simplesmente
não existe do outro lado. Testada em `server-api.growatt.com` e em
`openapi.growatt.com`, nos dois endpoints de login e em três formatos de senha:
todas as seis combinações devolvem *Username or Password Error*. Não é senha
errada, é conta que não mora ali.

O token do distribuidor não sai do ShineServer: sai do próprio OSS, num
formulário que estava escondido atrás de um nome parecido com o que se procurava.
O caminho certo é

```
oss.growatt.com → System Setting → System Management
  → aba "API management" → + Add API Request
```

(Quem procura por *System set* não acha. É **System Setting**, e o formulário se
chama *Add API Request (API-token)*.)

O formulário pede servidor, empresa, país — vem preenchido com 中国, tem que
trocar —, contato, e-mail, código de verificação enviado por e-mail, motivo do
pedido e uma **lista branca de IP ou domínio**. Esse último campo é o que mais dá
dor de cabeça: quem integra relata IP bloqueado e suporte demorando dias para
liberar, e um IP residencial muda sozinho. Vale deixar vazio se o formulário
aceitar, e só preencher com o IP do servidor quando o sistema tiver um.

Aprovado o pedido, o token é **permanente** ("Passed Audit: Permanent") e chega
por e-mail. A partir daí a API é simples: base `https://openapi.growatt.com/v1/`,
token no header `token`, resposta `{data, error_code, error_msg}`. As rotas que
interessam são `/v1/plant/list` (100 por página, com `peak_power` e
`total_energy`), `/v1/plant/energy`, `/v1/device/list` e
`/v1/device/inverter/alarm`. Os limites são por endpoint — 300 s entre chamadas
de visão geral, 60 s nas de detalhe, e no máximo 7 dias por janela em
`/v1/device/inverter/data`; estourar devolve `FREQUENTLY_ACCESS`.

**O token chegou, é válido, e não enxerga nada.** Pedido aprovado em 09/09/2026,
servidor "Growatt Server". O que os testes mostram:

| Chamada | Resultado |
| --- | --- |
| `/v1/plant/list` | `error_code 0`, `count: 0` |
| `/v1/user/c_user_list` | `error_code 0`, `count: 0` |
| `/v1/plant/user_plant_list` com um cliente real | `10011 error_permission_denied` |
| o mesmo token em `openapi-us`, `-cn`, `-au` | `10011` — logo o servidor escolhido está certo |

Não é token errado nem servidor errado: é token **não vinculado** às contas dos
clientes. No OSS a conta EDPGV8 lista 137 usinas em 136 contas de usuário final e
exporta a Plant List sem problema; pela API, nenhuma delas existe. É o mesmo
enredo da Huawei e da própria API de sessão — a conta que vê o dado não é a que
recebeu a credencial.

O cliente da OpenAPI v1 já está escrito (`src/collectors/growatt/openapi.ts`),
convivendo com o `client.ts` da API de sessão. Para saber se a Growatt resolveu,
`npm run probe:growatt-api` responde em quinze segundos — mais barato que reler
o e-mail.

**A frequência é levada a sério aqui, e não por preciosismo.** Cerca de 5 minutos
entre chamadas de visão geral, 1 minuto nas de detalhe; estourar devolve
`error_code 10012 error_frequently_access`, e insistir depois disso é o que faz
outros integradores relatarem IP bloqueado por dias. Por isso há duas travas: o
cliente espaça as chamadas sozinho, e o probe grava a hora da última execução em
`%TEMP%/selebi-probe-growatt.txt` e **se recusa a chamar** se rodou há menos de
cinco minutos. Barrar antes da chamada é mais seguro do que fazê-la e torcer.

**A tela do OSS foi esgotada em 10/09/2026** — vale registrar para ninguém repetir:

- A linha do token mostra **Number of Device: 0**, e existe uma coluna
  *Synchronize devices* justamente para resolver isso.
- A engrenagem abre *Set synchronize devices*, com o campo *Distributor/Installer
  Code* **travado em `EDPGV8`** — não aceita edição. Confirmar não muda o
  contador: continua 0.
- O aviso do próprio diálogo explica por quê: *"Log in to the device under the
  distributor/installer account by default"*. Ele sincroniza o que estiver
  pendurado naquela conta, e as 137 usinas estão sob 136 contas de usuário final,
  um nível abaixo.
- O outro botão da coluna *Operate* é só *Token Settings*, que exibe o token.
- Em *Organization Management → User Management*, a BB tem **um** funcionário
  (`EDPGV8001`) e, na aba *Customer Management*, esse mesmo código aparece com
  papel **Installer** — e cadastrado como **China / Ásia**, provavelmente lixo de
  cadastro, já que os formulários da Growatt vêm com 中国 por padrão.

**Por que o contador fica em zero — a explicação achada em 10/09/2026.** O vínculo
entre um aparelho e o código do instalador/distribuidor não é automático nem
self-service. São duas etapas, e a segunda não é nossa:

1. Na conta do **usuário final**, em `server.growatt.com` → *Energy* → ícone de
   lápis, preenche-se o código do instalador (os primeiros caracteres da conta —
   de `EDPGV8001` sai `EDPGV8`).
2. Os **números de série** dos inversores só podem ser importados por um
   **engenheiro técnico da Growatt**, em `oss.growatt.com` → *System Set →
   Installer List / Distributor List*, com uma planilha de SNs na coluna A.

É a etapa 2 que falta. Nenhuma conta de cliente — nem a de distribuidor da BB —
tem permissão para fazê-la. Por isso a engrenagem do OSS não resolve e o
contador não sai do zero: a tela existe para sincronizar o que já foi vinculado,
não para vincular.

Ou seja, o pedido certo ao suporte não é "liguem nosso token", é **"importem
estes números de série sob o nosso código"**, com a lista anexa.

**E a exportação que servia para o chamado resolveu metade do problema
sozinha.** *Device List → Export data → Export the device data* entrega
exatamente o que a OpenAPI entregaria: número de série, datalogger, modelo,
potência nominal, estado de comunicação e **quando cada aparelho falou pela
última vez**. `npm run import:dispositivos -- "dados/dispositivos.csv"` grava
tudo isso, e o `npm run atualizar` pega sozinho o arquivo mais recente da pasta.

Na primeira execução, em 10/09/2026: 184 inversores e 184 dataloggers
cadastrados, e **12 alertas de sem comunicação abertos** — um deles de uma usina
muda havia **383 dias**. O `aberto_em` do alerta é o instante da última subida,
não o da importação: é o que faz o alerta dizer "parada há 383 dias" em vez de
"aberta agora", e é o que impede duplicata quando a mesma planilha é reimportada.

Não substitui a API — continua sendo exportação manual. Mas prova que o gargalo
nunca foi o dado: ele estava no portal o tempo todo, e ninguém tinha como olhar
137 usinas uma a uma.

Sobra ainda um caminho paralelo: o token de conta, gerado em **ShinePhone → Eu
→ nome de usuário → API Token → Reopen**, com a conta de instalador
(`bbsolucoes2023@gmail.com`). A documentação do Home Assistant relata que tokens
gerados pela web às vezes não funcionam enquanto os do aplicativo funcionam — que
é exatamente o sintoma daqui.

Isso agora é chamado para a Growatt, e não pesquisa: o contrato da API promete
"technical support to assist distributor/installer to complete the interface
docking". Uma pergunta a fazer junto: a lista de API management tem coluna
*Distributor/Installer*, e pode ser que o pedido precise nascer no nível de
instalador, não de distribuidor.

Contato: `br.service@growatt.com`, (44) 3122-3636, e `service@growatt.com` para o
time da API.

O e-mail do token vem em chinês, com o token no meio da frase. Colar a frase
inteira no `.env` deixa a variável com 96 caracteres em vez de 32 — o token é a
sequência alfanumérica entre `：` e `；`.

**Duas cláusulas do contrato da API mexem com a arquitetura**, e por isso ficam
aqui e não só no jurídico:

- **A interface não pode ser repassada.** O contrato proíbe revender,
  sublicenciar ou deixar terceiro usar o acesso — só a equipe do próprio
  distribuidor. O sistema é multi-tenant desde a primeira migration, e isso
  continua certo, mas **cada empresa precisa do seu próprio token**: os dados de
  uma segunda integradora não podem entrar pelo token da BB.
- **Dado pessoal fica no país.** O contrato manda armazenar e processar dentro do
  próprio país e seguir as regras de privacidade. Como o cadastro guarda nome e
  cidade de 136 clientes reais, a hospedagem do Selebi precisa ser no Brasil, e
  falta uma política de privacidade — que a Growatt pode pedir para ver.

Vale saber também que o uso é limitado a **operação e manutenção**, que a Growatt
registra todos os acessos, e que ela pode suspender o serviço quando quiser sem
indenizar. Ou seja: a importação por planilha continua valendo como plano B, e
não deve ser apagada quando o token chegar.

**Solis, três armadilhas que custaram tempo.** A assinatura é HMAC-SHA1 sobre
cinco linhas (`POST`, MD5 do corpo, `application/json`, data em GMT, caminho) —
até aí é seguir a documentação. O que não está escrito em lugar nenhum:

- **Barra no fim da URL base derruba tudo.** O SolisCloud responde HTTP 500
  dizendo `potentially malicious String "//"`. Parece ataque, é uma barra.
- **`dayPowerGeneration` não é geração.** É hora de sol pleno: 3,39 numa usina
  de 11 kWp que gerou 37,3 kWh. O campo certo é `dayEnergy`, e os dois vêm lado
  a lado no mesmo objeto.
- **A unidade muda com o tamanho do número.** A mesma usina manda `dayEnergy`
  em kWh e `allEnergy` em MWh, cada um com seu `...Str`. Ler o número sem ler a
  unidade erra por mil.

Também vale saber que `machine` traz o modelo de verdade (`S5-GR1P10K`);
`model` e `productModel` são um código de quatro dígitos que não diz nada.

Três descobertas que economizam pesquisa depois:

**SolarPortal+ é GoodWe.** O nome não aparece em lugar nenhum da tela, mas o site
se entrega: as chamadas vão para `/web/sems/sems-user/…`, a tradução pede
`systemName=semsplus`, os scripts vêm de `semsplus.oss-cn-hongkong.aliyuncs.com`,
o bundle se chama `semsV2.js` e o app Android é `com.goodwe.solarportal`. "Smart
Energy Management System", o subtítulo do login, é literalmente o que SEMS
significa. Acesso à API é pedido ao representante comercial da GoodWe, passa por
NDA, e é liberado como permissão na própria conta SEMS — teto de 3.600
chamadas/hora. A assinatura digital do NDA exige **passaporte**; RG não serve.

Duas coisas saíram de olhar o front-end do portal, sem login nenhum. A primeira é
o mapa dos serviços: `sems-user`, `sems-plant`, `sems-report`, `sems-alarm`,
`sems-remote`, `sems-dashboard-web`, `sems-admin` e `sems-sitemsg`, todos sob
`/web/sems/<serviço>/api`. A segunda é a que decide: o arquivo de tradução da
interface tem **12.385 textos e nenhum menu de API**. O único que fala nisso é
uma mensagem de erro — `api_access_denied`, "Sem permissão para utilizar a API".
Ou seja, a permissão existe do lado do servidor e **não há como ligá-la sozinho**:
não é como a FoxESS, onde a chave se gera na hora. Sem o comercial da GoodWe, não
tem caminho.

Ressalva que vale perguntar junto: os guias de API que circulam na internet são
do `semsportal.com`, o SEMS antigo (`/api/v1/Common/CrossLogin`). O SolarPortal+
roda o SEMS novo, de microserviços — pode ser que a chave liberada pelo NDA valha
para uma plataforma diferente daquela onde a usina da BB está.

**Huawei e FusionSolar são a mesma coisa.** FusionSolar é o nome do portal, Huawei
é quem o faz — não são dois sistemas a procurar. A Northbound API é a mais bem
documentada das três, e também a mais apertada: `https://<prefixo>.fusionsolar.
huawei.com/thirdData/`, uma chamada por minuto por endpoint, sessão única, cinco
logins a cada dez minutos, erro 407 quando estoura. A conta northbound é separada
da de login e nasce em *System → Company Management → Northbound Management*, na
conta do instalador — e é preciso que seja a conta que administra as usinas, não
qualquer uma.

**A API liga, mas está apontada para uma conta vazia.** A conta northbound
`Selebi` existe, o login passa e o token vem. As duas rotas de lista respondem
`success: true, failCode: 0` com lista vazia — não é permissão negada nem rota
errada.

Só que as usinas existem: o aplicativo do FusionSolar, na mesma empresa, mostra
**16 instalações** — 15 normais, 1 em falha (Tempernet), nenhuma off-line —
todas em Itabaiana e São Cristóvão, de 5 a 6 kWp. Isso faz da Huawei o segundo
maior parque da BB, atrás só da Growatt, e não o portal descartável que a lista
vazia sugeria.

Aparelho e site mostram coisas diferentes porque uma conta do FusionSolar mora
num servidor só: `eu5`, `intl` e `la5` são universos separados, e o aplicativo
guarda o servidor escolhido no primeiro login. O site onde a `Selebi` nasceu é
`uni005eu5` (empresa "BB Soluções", ainda **não autenticada** — cara de conta
recém-criada). A conta northbound enxerga as usinas da empresa dela, então
enquanto as 16 estiverem sob outra conta ou outro servidor, a lista continua
vazia por mais certa que a integração esteja.

Sai por um dos dois caminhos: criar a conta de API dentro da conta que
realmente administra as 16, ou trazer as usinas para a empresa "BB Soluções"
por *Plants → Plant Migration*. Só depois disso vale escrever o `coletar.ts` —
que aqui ainda não existe de propósito.

O host é a pegadinha. A barra de endereço do portal mostra
`uni005eu5.fusionsolar.huawei.com`, e esse host devolve **HTML** em
`/thirdData/login` — o `uni005` é só o front do portal. A API vive no `eu5` puro.
E a conta da BB é europeia, não latino-americana: `la5` recusa com `20400`, que
parece senha errada e é host errado. O prefixo certo se descobre testando o
login, não olhando o navegador.

Duas defesas ficaram dentro do cliente porque a conta é de produção: o token é
guardado e só se reloga quando o portal manda (`failCode 305`), e um contador
recusa o sexto login dentro de dez minutos, que é o que trancaria a conta por
meia hora.

**Hoymiles tem API oficial, e ela é paga.** Depois do e-mail para o suporte
brasileiro, mandaram a documentação — *Open API for S-Miles Cloud* V1.14, 104
páginas, marcada como confidencial — e a tabela de preços de 2025. Cinco planos,
cobrados por volume:

| Plano | Chamadas/min | Chamadas/mês | Preço |
| --- | --- | --- | --- |
| A | 10 | 10.000 | US$ 18/mês — **grátis para revenda certificada ou Gold** |
| B | 50 | 30.000 | US$ 30/mês |
| C | 100 | 350.000 | US$ 350/mês |

Ironicamente é a API **mais simples** de todas as sete: base
`https://wapi.hoymiles.com`, a chave vai na própria URL (`?key=…`), sem
assinatura, sem token que expira, sem sessão única. A resposta é
`{status, message, data}`, com `status: "0"` significando sucesso e `100` a
chave inválida. As rotas que interessam são `findMyStations` (lista, dez por
página), `gpw` (estado da usina), `station_today_production` e
`findStation30dayEnergy`.

Para as quatro usinas da BB o plano A sobra: uma rodada de coleta gasta cerca de
nove chamadas, então de hora em hora dá ~6.500 no mês, dentro das 10.000. De
quinze em quinze minutos estoura — e é bom saber disso antes de escolher a
cadência, não depois da primeira fatura.

O que ainda pesa contra: o portal atual sai do ar em 31/10/2026, e ninguém
confirmou que a chave migra para o `global.hoymiles.com`. Vale perguntar junto
com o pedido da chave.

E há prazo: o aviso na tela de login do `previous.hoymiles.com` diz que **a
versão atual sai do ar em 31/10/2026**, e manda usar `global.hoymiles.com`. Ou
seja, qualquer coisa amarrada ao portal velho — inclusive as integrações de
comunidade — tem data para quebrar. Um bom motivo para não construir nada em
cima dele antes de a plataforma nova assentar.

Contatos que resolvem, quando a hora chegar: Hoymiles Brasil `service.br@
hoymiles.com`, GoodWe Brasil `servico.br@goodwe.com`, Huawei América Latina
`la_inverter_support@huawei.com`. A GoodWe pede NDA assinado antes de liberar a
API — e a assinatura digital exige **passaporte**, RG não serve.

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
