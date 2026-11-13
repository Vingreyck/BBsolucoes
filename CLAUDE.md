# Selebi (BB Soluções)

Sistema unificado para empresa de energia solar: esteira de projetos, dossiê de documentos, ordens de serviço, monitoramento das usinas (vários portais de fabricantes) e app do técnico. Os detalhes e as decisões ficam na **memória do projeto** (índice `MEMORY.md`, carregado sozinho); leia as que tocam a tarefa antes de mexer.

## Como trabalhar

- Responder em **português**, curto e direto. Texto de tela, mensagem e comentário de código também em português.
- Explicar na conversa, passo a passo. Não criar documento, página nem artifact, a menos que seja pedido.
- **Não fazer commit nem deploy.** Quem faz é o dono do projeto (TortoiseGit e `./scripts/deploy.sh`). Dizer o que mudou e o que ele precisa rodar.
- **Nunca entrar na VM por SSH.** O dono cola os comandos lá e devolve a saída.
- Ele mesmo confere o visual das telas. Conferir o que dá por código (`typecheck`, testes), sem pedir que ele teste.

## Stack e comandos

Next 15 (App Router, server actions), Postgres com Drizzle, Docker em produção (site, coletor, banco, Caddy).

- `npm run typecheck`: sempre antes de dar algo por pronto.
- `npm run testar:regras`: regras puras, sem banco. `testar:os` precisa de banco.
- Migração é SQL à mão em `drizzle/NNNN-nome.sql`, aplicada por `npm run migrar` (tabela `migracao_aplicada`). Escrever sempre idempotente (`IF NOT EXISTS`).
- Deploy: `./scripts/deploy.sh` (backup, pull, build, migrar, subir, limpar o Docker, checar saúde). `--voltar` desfaz. Depois de todo `--build` limpar o cache do Docker.
- **`npm run db:seed` faz TRUNCATE CASCADE.** Nunca no banco de desenvolvimento do dono nem no de produção; só num banco descartável.

## Regras que não se quebram

- O repositório do site é **público**. Nunca colocar no git: segredo, `.env`, exportação dos portais, dado de cliente, chave, endereço interno. O que for sensível vai para a memória, não para o código.
- A política de segurança (CSP) usa `nonce` (`src/middleware.ts`): script escrito no HTML precisa levar o `nonce` do cabeçalho `x-nonce`.
- **Usina arquivada** (`usina.arquivada_em` preenchido, depois do recomeço) segue coletando só para análise. Toda tela ou consulta que liste usina ou alerta deve filtrar `arquivada_em is null`. Só o filtro "Arquivadas" de Usinas as mostra.
- Quem recebe OS é quem usa o app do técnico (sessão com `origem = 'app'` ou aparelho de push). Ver `quemUsaOApp` em `src/os/consultas.ts`.
- Tema claro/escuro: `data-tema` na página (script no `<head>`, `src/app/tema.ts`). A paleta escura está escrita em **dois lugares** do `globals.css` (`@media` e `:root[data-tema="escuro"]`); mudou um, mude o outro.
- Energisa: o portal recusa servidor (Akamai). A leitura vem da extensão no Chrome do usuário, logado por ele. Sem stealth, sem trocar de IP, sem cliques automáticos para driblar bloqueio, sem login automático, sem ler SMS.
- O recomeço do zero (`npm run recomecar`) é irreversível pela tela, só restaurando o backup. Sempre simular antes e confirmar o backup.

## Mapa rápido

- `src/app/`: telas (esteira, os, usinas, documentos, energisa, relatorios, alertas) e `_ui/` com os componentes comuns.
- `src/collectors/` e `src/atualizar.ts`: coleta por portal e orquestração.
- `src/os/`, `src/projeto/`, `src/documentos/`, `src/energisa/`, `src/geracao/`: regras de cada área.
- `src/app-movel/` e `/api/app/v1`: API do app do técnico (o app Android/iPhone fica em outro repositório).
- `extensao/`: extensão do Chrome da Energisa.
- `scripts/deploy.sh`, `docker-compose.yml`, `Dockerfile`: produção.
