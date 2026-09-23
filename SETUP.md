# BB Soluções — base do projeto

Sistema unificado para integradora solar: cadastro de clientes e usinas, esteira de
projetos, ordens de serviço e monitoramento agregado dos portais de fabricante.

Stack: Next.js 15 + TypeScript, PostgreSQL, Drizzle ORM.

## Rodando

**No dia a dia**, com a máquina já preparada, são dois comandos — e o primeiro
só falha se o Docker Desktop estiver fechado:

```bash
docker start bb-pg
npm run dev
```

Depois é `http://localhost:3000`. O `db:seed` cria cinco contas de
desenvolvimento — `adm@`, `vendas@`, `engenharia@`, `tecnico@` e `estoque@`,
todas em `@bbsolucoes.local` — com a senha que estiver em `SEED_SENHA`.

> **A senha padrão do seed não está escrita aqui de propósito.** Este
> repositório é público, e senha documentada em repositório público é senha de
> ninguém. Ela está em `src/db/seed.ts`; defina `SEED_SENHA` no seu `.env` para
> usar outra.
>
> Essas cinco contas **não vão para produção**. Elas são genéricas — um
> `tecnico` para todos os técnicos — e conta compartilhada faz a trilha de quem
> baixou documento e de quem anotou serial não identificar ninguém. Em
> produção, o administrador cria uma conta por pessoa em **Administração →
> Usuários**, e cada uma recebe senha provisória que a própria pessoa troca no
> primeiro acesso. O `db:seed` se recusa a rodar em produção sem `SEED_SENHA`.

> **`Failed query: select ... from "sessao" inner join "usuario"`**
>
> Não é bug da tela: é o Postgres fora do ar, e a consulta do login é só a
> primeira a tentar falar com ele. Quase sempre o Docker Desktop foi fechado —
> ele leva uns 30 segundos para subir, e só então `docker start bb-pg`
> funciona. Para não repetir, dá para marcar *Start Docker Desktop when you log
> in* nas configurações dele.

> **`EADDRINUSE: address already in use :::3000`**
>
> Já tem um servidor rodando nessa porta, provavelmente de outra janela de
> terminal. Fecha a outra, ou usa outra porta com `npm run dev -- -p 3001`.
>
> E `npm start` não é o comando de desenvolvimento: ele roda `next start`, que
> exige um `npm run build` antes. Para mexer no código é `npm run dev`.

**Na primeira vez, ou em máquina nova:**

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

Login por e-mail e senha. O seed cria cinco usuários, um por papel, com a senha
de `SEED_SENHA` — **que não é documentada aqui**, porque este repositório é
público. Serve só para desenvolver.

**Em produção, cada pessoa tem a sua conta**, criada em *Administração →
Usuários*. O administrador gera a conta, o sistema sorteia uma senha provisória
que aparece **uma vez só** na tela, e a pessoa é obrigada a trocá-la antes de
ver qualquer coisa — `exigirUsuario()` redireciona para `/trocar-senha`
enquanto `deve_trocar_senha` estiver marcado. Trocar a senha encerra todas as
sessões daquela pessoa, inclusive a que estava aberta.

Conta se **desativa**, nunca se apaga: apagar levaria junto quem enviou cada
documento e quem anotou cada número de série, e a trilha sumiria justamente
quando alguém sai da empresa.

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
| Huawei | 16 | FusionSolar Northbound API | **funcionando** (servidor `intl`, desde 11/09/2026) |

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

**E a BB tem duas contas Solis.** A primeira, com a usina `equilibrium`; a
segunda, com quatro (Italo Magnavita 01 e 02, Adelvo Ivo do Prado 1 e 2). A API
da primeira respondia "1 usina" e estava certa — a pergunta é que estava
incompleta, e isso quase virou a conclusão de que a Solis era um portal de uma
usina só. Cada conta tem sua própria chave, e o coletor varre todas as que
estiverem no `.env`:

