import "dotenv/config";

import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

import { and, eq, inArray } from "drizzle-orm";

import { ordemDoUsuario, ordensDoUsuario } from "@/app-movel/ordens";
import type { UsuarioApp } from "@/auth/sessao-app";
import { db, schema } from "@/db";

import { ErroOs, type Ator } from "./acesso";
import { carregarOs, contarPorStatus, listarOs, tempoEmCampo, vistoriaDoProjeto } from "./consultas";
import { abrirRetorno, criarOs, executarAcao } from "./fluxo";
import { garantirModelos } from "./modelos";
import { anotar } from "./notas";
import { renderizarRelatorio } from "./relatorio";
import { recalcularItem, responderItem } from "./respostas";

/**
 * Confere as regras da OS contra o banco de verdade, sem site nem app.
 *
 *   npm run testar:os
 *   npm run testar:os -- --pdf caminho/relatorio.pdf   (guarda o PDF gerado)
 *
 * Cria um cliente, um projeto e dois usuários de teste, passa a OS pelo ciclo
 * inteiro — abrir, agendar, sair, iniciar, responder, travar sem foto, concluir
 * e andar a esteira — e apaga tudo no fim, dê certo ou errado. Não toca o
 * Drive: as fotos entram direto na tabela, com arquivo fictício.
 */

let falhas = 0;
let total = 0;
function confere(condicao: unknown, descricao: string, detalhe?: unknown) {
  total++;
  if (condicao) {
    console.log(`  ok  ${descricao}`);
  } else {
    falhas++;
    console.log(`  FALHOU  ${descricao}`, detalhe ?? "");
  }
}

async function recusa(promessa: Promise<unknown>, codigo: string, descricao: string) {
  try {
    await promessa;
    confere(false, descricao, "(passou, devia ter recusado)");
  } catch (e) {
    confere(e instanceof ErroOs && e.codigo === codigo, descricao, e instanceof Error ? e.message : e);
  }
}

