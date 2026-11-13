"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { cpfValido, normalizarCpf } from "@/auth/cpf";
import { exigirUsuario } from "@/auth/sessao";
import { db } from "@/db";
import { sincronizarDatasheets } from "@/projeto/datasheets";
import { OPCOES_DE_TELHADO } from "@/projeto/da-vistoria";
import { ehFormaPagamento } from "@/projeto/pagamento";
import { ehLigacao } from "@/proposta/calculo";
import { excluirProjeto } from "@/projeto/excluir";
import {
  cliente as clienteTable,
  comentario,
  etapa as etapaTable,
  modeloEquipamento,
  projeto as projetoTable,
  projetoEvento,
  serialInstalado,
  usina as usinaTable,
} from "@/db/schema";
import { reconciliarSeriais } from "@/collectors/reconciliar";

const texto = (d: FormData, campo: string) => {
  const v = String(d.get(campo) ?? "").trim();
  return v === "" ? null : v;
};

const numero = (d: FormData, campo: string) => {
  const v = texto(d, campo);
  if (v === null) return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? String(n) : null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * CPF ou CNPJ do formulário, só com dígitos. Vazio é permitido (o campo é
 * opcional); preenchido, precisa ter os dígitos verificadores certos, para o
 * erro de digitação aparecer agora e não virar um cliente que ninguém acha.
 */
function documentoDoCliente(d: FormData): { doc: string | null; tipo: "pf" | "pj" } | "invalido" {
  const digitos = normalizarCpf(String(d.get("cpf") ?? ""));
  if (!digitos) return { doc: null, tipo: "pf" };
  if (digitos.length === 11) return cpfValido(digitos) ? { doc: digitos, tipo: "pf" } : "invalido";
  if (digitos.length === 14) return { doc: digitos, tipo: "pj" };
  return "invalido";
}

/**
 * Endereço e contato do formulário. É daqui que o app do técnico tira a rota:
 * rua + número + bairro + cidade vão para o mapa do celular.
 */
function contatoDoCliente(d: FormData) {
  const uf = texto(d, "uf");
  const cep = (texto(d, "cep") ?? "").replace(/\D/g, "");
  return {
    telefone: texto(d, "telefone"),
    logradouro: texto(d, "logradouro"),
    numero: texto(d, "numero")?.slice(0, 20) ?? null,
    complemento: texto(d, "complemento"),
    bairro: texto(d, "bairro"),
    cidade: texto(d, "cidade"),
    uf: uf ? uf.toUpperCase().slice(0, 2) : null,
    // Só vale com os 8 dígitos; o contrato não sai com CEP pela metade.
    cep: cep.length === 8 ? cep : null,
  };
}

/** A forma de pagamento escolhida, ou nada se veio algo fora da lista. */
function pagamentoDoFormulario(d: FormData) {
  const forma = texto(d, "formaPagamento");
  return {
    formaPagamento: ehFormaPagamento(forma) ? forma : null,
    pagamentoCondicoes: texto(d, "pagamentoCondicoes"),
    valor: numero(d, "valor"),
  };
}

/**
 * O kit, a potência e o telhado do formulário.
 *
 * O kit vem do catálogo de equipamentos. O id chega do formulário: só vale se
 * for um modelo desta empresa e do tipo certo (inversor no campo do inversor,
 * módulo no do módulo). Potência em branco sai dos módulos × potência de cada um.
 */
async function kitDoFormulario(dados: FormData, empresaId: string) {
  const catalogo = await db.select().from(modeloEquipamento).where(eq(modeloEquipamento.empresaId, empresaId));
  const doCatalogo = (id: string | null, tipos: string[]) => catalogo.find((m) => m.id === id && tipos.includes(m.tipo)) ?? null;
  const inteiro = (campo: string) => {
    const n = Number.parseInt(texto(dados, campo) ?? "", 10);
    return n > 0 && n < 10_000 ? n : null;
  };
  const inversor = doCatalogo(texto(dados, "inversorModeloId"), ["inversor", "microinversor"]);
  const modulo = doCatalogo(texto(dados, "moduloModeloId"), ["modulo"]);
  const moduloQtd = modulo ? inteiro("moduloQtd") : null;
  const telhado = texto(dados, "telhadoTipo");
  return {
    inversorModeloId: inversor?.id ?? null,
    inversorQtd: inversor ? (inteiro("inversorQtd") ?? 1) : null,
    moduloModeloId: modulo?.id ?? null,
    moduloQtd,
    potenciaKwp:
      numero(dados, "potenciaKwp") ??
      (modulo?.potenciaW && moduloQtd ? String(Math.round(moduloQtd * Number(modulo.potenciaW)) / 1000) : null),
    telhadoTipo: telhado && OPCOES_DE_TELHADO.includes(telhado) ? telhado : null,
  };
}

/** Monofásico, bifásico ou trifásico; o que vier fora disso vira "não sei". */
function ligacaoDoFormulario(dados: FormData) {
  const v = texto(dados, "ligacao");
  return ehLigacao(v) ? v : null;
}

/**
 * "Este projeto, e só se for da empresa de quem pede."
 *
 * O id do projeto chega pela tela, e o que vem da tela é palpite do navegador.
 * Sem a empresa no filtro, quem soubesse o id de um projeto de outra empresa
 * alteraria os dados dele — o sistema é multiempresa desde a primeira migração.
 * Id que nem tem cara de id vira um filtro que não acha nada, em vez de erro
 * do banco.
 */
function doProjetoDaEmpresa(projetoId: string, empresaId: string) {
  return and(
    eq(projetoTable.id, UUID.test(projetoId) ? projetoId : "00000000-0000-0000-0000-000000000000"),
    eq(projetoTable.empresaId, empresaId),
  );
}

/**
 * Cria um projeto na primeira etapa da esteira.
 *
 * Até agora a esteira só tinha os projetos do seed, e um cliente novo não tinha
 * onde entrar — a tela era bonita e não aceitava trabalho. Este é o começo da
 * esteira de verdade.
 *
 * O cliente pode ser um já cadastrado ou um nome novo. Como o cadastro veio dos
 * portais, quase todo mundo que já tem usina já está lá; quem chega para
 * orçamento ainda não, e obrigar a cadastrar antes só faria o vendedor desistir
 * e voltar para o WhatsApp.
 */
export async function criarProjeto(dados: FormData): Promise<void> {
  const usuario = await exigirUsuario();

  const clienteExistente = texto(dados, "clienteId");
  const usinaEscolhida = texto(dados, "usinaId");
  const nomeNovo = texto(dados, "clienteNovo");

  if (!clienteExistente && !usinaEscolhida && !nomeNovo) {
    redirect("/projeto/novo?erro=cliente");
  }

  const documento = documentoDoCliente(dados);
  if (documento === "invalido") redirect("/projeto/novo?erro=cpf");
  const contato = contatoDoCliente(dados);

  const primeira = await db.query.etapa.findFirst({
    where: and(
      eq(etapaTable.empresaId, usuario.empresaId),
      eq(etapaTable.ativa, true),
    ),
    orderBy: asc(etapaTable.ordem),
  });
  if (!primeira) {
    redirect("/projeto/novo?erro=etapa");
  }

  let clienteId = clienteExistente;

  // O id vem do formulário: precisa ser um cliente desta empresa.
  if (clienteId) {
    const daEmpresa = await db.query.cliente.findFirst({
      where: and(eq(clienteTable.id, clienteId), eq(clienteTable.empresaId, usuario.empresaId)),
      columns: { id: true },
    });
    if (!daEmpresa) redirect("/projeto/novo?erro=cliente");
  }

  // Usina do portal que ainda não tem dono: vira cliente (com o nome dela) e já fica ligada.
  if (!clienteId && usinaEscolhida) {
    const usina = await db.query.usina.findFirst({
      where: and(eq(usinaTable.id, usinaEscolhida), eq(usinaTable.empresaId, usuario.empresaId)),
      columns: { id: true, nome: true, cidade: true, clienteId: true },
    });
    if (!usina) redirect("/projeto/novo?erro=cliente");
    if (usina.clienteId) {
      clienteId = usina.clienteId;
    } else {
      const jaTem = await db.query.cliente.findFirst({
        where: and(eq(clienteTable.empresaId, usuario.empresaId), eq(clienteTable.nome, usina.nome)),
        columns: { id: true },
      });
      if (jaTem) {
        clienteId = jaTem.id;
      } else {
        const [criado] = await db
          .insert(clienteTable)
          .values({ empresaId: usuario.empresaId, nome: usina.nome, cidade: usina.cidade })
          .returning();
        clienteId = criado.id;
      }
      await db.update(usinaTable).set({ clienteId }).where(eq(usinaTable.id, usina.id));
    }
  }

  if (!clienteId && nomeNovo) {
    /**
     * Com CPF, é ele que diz se a pessoa já existe. Sem CPF, nome repetido vira
     * o mesmo cliente: a planilha dos portais não traz CPF, então é o melhor
     * critério que sobra.
     */
    const jaTem = await db.query.cliente.findFirst({
      where: and(
        eq(clienteTable.empresaId, usuario.empresaId),
        documento.doc ? eq(clienteTable.cpfCnpj, documento.doc) : eq(clienteTable.nome, nomeNovo),
      ),
      columns: { id: true },
    });
    if (jaTem) {
      clienteId = jaTem.id;
    } else {
      const [criado] = await db
        .insert(clienteTable)
        .values({
          empresaId: usuario.empresaId,
          nome: nomeNovo,
          tipo: documento.tipo,
          cpfCnpj: documento.doc,
          ...contato,
        })
        .returning();
      clienteId = criado.id;
    }
  }

  /**
   * Cliente que já existia: o que veio preenchido completa o cadastro dele, sem
   * apagar o que já estava lá. É o caso de quem comprou antes e nunca teve o
   * endereço anotado — sem endereço, o técnico não tem rota no app.
   */
  if (clienteId) {
    const atual = await db.query.cliente.findFirst({
      where: eq(clienteTable.id, clienteId),
    });
    if (atual) {
      const completar: Partial<typeof clienteTable.$inferInsert> = {};
      for (const [campo, valor] of Object.entries(contato) as [keyof typeof contato, string | null][]) {
        if (valor && !atual[campo]) completar[campo] = valor;
      }
      if (documento.doc && !atual.cpfCnpj) {
        const deOutro = await db.query.cliente.findFirst({
          where: and(eq(clienteTable.empresaId, usuario.empresaId), eq(clienteTable.cpfCnpj, documento.doc)),
          columns: { id: true },
        });
        if (!deOutro) {
          completar.cpfCnpj = documento.doc;
          completar.tipo = documento.tipo;
        }
      }
      if (Object.keys(completar).length) {
        await db
          .update(clienteTable)
          .set({ ...completar, atualizadoEm: new Date() })
          .where(eq(clienteTable.id, clienteId));
      }
    }
  }

  const agora = new Date();
  const titulo = texto(dados, "titulo") ?? "Projeto novo";
  // O que a proposta comercial usa já entra aqui: consumo, ligação, kit, potência e telhado.
  const kit = await kitDoFormulario(dados, usuario.empresaId);

  const [projeto] = await db
    .insert(projetoTable)
    .values({
      empresaId: usuario.empresaId,
      clienteId: clienteId as string,
      titulo,
      etapaId: primeira.id,
      responsavelId: usuario.id,
      etapaDesde: agora,
      prazoEtapa: primeira.prazoPadraoDias
        ? new Date(agora.getTime() + primeira.prazoPadraoDias * 86_400_000)
        : null,
      consumoMedioKwh: numero(dados, "consumoMedioKwh"),
      ligacao: ligacaoDoFormulario(dados),
      concessionaria: texto(dados, "concessionaria"),
      observacoes: texto(dados, "observacoes"),
      ...kit,
      ...pagamentoDoFormulario(dados),
    })
    .returning();

  // Com kit escolhido, o datasheet e o Inmetro entram no dossiê desde já.
  if (kit.inversorModeloId || kit.moduloModeloId) {
    await sincronizarDatasheets(usuario.empresaId, projeto.id, usuario.id);
  }

  /**
   * A entrada na esteira também é um evento. Sem ele, o primeiro trecho do
   * caminho ficaria invisível no histórico, e o tempo até sair da primeira
   * etapa nunca teria de onde ser calculado.
   */
  await db.insert(projetoEvento).values({
    empresaId: usuario.empresaId,
    projetoId: projeto.id,
    etapaParaId: primeira.id,
    usuarioId: usuario.id,
    observacao: "Projeto criado",
    ocorridoEm: agora,
  });

  revalidatePath("/");
  revalidatePath("/esteira");
  redirect(`/projeto/${projeto.id}`);
}

/** Etapa 2: o que o cliente contou e quanto ele consome. */
export async function salvarInformacoes(
  projetoId: string,
  dados: FormData,
): Promise<void> {
  const usuario = await exigirUsuario();
  await db
    .update(projetoTable)
    .set({
      consumoMedioKwh: numero(dados, "consumoMedioKwh"),
      ligacao: ligacaoDoFormulario(dados),
      concessionaria: texto(dados, "concessionaria"),
      observacoes: texto(dados, "observacoes"),
      atualizadoEm: new Date(),
    })
    .where(doProjetoDaEmpresa(projetoId, usuario.empresaId));
  revalidatePath(`/projeto/${projetoId}`);
}

/**
 * Etapa 5: o que o técnico encontrou no local.
 *
 * Quem registra fica gravado junto, e não só a data: quando alguém precisar
 * entender uma vistoria estranha meses depois, a pergunta é para uma pessoa,
 * não para o sistema.
 */
export async function salvarVistoria(
  projetoId: string,
  dados: FormData,
): Promise<void> {
  const usuario = await exigirUsuario();
  const data = texto(dados, "vistoriaEm");
  await db
    .update(projetoTable)
    .set({
      vistoriaEm: data ? new Date(`${data}T12:00:00`) : null,
      vistoriaPorId: usuario.id,
      vistoriaObservacoes: texto(dados, "vistoriaObservacoes"),
      atualizadoEm: new Date(),
    })
    .where(doProjetoDaEmpresa(projetoId, usuario.empresaId));
  revalidatePath(`/projeto/${projetoId}`);
}

/** Etapa 8: ART, memorial e o protocolo do parecer de acesso. */
export async function salvarProjetoTecnico(
  projetoId: string,
  dados: FormData,
): Promise<void> {
  const usuario = await exigirUsuario();

  // O texto do contrato só é gravado se alguém digitou. Em branco, ele é sugerido
  // na hora de gerar o contrato (kit + telhado), para o telhado da vistoria
  // entrar mesmo que a vistoria seja concluída depois.
  const equipamentos = texto(dados, "equipamentos")?.slice(0, 1000) ?? null;

  await db
    .update(projetoTable)
    .set({
      numeroArt: texto(dados, "numeroArt"),
      protocoloConcessionaria: texto(dados, "protocoloConcessionaria"),
      equipamentos,
      ...(await kitDoFormulario(dados, usuario.empresaId)),
      // O valor mora no cartão de Pagamento (`salvarPagamento`).
      atualizadoEm: new Date(),
    })
    .where(doProjetoDaEmpresa(projetoId, usuario.empresaId));

  // O datasheet e o Inmetro do kit entram (ou trocam) sozinhos no dossiê.
  await sincronizarDatasheets(usuario.empresaId, projetoId, usuario.id);

  revalidatePath(`/projeto/${projetoId}`);
  revalidatePath(`/documentos/${projetoId}`);
}

/** A forma de pagamento que o cliente aceitou no Lead. Pode mudar depois. */
export async function salvarPagamento(projetoId: string, dados: FormData): Promise<void> {
  const usuario = await exigirUsuario();
  await db
    .update(projetoTable)
    .set({ ...pagamentoDoFormulario(dados), atualizadoEm: new Date() })
    .where(doProjetoDaEmpresa(projetoId, usuario.empresaId));
  revalidatePath(`/projeto/${projetoId}`);
}

/**
 * CPF, telefone e endereço do cliente deste projeto.
 *
 * Aqui substitui o que estava (é edição), ao contrário da criação do projeto,
 * que só completa. O endereço é o que o app do técnico usa para a rota.
 */
export async function salvarCliente(projetoId: string, dados: FormData): Promise<void> {
  const usuario = await exigirUsuario();
  const projeto = await db.query.projeto.findFirst({
    where: doProjetoDaEmpresa(projetoId, usuario.empresaId),
    columns: { clienteId: true },
  });
  if (!projeto) redirect("/esteira");

  const documento = documentoDoCliente(dados);
  if (documento === "invalido") redirect(`/projeto/${projetoId}?cliente=cpf`);
  if (documento.doc) {
    const deOutro = await db.query.cliente.findFirst({
      where: and(eq(clienteTable.empresaId, usuario.empresaId), eq(clienteTable.cpfCnpj, documento.doc)),
      columns: { id: true },
    });
    if (deOutro && deOutro.id !== projeto.clienteId) redirect(`/projeto/${projetoId}?cliente=cpf-outro`);
  }

  await db
    .update(clienteTable)
    .set({
      ...contatoDoCliente(dados),
      cpfCnpj: documento.doc,
      tipo: documento.tipo,
      atualizadoEm: new Date(),
    })
    .where(and(eq(clienteTable.id, projeto.clienteId), eq(clienteTable.empresaId, usuario.empresaId)));

  revalidatePath(`/projeto/${projetoId}`);
  redirect(`/projeto/${projetoId}?cliente=ok`);
}

/**
 * Comentário preso ao projeto.
 *
 * É o que substitui a comunidade do WhatsApp sem virar chat: a conversa fica
 * junto do objeto de que se fala, e continua pesquisável seis meses depois.
 */
export async function comentar(projetoId: string, dados: FormData): Promise<void> {
  const usuario = await exigirUsuario();
  const conteudo = texto(dados, "texto");
  if (!conteudo) {
    redirect(`/projeto/${projetoId}`);
  }
  // O id vem da tela: sem conferir, um comentário entraria no projeto de outra empresa.
  const projeto = await db.query.projeto.findFirst({
    where: doProjetoDaEmpresa(projetoId, usuario.empresaId),
    columns: { id: true },
  });
  if (!projeto) redirect("/esteira");
  await db.insert(comentario).values({
    empresaId: usuario.empresaId,
    entidade: "projeto",
    entidadeId: projetoId,
    autorId: usuario.id,
    texto: conteudo,
  });
  revalidatePath(`/projeto/${projetoId}`);
}

/**
 * Anota o número de série do inversor no dia da instalação.
 *
 * É o passo que cura o cadastro duplicado. Até aqui, o sistema só descobria
 * uma usina quando ela aparecia no portal do fabricante, dias depois, com o
 * nome que o técnico digitou lá — "José Fernando7", "micaely 03" — e sem nada
 * que a ligasse a este cliente, que já está no Selebi desde a venda.
 *
 * O serial é a única coisa que os dois lados têm em comum: está na etiqueta do
 * aparelho, é único e não muda.
 *
 * Reconcilia na hora, e não só na próxima coleta, porque a usina pode já estar
 * no banco esperando dono — e ver o vínculo acontecer no mesmo clique é o que
 * ensina para que serve digitar isso.
 */
export async function anotarSerial(
  projetoId: string,
  dados: FormData,
): Promise<void> {
  const usuario = await exigirUsuario();

  const bruto = texto(dados, "numeroSerie");
  if (!bruto) redirect(`/projeto/${projetoId}?serial=vazio`);

  // Etiqueta lida à mão erra em caixa e em espaço; o serial do portal é maiúsculo.
  const serie = bruto.toUpperCase().replace(/\s+/g, "");

  const projeto = await db.query.projeto.findFirst({
    where: and(
      eq(projetoTable.id, projetoId),
      eq(projetoTable.empresaId, usuario.empresaId),
    ),
    columns: { id: true },
  });
  if (!projeto) redirect("/esteira");

  try {
    await db.insert(serialInstalado).values({
      empresaId: usuario.empresaId,
      projetoId,
      numeroSerie: serie,
      observacao: texto(dados, "observacao"),
      registradoPor: usuario.id,
    });
  } catch {
    /**
     * O índice único barrou: este serial já está em outro projeto.
     *
     * É digitação errada ou inversor remanejado de um cliente para outro, e
     * nos dois casos quem decide é gente. Gravar aqui levaria a geração de uma
     * pessoa para o dossiê de outra.
     */
    redirect(`/projeto/${projetoId}?serial=repetido`);
  }

  await reconciliarSeriais(usuario.empresaId);

  revalidatePath(`/projeto/${projetoId}`);
  revalidatePath("/usinas/sem-dono");
  redirect(`/projeto/${projetoId}?serial=ok`);
}

/** Remove um serial anotado por engano. */
export async function removerSerial(
  projetoId: string,
  serialId: string,
): Promise<void> {
  const usuario = await exigirUsuario();
  await db
    .delete(serialInstalado)
    .where(
      and(
        eq(serialInstalado.id, serialId),
        eq(serialInstalado.empresaId, usuario.empresaId),
      ),
    );
  revalidatePath(`/projeto/${projetoId}`);
}

/**
 * Exclui o projeto de verdade, em qualquer etapa — só o administrador.
 *
 * Opcionalmente leva junto os documentos do projeto e, se pedido, o cliente
 * inteiro; os arquivos vão para a **lixeira do Drive** (30 dias para voltar).
 * A palavra EXCLUIR digitada é a confirmação: o campo vem do navegador, mas é o
 * servidor que confere.
 */
export async function excluirProjetoCompleto(projetoId: string, dados: FormData): Promise<void> {
  const usuario = await exigirUsuario();
  if (usuario.papel !== "adm") redirect("/sem-acesso");

  const volta = `/projeto/${UUID.test(projetoId) ? projetoId : ""}`;
  if (String(dados.get("confirmar") ?? "").trim().toUpperCase() !== "EXCLUIR") {
    redirect(`${volta}?erro=${encodeURIComponent("Para excluir, digite EXCLUIR no campo de confirmação.")}`);
  }

  const resultado = await excluirProjeto({ empresaId: usuario.empresaId, id: usuario.id }, projetoId, {
    ordens: dados.get("ordens") === "sim",
    documentos: dados.get("documentos") === "sim",
    cliente: dados.get("cliente") === "sim",
  });
  if ("erro" in resultado) redirect(`${volta}?erro=${encodeURIComponent(resultado.erro)}`);

  revalidatePath("/");
  revalidatePath("/esteira");
  revalidatePath("/documentos");
  redirect(`/esteira?ok=${encodeURIComponent(resultado.ok)}`);
}