```
SOLIS_KEY_ID   / SOLIS_KEY_SECRET
SOLIS_KEY_ID_2 / SOLIS_KEY_SECRET_2
```

Ele para no primeiro buraco da numeração, então pular do 2 para o 4 esconde a
quarta conta. Cada credencial vira uma linha em `conta_portal` (`SolisCloud #1`,
`#2`…), mas o vínculo de uma usina é procurado em **todas** as contas Solis da
empresa — assim, se alguém reorganizar as contas no portal, a usina continua
sendo a mesma aqui em vez de virar cliente duplicado.

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

**Funcionando desde 11/09/2026 — e o que atrasou foi o servidor.** Uma conta do
FusionSolar mora num servidor só: `eu5`, `intl` e `la5` são bancos separados. A
primeira conta northbound nasceu no `uni005eu5` (cuja API vive no `eu5`) e
respondia `success: true` com lista vazia, porque as 16 usinas estão no `intl`.
Uma varredura dos dez hosts com a mesma credencial fecha o diagnóstico: só o
`eu5` aceitava; `intl`, `la5` e `au5` respondiam `20400 user_or_value_invalid`,
e os `uniXXX` devolvem HTML.

A conta certa se descobre pela **barra de endereço de quem enxerga as usinas** —
não pelo servidor onde a conta de API foi criada.

O formulário do `intl` é melhor que o do `eu5`: ele deixa escolher o escopo. Na
árvore de empresas/plantas, marcar a **empresa** em vez das usinas uma a uma
autoriza também "todos os projetos existentes **e futuros**" — sem isso, cada
usina nova instalada ficaria invisível para a API até alguém lembrar de voltar
lá.

Duas descobertas que o coletor incorpora:

- **`capacity` vem em kWp, não em MW.** A documentação diz MW; a usina Giselma
  Mendonça devolve `capacity: 5` e tem um único SUN2000-**5**KTL-L1. Converter
  inflaria tudo por mil. Foi o probe imprimindo o valor cru ao lado do
  convertido que pegou o erro antes de ele chegar ao banco. Sete das 16 vêm com
  `0`, que é campo vazio no cadastro do portal.
- **Desconectado à noite é o inversor dormindo.** A Huawei marca todo inversor
  como desconectado depois do pôr do sol; alertar por isso seria dezesseis
  alertas por dia até a equipe aprender a ignorar a tela. Mas a primeira versão
  da regra errou para o outro lado: escondeu duas usinas que caíram **às três da
  tarde** depois de gerar. A regra que ficou usa hora local de Sergipe —
  desconectado só é perdoado fora da janela de sol, e quem não gerou nada no dia
  é alerta a qualquer hora.

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

**Hoymiles tem API oficial, e ela é paga — mas não para nós.** O suporte mandou
a documentação *Open API for S-Miles Cloud* e a tabela de preços.

> A documentação é marcada **"Confidential level: Internal Information"** e por
> isso **não é descrita aqui** — este repositório é público. Rotas, parâmetros
> e formatos ficam fora. O PDF está com o dono, e o resumo técnico, fora do
> repositório.

A tabela de preços de 2026 tem cinco planos por volume de chamadas, e o que
decide é o **nível do distribuidor**, não o plano:

| Plano | Chamadas/min | Chamadas/mês | Regular | Certified | Gold | Platinum | Diamond |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | 10 | 10.000 | US$ 18 | **grátis** | **grátis** | grátis | grátis |
| B | 50 | 30.000 | US$ 30 | US$ 30 | US$ 30 | **grátis** | grátis |
| C | 100 | 350.000 | US$ 350 | US$ 350 | US$ 350 | US$ 350 | **grátis** |

O detalhe que resolve está nas *Remarks* da própria tabela: o nível interno
**"Gold / Certified (B / C-level)"** tem direito ao *Free Package Entitlement:
Package A*. Ou seja, **Certified basta — não precisa ser Gold**. Vale insistir
nisso, porque o suporte pediu o certificado Gold como se fosse a única via.