/** Um PNG de verdade, 96×64, de uma cor só — para o PDF desenhar uma imagem. */
function pngDeTeste(): Buffer {
  const largura = 96;
  const altura = 64;
  const crcTabela = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTabela[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const bloco = (tipo: string, dados: Buffer) => {
    const t = Buffer.from(tipo, "ascii");
    const tam = Buffer.alloc(4);
    tam.writeUInt32BE(dados.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(Buffer.concat([t, dados])));
    return Buffer.concat([tam, t, dados, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; // bits
  ihdr[9] = 2; // RGB
  const linha = Buffer.concat([Buffer.from([0]), Buffer.from(Array(largura).fill([168, 82, 31]).flat())]);
  const cru = Buffer.concat(Array(altura).fill(linha));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco("IHDR", ihdr),
    bloco("IDAT", deflateSync(cru)),
    bloco("IEND", Buffer.alloc(0)),
  ]);
}

async function main() {
  const empresa = await db.query.empresa.findFirst({ columns: { id: true, nome: true } });
  if (!empresa) throw new Error("Nenhuma empresa no banco.");
  const etapaExecucao = await db.query.etapa.findFirst({
    where: and(eq(schema.etapa.empresaId, empresa.id), eq(schema.etapa.slug, "execucao")),
  });
  if (!etapaExecucao) throw new Error('A esteira não tem a etapa "execucao".');

  const marca = `teste-os-${Date.now()}`;
  const criados = { usuarios: [] as string[], cliente: "", projeto: "", os: [] as string[] };

  try {
    // --- preparação -------------------------------------------------------
    const [adm, tecnico, outroTecnico] = await db
      .insert(schema.usuario)
      .values(
        ["adm", "tecnico", "tecnico"].map((papel, i) => ({
          empresaId: empresa.id,
          nome: `Teste OS ${papel} ${i} (pode apagar)`,
          email: `${marca}-${i}@teste.invalid`,
          senhaHash: "x",
          papel: papel as "adm" | "tecnico",
          ativo: true,
          aprovadoEm: new Date(),
        })),
      )
      .returning({ id: schema.usuario.id, nome: schema.usuario.nome });
    criados.usuarios.push(adm.id, tecnico.id, outroTecnico.id);

    const gestao: Ator = { id: adm.id, nome: adm.nome, empresaId: empresa.id, papel: "adm", origem: "web", gestao: true };
    const tec: Ator = { id: tecnico.id, nome: tecnico.nome, empresaId: empresa.id, papel: "tecnico", origem: "app", gestao: false };
    const intruso: Ator = { ...tec, id: outroTecnico.id, nome: outroTecnico.nome };

    const [cliente] = await db
      .insert(schema.cliente)
      .values({
        empresaId: empresa.id,
        tipo: "pf",
        nome: "Cliente Teste do Selebi (pode apagar)",
        cidade: "São Cristóvão",
        uf: "SE",
        logradouro: "Rua do Teste",
        numero: "12",
      })
      .returning({ id: schema.cliente.id });
    criados.cliente = cliente.id;

    const [projeto] = await db
      .insert(schema.projeto)
      .values({ empresaId: empresa.id, clienteId: cliente.id, titulo: "Projeto teste OS", etapaId: etapaExecucao.id })
      .returning({ id: schema.projeto.id });
    criados.projeto = projeto.id;

    // --- modelos ------------------------------------------------------------
    console.log("\nModelos");
    await garantirModelos(empresa.id);
    await garantirModelos(empresa.id); // de novo: não pode duplicar
    const modelos = await db.query.modeloOs.findMany({
      where: eq(schema.modeloOs.empresaId, empresa.id),
      with: { itens: true },
    });
    confere(modelos.length === 6, "seis modelos, sem duplicar na segunda chamada", modelos.length);
    const instalacao = modelos.find((m) => m.tipo === "instalacao");
    confere((instalacao?.itens.length ?? 0) >= 10, "instalação vem com o checklist", instalacao?.itens.length);
    const vistoriaModelo = modelos.find((m) => m.tipo === "vistoria");
    confere((vistoriaModelo?.itens.length ?? 0) >= 15, "vistoria com o roteiro dos 12 itens", vistoriaModelo?.itens.length);
    confere(
      vistoriaModelo?.itens.some((i) => i.chave === "disjuntor_amperagem" && i.tipoDocumento === "foto_padrao"),
      "foto do disjuntor da vistoria vai para o dossiê como foto do padrão",
    );

    // --- abrir --------------------------------------------------------------
    console.log("\nAbrir");
    await recusa(
      criarOs(tec, { clienteId: cliente.id, tipo: "corretiva", prioridade: "normal", descricao: "x" }),
      "sem_permissao",
      "técnico não abre OS",
    );
    await recusa(
      criarOs(gestao, { clienteId: cliente.id, tipo: "corretiva", prioridade: "normal", descricao: "   " }),
      "validacao",
      "descrição vazia é recusada",
    );
    const os1 = await criarOs(gestao, {
      clienteId: cliente.id,
      projetoId: projeto.id,
      tipo: "instalacao",
      prioridade: "alta",
      descricao: "Instalar 10 módulos e 1 inversor — teste automático.",
      responsavelId: tecnico.id,
    });
    criados.os.push(os1.id);
    let os = await carregarOs(gestao, os1.id);
    confere(os.status === "aberta", "nasce a agendar", os.status);
    confere(os.checklist.length === instalacao?.itens.length, "checklist copiado do modelo", os.checklist.length);
    confere(
      os.eventos.map((e) => e.tipo).join(",") === "criada,atribuida",
      "histórico: aberta e responsável definido",
      os.eventos.map((e) => e.tipo),
    );
    await recusa(carregarOs(intruso, os1.id), "nao_encontrada", "outro técnico nem enxerga a OS");

    // --- agendar ------------------------------------------------------------
    console.log("\nAgendar");
    await recusa(
      executarAcao(tec, os1.id, { tipo: "agendar", agendadaPara: new Date(Date.UTC(2026, 9, 1, 8)) }),
      "sem_permissao",
      "técnico não agenda",
    );
    await executarAcao(gestao, os1.id, { tipo: "agendar", agendadaPara: new Date(Date.UTC(2026, 9, 1, 8)) });
    await recusa(
      executarAcao(gestao, os1.id, { tipo: "agendar", agendadaPara: new Date(Date.UTC(2026, 9, 2, 8)) }),
      "validacao",
      "reagendar pede motivo",
    );
    await executarAcao(gestao, os1.id, {
      tipo: "agendar",
      agendadaPara: new Date(Date.UTC(2026, 9, 2, 8)),
      motivo: "Chuva ou tempo ruim",
    });
    os = await carregarOs(gestao, os1.id);
    confere(os.status === "agendada", "agendada", os.status);
    confere(os.agendadaPara?.toISOString().startsWith("2026-10-02T08:00"), "hora de relógio gravada como digitada", os.agendadaPara);

    // --- executar -----------------------------------------------------------
    console.log("\nExecutar");
    const idDeslocamento = crypto.randomUUID();
    const r1 = await executarAcao(tec, os1.id, { tipo: "deslocamento" }, { idCliente: idDeslocamento });
    const r2 = await executarAcao(tec, os1.id, { tipo: "deslocamento" }, { idCliente: idDeslocamento });
    confere(!r1.repetida && r2.repetida, "mesma ação reenviada pelo app não repete");
    await recusa(
      executarAcao(tec, os1.id, { tipo: "concluir", resultado: "resolvido" }),
      "checklist_incompleto",
      "não conclui com checklist vazio",
    );
    await recusa(executarAcao(tec, os1.id, { tipo: "pausar", motivo: "x" }), "transicao_invalida", "não pausa antes de iniciar");
    const horaChegada = new Date(Date.now() - 2 * 3_600_000);
    await executarAcao(tec, os1.id, { tipo: "iniciar" }, { ocorridoEm: horaChegada, latitude: -10.9163, longitude: -37.1996, precisao: 12 });
    os = await carregarOs(gestao, os1.id);
    const chegada = os.eventos.find((e) => e.tipo === "iniciada");
    confere(os.status === "em_andamento", "em atendimento", os.status);
    confere(Number(chegada?.latitude) === -10.9163 && Number(chegada?.longitude) === -37.1996, "chegada com GPS", chegada?.latitude);
    confere(os.iniciadaEm?.getTime() === horaChegada.getTime(), "início com a hora do celular", os.iniciadaEm);

    // --- responder ----------------------------------------------------------
    console.log("\nResponder o checklist");
    const item = (chave: string) => os.checklist.find((i) => i.chave === chave)!;
    await responderItem(tec, os1.id, item("modulos_quantidade").id, { valor: "10" });
    await recusa(
      responderItem(tec, os1.id, item("inversor_marca").id, { valor: "Marca Inventada" }),
      "valor_invalido",
      "opção fora da lista é recusada",
    );
    await responderItem(tec, os1.id, item("inversor_marca").id, { valor: "Growatt" });
    const serial = `TST ${Date.now().toString(36)}`.toLowerCase();
    await responderItem(tec, os1.id, item("serial_inversor").id, { valor: [serial] });
    await recusa(
      responderItem(intruso, os1.id, item("modulos_modelo").id, { valor: "x" }),
      "sem_permissao",
      "outro técnico não responde",
    );
    const velho = await responderItem(tec, os1.id, item("modulos_quantidade").id, {
      valor: "3",
      respondidoEm: new Date(Date.now() - 86_400_000),
    });
    confere(velho.ignorado, "resposta velha do celular não passa por cima da nova");

    os = await carregarOs(gestao, os1.id);
    confere(item("modulos_quantidade").valor === 10 && item("modulos_quantidade").concluido, "número gravado e item cumprido");
    confere(
      JSON.stringify(item("serial_inversor").valor) === JSON.stringify([serial.toUpperCase().replace(/\s+/g, "")]),
      "serial normalizado (maiúsculo, sem espaço)",
      item("serial_inversor").valor,
    );
    confere(!item("serial_inversor").concluido, "serial sem a foto da etiqueta ainda não está cumprido");
    const anotado = await db.query.serialInstalado.findFirst({
      where: eq(schema.serialInstalado.projetoId, projeto.id),
    });
    confere(anotado?.numeroSerie === serial.toUpperCase().replace(/\s+/g, ""), "serial foi para serial_instalado (liga a usina sozinho)");

    // Responde o resto e "fotografa" (anexo fictício, sem Drive).
    for (const i of os.checklist) {
      if (i.valor === null || i.valor === undefined) {
        const valor =
          i.tipoResposta === "check" || i.tipoResposta === "sim_nao" ? true
          : i.tipoResposta === "numero" ? 1
          : i.tipoResposta === "escolha" ? i.opcoes?.[0]
          : i.tipoResposta === "foto" ? null
          : "Resposta de teste";
        if (i.tipoResposta !== "foto") await responderItem(tec, os1.id, i.id, { valor });
      }
      for (let n = 0; n < Math.max(i.fotosMinimas, i.tipoResposta === "foto" ? 1 : 0); n++) {
        await db.insert(schema.osAnexo).values({
          empresaId: empresa.id,
          ordemServicoId: os1.id,
          categoria: "foto",
          caminho: "teste://sem-arquivo",
          checklistItemId: i.id,
          mime: "image/png",
          capturadoEm: new Date(),
          enviadoPorId: tecnico.id,
        });
      }
      await recalcularItem(db, i.id);
    }
    os = await carregarOs(gestao, os1.id);
    confere(os.checklist.every((i) => i.concluido), "checklist todo cumprido depois das fotos");

    // --- concluir -----------------------------------------------------------
    console.log("\nConcluir");
    await recusa(
      executarAcao(tec, os1.id, { tipo: "concluir", resultado: "resolvido" }),
      "falta_assinatura",
      "instalação não conclui sem a assinatura do cliente",
    );
    await db.insert(schema.osAnexo).values({
      empresaId: empresa.id,
      ordemServicoId: os1.id,
      categoria: "assinatura",
      caminho: "teste://sem-arquivo",
      mime: "image/png",
      capturadoEm: new Date(),
      enviadoPorId: tecnico.id,
    });
    const concluida = await executarAcao(
      tec,
      os1.id,
      { tipo: "concluir", resultado: "resolvido", laudo: "Sistema instalado e gerando.", assinaturaNome: "Maria Teste" },
      { latitude: -10.9163, longitude: -37.1996 },
    );
    os = await carregarOs(gestao, os1.id);
    const projetoDepois = await db.query.projeto.findFirst({
      where: eq(schema.projeto.id, projeto.id),
      with: { etapa: true },
    });
    confere(os.status === "concluida" && os.resultado === "resolvido", "concluída e resolvida");
    confere((os.relatorioToken?.length ?? 0) >= 30, "link do relatório gerado", os.relatorioToken);
    confere(projetoDepois?.etapa.slug !== "execucao", `esteira andou sozinha (agora em "${projetoDepois?.etapa.nome}")`);
    confere(concluida.avisos.some((a) => a.includes("avançou")), "o app é avisado de que o projeto avançou", concluida.avisos);
    confere(os.eventos.some((e) => e.tipo === "esteira" && e.origem === "sistema"), "o avanço fica no histórico da OS");
    const tempo = tempoEmCampo(os.eventos);
    confere(tempo.ms > 1.9 * 3_600_000 && tempo.ms < 2.2 * 3_600_000, "tempo em campo ≈ 2 h, pelo histórico", tempo.ms);
    await recusa(responderItem(tec, os1.id, item("modulos_modelo").id, { valor: "x" }), "os_encerrada", "checklist trava depois de concluída");

    // --- o que o app recebe ----------------------------------------------------
    console.log(String.fromCharCode(10) + "Notas e o que o app recebe");
    const idNota = crypto.randomUUID();
    const escrita = new Date(Date.now() - 30 * 60_000);
    const n1 = await anotar(tec, os1.id, "  Portão pelo lado da padaria.  ", { idCliente: idNota, criadoEm: escrita });
    const n2 = await anotar(tec, os1.id, "Portão pelo lado da padaria.", { idCliente: idNota });
    confere(!n1.repetida && n2.repetida && n1.id === n2.id, "nota reenviada pela fila do app não duplica");
    await recusa(anotar(tec, os1.id, "   "), "validacao", "nota vazia é recusada");
    await recusa(anotar(intruso, os1.id, "x"), "nao_encontrada", "outro técnico não escreve na OS dos outros");
    await anotar(gestao, os1.id, "Cliente pediu para ligar antes.");
    const noFuturo = await anotar(tec, os1.id, "Relógio adiantado.", { criadoEm: new Date(Date.now() + 86_400_000) });
    const gravadaFuturo = await db.query.comentario.findFirst({ where: eq(schema.comentario.id, noFuturo.id) });
    confere((gravadaFuturo?.criadoEm.getTime() ?? Infinity) <= Date.now(), "nota com relógio adiantado não fica no futuro");

    const usuarioApp = (id: string, nome: string, papel: "adm" | "tecnico"): UsuarioApp => ({
      id,
      nome,
      cpf: "",
      email: null,
      papel,
      empresaId: empresa.id,
      empresaNome: empresa.nome,
      deveTrocarSenha: false,
      sessaoId: "teste",
    });
    const noApp = await ordemDoUsuario(usuarioApp(tecnico.id, tecnico.nome, "tecnico"), os1.id);
    confere(noApp?.relatorio?.startsWith("/r/") && noApp.relatorio.length > 30, "app recebe o caminho do relatório", noApp?.relatorio);
    confere(
      noApp?.notas.map((n) => n.texto).join("|") ===
        "Portão pelo lado da padaria.|Cliente pediu para ligar antes.|Relógio adiantado.",
      "app recebe as notas em ordem, com o texto limpo",
      noApp?.notas.map((n) => n.texto),
    );
    confere(noApp?.notas[0].criadoEm === escrita.toISOString(), "nota guarda a hora do celular", noApp?.notas[0].criadoEm);
    confere(noApp?.notas[1].autorId === adm.id, "nota diz quem escreveu");
    confere(
      noApp?.historico[0].tipo === "esteira" || noApp?.historico[0].tipo === "concluida",
      "histórico chega do mais novo para o mais velho",
      noApp?.historico.map((h) => h.tipo),
    );
    const reag = noApp?.historico.find((h) => h.tipo === "reagendada");
    confere(reag?.titulo === "Reagendada" && reag.detalhe?.includes("Chuva"), "histórico com rótulo e motivo, como no site", reag);
    const fotosApp = noApp?.anexos.filter((a) => a.categoria === "foto") ?? [];
    confere(fotosApp.length > 0 && fotosApp.every((a) => a.enviadoPorId === tecnico.id), "anexo diz quem enviou (o app só oferece apagar a própria foto)");
    const lista = await ordensDoUsuario(usuarioApp(tecnico.id, tecnico.nome, "tecnico"));
    const naLista = lista.find((o) => o.id === os1.id);
    confere(naLista?.notas.length === 3 && naLista.historico.length > 3, "lista do app também traz notas e histórico");
    confere(!(await ordemDoUsuario(usuarioApp(outroTecnico.id, outroTecnico.nome, "tecnico"), os1.id)), "outro técnico não recebe a OS");

    // --- relatório ----------------------------------------------------------
    console.log("\nRelatório");
    const png = pngDeTeste();
    const fotos = new Map(
      os.anexos.map((a) => [a.id, { data: png, format: "png" as const }]),
    );
    const pdf = await renderizarRelatorio(os, fotos);
    confere(pdf.subarray(0, 4).toString() === "%PDF" && pdf.length > 5000, `PDF gerado (${Math.round(pdf.length / 1024)} KB)`);
    const destino = process.argv.indexOf("--pdf");
    if (destino >= 0 && process.argv[destino + 1]) {
      writeFileSync(process.argv[destino + 1], pdf);
      console.log(`      guardado em ${process.argv[destino + 1]}`);
    }

    // --- reabrir, cancelar, não atendida, retorno ---------------------------
    console.log("\nOutros caminhos");
    await recusa(executarAcao(tec, os1.id, { tipo: "reabrir", motivo: "x" }), "sem_permissao", "técnico não reabre");
    await executarAcao(gestao, os1.id, { tipo: "reabrir", motivo: "Cliente pediu revisão" });
    os = await carregarOs(gestao, os1.id);
    confere(os.status === "aberta" && !os.concluidaEm, "reaberta volta para a agendar");
    await executarAcao(gestao, os1.id, { tipo: "cancelar", motivo: "Aberta por engano" });
    confere((await carregarOs(gestao, os1.id)).status === "cancelada", "cancelada");

    const os2 = await criarOs(gestao, {
      clienteId: cliente.id,
      tipo: "corretiva",
      prioridade: "urgente",
      descricao: "Inversor em falha — teste.",
      responsavelId: tecnico.id,
      agendadaPara: new Date(Date.UTC(2026, 9, 3, 14)),
    });
    criados.os.push(os2.id);
    let segunda = await carregarOs(gestao, os2.id);
    confere(segunda.status === "agendada", "abrir já com data nasce agendada");
    confere(segunda.prazoSla !== null, "urgente tem prazo de até 24 h");
    await executarAcao(tec, os2.id, { tipo: "deslocamento" });
    await recusa(executarAcao(tec, os2.id, { tipo: "nao_atendida", motivo: " " }), "validacao", "não atendida pede motivo");
    await executarAcao(tec, os2.id, { tipo: "nao_atendida", motivo: "Cliente ausente" });
    segunda = await carregarOs(gestao, os2.id);
    confere(segunda.status === "aberta" && segunda.agendadaPara === null, "não atendida volta para a fila, sem data");

    await executarAcao(tec, os2.id, { tipo: "iniciar" });
    await recusa(
      executarAcao(tec, os2.id, { tipo: "concluir", resultado: "nao_resolvido" }),
      "checklist_incompleto",
      "nem o 'não resolvido' pula o checklist obrigatório",
    );
    // Cumpre o checklist da corretiva e conclui como não resolvido.
    for (const i of segunda.checklist) {
      if (i.tipoResposta !== "foto") {
        await responderItem(tec, os2.id, i.id, {
          valor: i.tipoResposta === "sim_nao" ? false : i.tipoResposta === "numero" ? 0 : "E-042",
        });
      }
      for (let n = 0; n < Math.max(i.fotosMinimas, i.tipoResposta === "foto" ? 1 : 0); n++) {
        await db.insert(schema.osAnexo).values({
          empresaId: empresa.id,
          ordemServicoId: os2.id,
          categoria: "foto",
          caminho: "teste://sem-arquivo",
          checklistItemId: i.id,
          mime: "image/jpeg",
        });
      }
      await recalcularItem(db, i.id);
    }
    await recusa(
      executarAcao(tec, os2.id, { tipo: "concluir", resultado: "nao_resolvido" }),
      "validacao",
      "'não resolvido' pede laudo",
    );
    await executarAcao(tec, os2.id, { tipo: "concluir", resultado: "nao_resolvido", laudo: "Falta placa de comunicação." });
    const retorno = await abrirRetorno(gestao, os2.id);
    criados.os.push(retorno.id);
    const osRetorno = await carregarOs(gestao, retorno.id);
    confere(osRetorno.osOrigem?.id === os2.id && osRetorno.prioridade === "urgente", "retorno ligado à OS de origem");
    confere(osRetorno.descricao.includes("placa de comunicação"), "retorno leva o que ficou pendente");

    // --- vistoria -----------------------------------------------------------
    console.log(String.fromCharCode(10) + "Vistoria");
    const etapaVistoria = await db.query.etapa.findFirst({
      where: and(eq(schema.etapa.empresaId, empresa.id), eq(schema.etapa.slug, "vistoria_tecnica")),
    });
    if (etapaVistoria) {
      await db
        .update(schema.projeto)
        .set({ etapaId: etapaVistoria.id })
        .where(eq(schema.projeto.id, projeto.id));
      const vist = await criarOs(gestao, {
        clienteId: cliente.id,
        projetoId: projeto.id,
        tipo: "vistoria",
        prioridade: "normal",
        descricao: "Vistoria para 10 módulos — teste.",
        responsavelId: tecnico.id,
      });
      criados.os.push(vist.id);
      let v = await carregarOs(gestao, vist.id);
      confere(v.checklist.length >= 15, "vistoria nasce com o roteiro completo", v.checklist.length);
      await executarAcao(tec, vist.id, { tipo: "iniciar" }, { latitude: -10.68, longitude: -37.42 });
      for (const i of v.checklist) {
        const valor =
          i.tipoResposta === "sim_nao" ? false
          : i.tipoResposta === "numero" ? (i.chave === "disjuntor_amperagem" ? 40 : 3)
          : i.tipoResposta === "escolha" ? (i.chave === "cabo_bitola" ? "6 mm²" : i.opcoes?.[0])
          : i.tipoResposta === "multipla" ? [i.opcoes?.[0]]
          : i.tipoResposta === "foto" ? null
          : "Resposta de teste";
        if (i.tipoResposta !== "foto") await responderItem(tec, vist.id, i.id, { valor });
        for (let n = 0; n < Math.max(i.fotosMinimas, i.tipoResposta === "foto" ? 1 : 0); n++) {
          await db.insert(schema.osAnexo).values({
            empresaId: empresa.id,
            ordemServicoId: vist.id,
            categoria: "foto",
            caminho: "teste://sem-arquivo",
            checklistItemId: i.id,
            mime: "image/jpeg",
          });
        }
        await recalcularItem(db, i.id);
      }
      const rv = await executarAcao(tec, vist.id, {
        tipo: "concluir",
        resultado: "resolvido",
        laudo: "Padrão com disjuntor de 40 A e cabo de 6 mm².",
      });
      v = await carregarOs(gestao, vist.id);
      const projVist = await db.query.projeto.findFirst({
        where: eq(schema.projeto.id, projeto.id),
        with: { etapa: true },
      });
      confere(v.status === "concluida", "vistoria concluída sem assinatura (o modelo não exige)");
      confere(projVist?.vistoriaEm && projVist.vistoriaPorId === tecnico.id, "data e autor da vistoria gravados no projeto");
      confere(projVist?.etapa.slug !== "vistoria_tecnica", `projeto saiu da vistoria (agora em "${projVist?.etapa.nome}")`, rv.avisos);
      const lida = await vistoriaDoProjeto(empresa.id, projeto.id);
      const disjuntor = lida?.checklist.find((i) => i.chave === "disjuntor_amperagem");
      confere(disjuntor?.valor === 40, "o engenheiro lê na tela do projeto o disjuntor que a vistoria viu (40 A)");
    } else {
      confere(false, 'a esteira não tem a etapa "vistoria_tecnica"');
    }

    // --- consultas ----------------------------------------------------------
    console.log("\nConsultas");
    const achadas = await listarOs(gestao, { busca: "sao cristovao", aba: "todas" });
    confere(achadas.some((o) => o.id === os1.id), "busca sem acento acha pela cidade");
    const porNumero = await listarOs(gestao, { busca: `#${String(retorno.numero).padStart(4, "0")}` });
    confere(porNumero.length === 1 && porNumero[0].id === retorno.id, "busca pelo número com cerquilha e zeros");
    const doTecnico = await listarOs(tec, {});
    confere(doTecnico.every((o) => o.responsavel?.id === tecnico.id), "técnico só lista as dele");
    const contagem = await contarPorStatus(gestao);
    confere((contagem.cancelada ?? 0) >= 1, "contagem por situação");
  } finally {
    // --- limpeza ------------------------------------------------------------
    if (criados.os.length) {
      await db.delete(schema.comentario).where(inArray(schema.comentario.entidadeId, criados.os));
      await db.update(schema.ordemServico).set({ osOrigemId: null }).where(inArray(schema.ordemServico.id, criados.os));
      await db.delete(schema.ordemServico).where(inArray(schema.ordemServico.id, criados.os));
    }
    if (criados.projeto) {
      await db.delete(schema.projetoEvento).where(eq(schema.projetoEvento.projetoId, criados.projeto));
      await db.delete(schema.projeto).where(eq(schema.projeto.id, criados.projeto));
    }
    if (criados.cliente) await db.delete(schema.cliente).where(eq(schema.cliente.id, criados.cliente));
    if (criados.usuarios.length) await db.delete(schema.usuario).where(inArray(schema.usuario.id, criados.usuarios));
    console.log("\n(dados de teste apagados)");
  }

  console.log(`\n${total - falhas} de ${total} conferências passaram.`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error("Falhou:", e);
  process.exit(1);
});