Para as quatro usinas da BB o plano A sobra: uma rodada de coleta gasta cerca de
nove chamadas, então de hora em hora dá ~6.500 no mês, dentro das 10.000. De
quinze em quinze minutos estoura — e é bom saber disso antes de escolher a
cadência, não depois da primeira fatura.

**Nada deve ser escrito com base em documentação antiga.** A versão de
fevereiro de 2026 apagou toda a geração anterior de interfaces: um coletor
escrito pela documentação de 2024 não teria uma única rota válida. Quando a
chave chegar, conferir a versão do PDF antes de escrever a primeira linha.

O que ainda pesa contra: o portal atual sai do ar em 31/10/2026 e ninguém
confirmou que a chave migra para o `global.hoymiles.com` — a documentação de
2026 não menciona a migração em lugar nenhum. Vale perguntar junto com o pedido
da chave.

E há prazo: o aviso na tela de login do `previous.hoymiles.com` diz que **a
versão atual sai do ar em 31/10/2026**, e manda usar `global.hoymiles.com`. Ou
seja, qualquer coisa amarrada ao portal velho — inclusive as integrações de
comunidade — tem data para quebrar. Um bom motivo para não construir nada em
cima dele antes de a plataforma nova assentar.

Contatos que resolvem, quando a hora chegar: Hoymiles Brasil `service.br@
hoymiles.com`, GoodWe Brasil `servico.br@goodwe.com`, Huawei América Latina
`la_inverter_support@huawei.com`. A GoodWe pede NDA assinado antes de liberar a
API — e a assinatura digital exige **passaporte**, RG não serve.

## Os documentos do cliente

Hoje cada cliente é uma pasta no Drive, em `Energia solar / CLIENTES <ano> /
<NOME> /`, com um PDF por assunto no padrão `TIPO - CLIENTE.pdf`. São três anos
de pastas — 2024, 2025 e 2026.

**O sistema não guarda o arquivo, guarda o que ele é e onde está.** Baixar
trezentas pastas de PDF escaneado para dentro do banco não resolveria nada: o
problema nunca foi onde o papel está, foi não conseguir olhar todas as pastas de
uma vez. Bastou olhar três para o problema aparecer:

| Pasta | Arquivos |
| --- | --- |
| YURI MONTEIRO | 8 |
| MARINA SOBRAL | 4 (incluindo um `.zip` e uma foto de telhado) |
| ANA PAULA | **1** |

O caminho tem duas peças. `scripts/listar-drive.gs` roda no Apps Script **dentro
da conta do Google** e escreve um CSV com a árvore inteira — assim não é preciso
credencial de API nem Drive sincronizado em máquina nenhuma. Depois,
`npm run import:drive -- "dados/arquivo.csv"` carrega esse CSV.

**A listagem tem que descer nas subpastas.** A primeira versão olhava só o
primeiro nível e achou 1.162 arquivos. A recursiva achou **2.921** — os 1.764
que faltavam estavam em 300 subpastas `PE Solar ...`, que é onde o engenheiro
guarda prancha, memorial, ART assinada, datasheet e as fotos do padrão. Com a
listagem rasa, metade dos clientes aparecia sem projeto elétrico tendo o projeto
elétrico uma pasta abaixo.

O importador classifica em duas passadas. **Prefixo primeiro** (`BOLETO` antes
de `ART`, senão o boleto vira ART), porque metade do Drive segue
`TIPO - CLIENTE.pdf`. Depois **palavra em qualquer lugar do nome**, porque a
outra metade inverte: `JUSTINO DECLARAÇÃO.pdf`, `SOLICITACAO ORCAMENTO -
GILMAR.pdf`. Essa ordem é o que torna a segunda passada segura —
`MEMORIAL - INMETRO INVERSOR` já saiu como memorial e nunca chega lá para virar
datasheet.

O casamento de cliente tem três passadas, mas a que vale é a primeira: **o id da
pasta do Drive**. Casar por nome não é idempotente — na segunda rodada a pasta
"MELO" deixou de casar sozinha porque "DIEGO MELO" tinha acabado de ser criada, e
virou um cliente separado.

Quatro coisas que só aparecem olhando o Drive de verdade:

- **128 arquivos são lixo do AutoCAD** (`.bak`, `.log`, `.dwl`). Um `.bak` de
  prancha se chama `PE Solar Fulano.bak` e entrava como projeto elétrico — dando
  ao cliente um documento que ele não tem. São ignorados na entrada.
- **Regra genérica engole regra específica.** `^uc` pegava `UC BENEFICIARIA`
  antes da regra de beneficiária: 41 arquivos entravam como conta da geradora,
  que é item do checklist, e quem só tinha a das beneficiárias aparecia em dia.
- **Os 176 arquivos `Registro NNNNNN_AAAA — Avaliação da Conformidade`** são
  todos certificado Inmetro de módulo ou inversor, não declaração.
- **Erros de digitação são regra, não exceção**: `CONTRTATO`, `PTOCURACAO`,
  `FILHA CADASTRAL`, `DIAJUNTOR`, `COMPENSATICO`.

**Rode com `--simular --amostra` antes.** `--simular` não grava; `--amostra`
imprime exemplos de arquivo por tipo. Regra de classificação errada não dá erro:
ela grava com o rótulo trocado e fica quieta, e com 2.900 arquivos a única forma
de conferir é ler o que cada regra pegou.

A tela `/documentos` responde o que ninguém conseguia responder: **quem está com
documentação incompleta**. São dois blocos. O da **concessionária** é a lista da
NDU 013 da Energisa — conta de luz, documento do titular, projeto elétrico,
memorial, ART e fotos do padrão; falta aqui trava a homologação e a usina fica
pronta sem poder ligar. O da **empresa** é contrato e recibo: não trava obra,
aparece quando dá problema meses depois. Procuração, UCs beneficiárias e
compensativo são condicionais e não contam como falta.

**Comece por 2026.** O corte por ano mostra que o buraco é de arquivamento, não
de obra parada:

| Ano | Clientes | Tem projeto elétrico | Tem foto do padrão |
| --- | --- | --- | --- |
| 2024 | 7 | 0% | 0% |
| 2025 | 57 | 9% | 3% |
| 2026 | 105 | 53% | 22% |

Em 2026 são 15 completos e **27 a uma única foto do padrão** de ficarem
completos. A lista é ordenada por quanto falta, para que esses não sumam no meio
dos 26 que estão faltando três documentos ou mais.

Falta o dono responder **a partir de qual etapa cada documento passa a ser
exigido**. Sem isso, cliente que fechou semana passada aparece em vermelho igual
ao que está parado há seis meses — e ninguém abre uma lista onde todo mundo está
errado.

### O documento pertence à venda, não à pessoa

O Drive **já estava organizado por projeto** e a primeira importação achatou
isso: 1.640 dos 2.788 arquivos estão dentro de uma subpasta `PE …`, e tudo
pendurava no cliente. Com pastas `PE Aumento GD` existindo — aumento de sistema
é venda nova no mesmo cliente —, os dois projetos dividiam uma pilha só e
ninguém sabia qual ART era de qual.

Hoje `documento.projetoId` aponta para o dossiê. É **nulo de propósito** para
documento pessoal: CNH e RG são da pessoa, valem para qualquer venda dela, e
pedir de novo no segundo projeto seria burrice. São 308 arquivos assim.

```bash
npm run dossies -- --simular
```

Cria um dossiê por `(cliente, ano do Drive)`. A granularidade é o ano e não a
subpasta `PE` porque um mesmo negócio pode ter `PE Solar … V2` e `PE Aumento …`
no mesmo ano; ano é o que a árvore garante.

### A regra que faz a tela parar de gritar

`exigencia_documento` guarda **a partir de qual etapa cada documento é
cobrado**. Tabela e não código, pelo mesmo motivo de `etapa`: o fluxo é da
empresa e mudar a regra precisa ser conversa virando dado.

A esteira já respondia essa pergunta e ninguém tinha percebido — as etapas se
chamam "Vistoria técnica", "Documentação do cliente", "Contrato e procuração",
"Projeto", "Aprovação da concessionária". O nome da etapa **é** o momento em que
o papel nasce.

```bash
npm run seed:exigencias
```

Semeia a proposta, que é para o dono corrigir olhando — muito mais fácil do que
responder a pergunta no vazio. Corrigir é `UPDATE`.

**Cuidado com raciocínio circular.** Nos 171 dossiês importados a etapa foi
deduzida justamente pelos documentos que faltam. Conferir esses documentos
contra essa etapa acusa todo mundo: a primeira versão da tela marcou 116 de 118
como atrasados. Por isso a coluna diz **"falta para avançar"**, não "atrasado" —
mesma informação, sem a acusação. Atraso de verdade só existe depois que alguém
move a etapa à mão.

O que a tela mostra de útil é o **gargalo**: foto do padrão segura 70 dossiês,
conta de luz 41, recibo 20. Não são 116 telefonemas, são cinco problemas.

### Arquivo de trabalho não é documento

`documento.status` vale `indefinido`, `trabalho`, `aguardando_assinatura` ou
`assinado`. Antes disso a informação vivia no nome do arquivo, e o checklist
dava por cumprido o cliente cujo único memorial era a planilha `.xlsm` do
engenheiro — eram nove.

| | |
| --- | --- |
| `trabalho` | 219 arquivos: `.dwg`, `.xlsm`, `.xls`, `.docx`. Não contam como entregues. |
| `assinado` | 186, pelo nome dizer |
| `aguardando_assinatura` | 5 — "sem assinar", "coletar assinatura" |
| `indefinido` | 2.378, e é a resposta honesta |

`indefinido` é maioria porque só 232 dos 2.900 nomes dizem alguma coisa sobre
assinatura. Chutar "assinado" para o resto seria dar por conferido o que ninguém
conferiu, então a tela **não cobra assinatura de documento indefinido** — só
avisa quando o nome diz explicitamente que falta assinar.

### Quem pode ver, e quem viu

A tabela guarda CNH, RG, CPF, conta de luz e endereço de 169 pessoas.

- **Quem pode**: `adm`, `vendedor` e `engenheiro`. Técnico e estoque não
  precisam disso para trabalhar — o técnico precisa da OS, o estoque do
  equipamento. É o princípio da necessidade do art. 6º da LGPD. Esconder o link
  no menu é cortesia; quem barra é `exigirAcessoDocumentos()`, chamada nas
  **quatro** portas do servidor: lista, dossiê, download e upload.
- **Quem viu**: `documento_acesso` registra envio e download com usuário e hora.
  `documento_id` é `ON DELETE SET NULL` e a descrição fica copiada em texto —
  auditoria que some junto com o objeto auditado não é auditoria.

### Conectando o Drive

Uma conexão só, **da empresa**, não uma por usuário: ninguém da equipe precisa
de conta no Google. O Selebi age como `bbsolucoesengenharia` ao criar pasta,
gravar arquivo e devolver arquivo.

É por isso que **o download passa pelo Selebi** (`/documentos/arquivo/<id>`) e
não pelo link do Drive: se a tela só mostrasse o link, quem não tem conta Google
esbarraria na tela de login do Google.

Sete passos no [console do Google](https://console.cloud.google.com), uma vez só
— estão detalhados no cabeçalho de `src/documentos/autorizar-drive.ts`. Dois
deles enganam:

- O Google renomeou a **"Tela de permissão OAuth"** para **Google Auth
  Platform**, com as opções repartidas em *Público-alvo*, *Branding* e
  *Clientes*. Procurar pelo nome antigo não acha.
- O e-mail da conta precisa estar em **Público-alvo → Usuários de teste**.
  Sem isso o consentimento é recusado com "o app não concluiu o processo de
  verificação" e não há como seguir.

Depois:

```bash
npm run drive:autorizar
```

Ele sobe um servidor local, recebe o retorno do Google e **imprime o refresh
token no terminal**, para o dono colar no `.env`. O token não expira e dá acesso
ao Drive inteiro da empresa — guardar como se guarda senha.

Sem as credenciais o sistema funciona: mostra o dossiê e o link do Drive, e
avisa na tela que enviar e baixar pelo Selebi ainda não está ligado.

**Sem comprimir.** Decisão explícita do dono e a certa: comprimir PDF escaneado
é degradar um papel que pode virar prova.

### As migrations de `documento` são aplicadas à mão

`drizzle/0001-documento.sql` até `0006-protocolo.sql` são escritas à mão e
aplicadas com `docker exec -i bb-pg psql -U postgres -d bbsolucoes < arquivo`.
Não estão no `_journal.json` e **`npm run db:migrate` não as conhece**.

Não foi preguiça. O `drizzle-kit generate` produziu um `0001` que recriava o
`tipo_documento` com a lista antiga de valores, derrubava o índice `os_numero_idx`
e readicionava colunas que já tinham sido aplicadas à mão em agosto — rodar aquilo
num banco limpo daria um schema diferente do que está em produção, calado. O
arquivo foi removido junto com o snapshot dele, para que `db:migrate` não o
encontre nunca.

O preço disso é que o próximo `npm run db:generate` vai comparar com o
`0000_snapshot` e propor recriar tudo de novo. Quando isso acontecer, o caminho é
gerar, **ler o SQL antes de aplicar** e apagar o que já existe — não rodar no
escuro.

## De onde vem o que sabemos de cada API

Esta tabela existe porque a diferença importa. "A Growatt exige 5 minutos entre
chamadas" esteve escrito no código como se fosse cláusula, e não é — é
comportamento observado. Quem for depurar isso daqui a um ano precisa saber
qual das duas coisas está lendo.

| Portal | Documentação | Lida? | O que é observado, e não documentado |
| --- | --- | --- | --- |
| **Growatt** | *Server Open API protocol standards*, 44 p., [pública](https://growatt.pl/wp-content/uploads/2020/01/Growatt-Server-Open-API-protocol-standards.pdf) | sim, 22/09/2026 | **Todo o limite de frequência.** A doc não traz teto de chamadas nem por minuto nem por dia. `10012` lá é "Energy storage machine does not exist"; aqui aparece ao repetir `plant/list` em menos de 5 min |
| **Solis** | *SolisCloud Platform API Document V2.0.2*, 129 p., [pública](https://oss.soliscloud.com/templet/SolisCloud%20Platform%20API%20Document%20V2.0.2.pdf) | sim, 22/09/2026 | Nada relevante. Limites e base conferem |
| **Huawei** | *SmartPVMS Northbound Interface Reference*, atrás do portal de suporte | **não** | Os limites por endpoint no texto abaixo. O único número confirmado é "five times every 10 minutes" por usuário northbound, e que `407` é estouro |
| **FoxESS** | OpenPlatform | **não** | Tudo. Uma usina só, risco baixo |
| **Hoymiles** | *Open API for S-Miles Cloud* V1.15, 70 p., confidencial | 8 páginas | Fica para quando a chave chegar — a V1.15 já apagou toda a geração anterior de rotas, e estudar agora pode ser estudar o que vai mudar |

O que a Solis e a Growatt confirmaram:

- **Solis** — *"The update frequency for all interface data is 5 minutes"*: o
  dado só muda de cinco em cinco minutos do lado deles, então a cadência de 15
  min está folgada de propósito. *"Interface frequency limit 2 times/sec"* por
  endpoint; o coletor faz três chamadas por conta, em endpoints diferentes.
- **Growatt** — nenhum limite publicado. O teto de 1.200 chamadas/dia em
  `conta_portal` é **orçamento nosso**, não regra deles.

E vale dizer o que ler documentação **não** resolveria. O que mais custou tempo
neste projeto não está em documento nenhum: o `capacity` da Huawei documentado
em MW e entregue em kWp; o `peak_power` da Growatt metade em kWp e metade em
MW, porque é digitado à mão; `dayPowerGeneration` da Solis, que não é geração e
sim hora de sol pleno; a barra no fim da URL que devolve HTTP 500. Isso só sai
conferindo o número contra a realidade física.

## Como as quatro APIs convivem

Quatro portais coletando, com limites e feitios diferentes. O que as junta é
`npm run atualizar`, e três regras.

### 1. Ninguém consulta portal à noite

Depois do pôr do sol nenhuma usina gera e o total do dia já fechou. A rodada das
**19h é a de fechamento**; das 20h às 4h não se fala com ninguém. Corta 9 das 24
rodadas — quase 40% das chamadas, sem perder um dado.

O orçamento é a parte escassa, não o tempo: a Growatt **bloqueia IP** por
frequência e a Northbound da Huawei tem teto diário. A detecção e as
importações de planilha continuam rodando à noite, porque são locais.

### 2. Cada portal no seu passo

| Portal | Usinas | Cadência | O que aperta |
| --- | --- | --- | --- |
| Growatt | 143 | 60 min, lotes de 40 | ~5 min entre listagens; IP bloqueado se insistir |
| Huawei | 16 | 60 min | 5 logins/10 min (confirmado); 1/min por endpoint e teto diário **não conferidos** |
| Solis | 6 | 15 min | 2.000/dia; dados mudam a cada 5 min do lado deles |
| FoxESS | 1 | 15 min | 1.440/dia por dispositivo |

A Growatt varre em lotes porque 143 chamadas por rodada seriam 3.400 no dia. A
fila é ordenada por quem está mais desatualizado, então uma rodada cortada por
`10012` continua de onde parou, sem guardar estado. Cada chamada traz sete dias,
o que também tapa buraco de dia sem coleta. Parque inteiro a cada quatro horas.

O intervalo horário não é chute: é o que [o mercado usa para frota
residencial](https://www.surgepv.com/best-solar-software/operations-maintenance)
— agregar as APIs dos fabricantes num painel só, com alerta por regra sobre
queda de produção. Poll de 5 minutos é para controle em tempo real, que não é o
nosso caso.

### 3. Só quem fala com o portal carimba `ultimaColetaEm`

Este campo é a trava de cadência, não um "última atualização" genérico.
Planilha não gasta chamada, então não carimba.

Isso já mordeu: `importar-dispositivos.ts` carimbava, rodava antes da coleta, e
o coletor da OpenAPI via "coletado há 0 minutos" **em toda rodada**. A Growatt,
86% do parque, nunca seria coletada pela API — em silêncio, com o resumo
mostrando ✓ em tudo. Hoje as duas importações de planilha só rodam quando
`GROWATT_API_TOKEN` está fora do `.env`, como plano B.

### A tela `/coleta`

Um portal por linha: última coleta, cadência, cobertura e último erro.

Existe por um motivo medido. Em 22/09/2026 o sistema estava **onze dias sem
coletar nada** e ninguém percebeu — os coletores funcionavam, a tela de usinas
mostrava números, e os números eram de 11 de setembro. **Dado velho é pior que
dado ausente**: uma usina parada há dez dias aparece "gerando" se ninguém olhar
a data, e o alerta não abre porque não houve leitura nova para disparar a
detecção.

Atrasado é passar de **duas vezes** a cadência, não de uma. Rodada perdida
acontece, e tela sempre vermelha é tela que ninguém olha.

### Para rodar sozinho

```bash
powershell -ExecutionPolicy Bypass -File scripts/agendar-windows.ps1
```

No PowerShell **como administrador**. Agenda de hora em hora, das 5h às 19h, com
log em `logs/atualizar.log`. Sobe o container do Postgres antes, porque o caso
mais comum é a máquina ter acabado de ligar.

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
