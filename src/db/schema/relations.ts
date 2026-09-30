import { relations } from "drizzle-orm";

import {
  cliente,
  contaPortal,
  empresa,
  equipamento,
  unidadeConsumidora,
  usina,
  usuario,
  vinculoPortal,
} from "./cadastro";
import { documento, documentoAcesso, exigenciaDocumento } from "./documentos";
import {
  comentario,
  etapa,
  modeloOs,
  modeloOsItem,
  serialInstalado,
  ordemServico,
  osAnexo,
  osChecklistItem,
  osEvento,
  projeto,
  projetoEvento,
} from "./operacao";
import { alerta, leitura, notificacao, tarifa } from "./monitoramento";
import { posicaoAtual } from "./rastreamento";

export const empresaRelations = relations(empresa, ({ many }) => ({
  usuarios: many(usuario),
  clientes: many(cliente),
  usinas: many(usina),
  contasPortal: many(contaPortal),
  projetos: many(projeto),
  ordensServico: many(ordemServico),
  tarifas: many(tarifa),
  notificacoes: many(notificacao),
}));

export const usuarioRelations = relations(usuario, ({ one, many }) => ({
  empresa: one(empresa, {
    fields: [usuario.empresaId],
    references: [empresa.id],
  }),
  projetosResponsavel: many(projeto),
  ordensResponsavel: many(ordemServico),
  ordensAbertas: many(ordemServico, { relationName: "osAbertaPor" }),
  comentarios: many(comentario),
}));

export const clienteRelations = relations(cliente, ({ one, many }) => ({
  empresa: one(empresa, {
    fields: [cliente.empresaId],
    references: [empresa.id],
  }),
  unidadesConsumidoras: many(unidadeConsumidora),
  usinas: many(usina),
  projetos: many(projeto),
  ordensServico: many(ordemServico),
  documentos: many(documento),
}));

export const documentoRelations = relations(documento, ({ one, many }) => ({
  empresa: one(empresa, { fields: [documento.empresaId], references: [empresa.id] }),
  cliente: one(cliente, { fields: [documento.clienteId], references: [cliente.id] }),
  projeto: one(projeto, { fields: [documento.projetoId], references: [projeto.id] }),
  enviadoPor: one(usuario, {
    fields: [documento.criadoPor],
    references: [usuario.id],
  }),
  acessos: many(documentoAcesso),
}));

export const documentoAcessoRelations = relations(documentoAcesso, ({ one }) => ({
  documento: one(documento, {
    fields: [documentoAcesso.documentoId],
    references: [documento.id],
  }),
  usuario: one(usuario, {
    fields: [documentoAcesso.usuarioId],
    references: [usuario.id],
  }),
}));

export const exigenciaDocumentoRelations = relations(
  exigenciaDocumento,
  ({ one }) => ({
    etapa: one(etapa, {
      fields: [exigenciaDocumento.etapaId],
      references: [etapa.id],
    }),
  }),
);

export const unidadeConsumidoraRelations = relations(
  unidadeConsumidora,
  ({ one, many }) => ({
    empresa: one(empresa, {
      fields: [unidadeConsumidora.empresaId],
      references: [empresa.id],
    }),
    cliente: one(cliente, {
      fields: [unidadeConsumidora.clienteId],
      references: [cliente.id],
    }),
    usinas: many(usina),
  }),
);

export const usinaRelations = relations(usina, ({ one, many }) => ({
  empresa: one(empresa, { fields: [usina.empresaId], references: [empresa.id] }),
  cliente: one(cliente, { fields: [usina.clienteId], references: [cliente.id] }),
  unidadeConsumidora: one(unidadeConsumidora, {
    fields: [usina.unidadeConsumidoraId],
    references: [unidadeConsumidora.id],
  }),
  equipamentos: many(equipamento),
  vinculosPortal: many(vinculoPortal),
  leituras: many(leitura),
  alertas: many(alerta),
  ordensServico: many(ordemServico),
}));

export const equipamentoRelations = relations(equipamento, ({ one, many }) => ({
  empresa: one(empresa, {
    fields: [equipamento.empresaId],
    references: [empresa.id],
  }),
  usina: one(usina, { fields: [equipamento.usinaId], references: [usina.id] }),
  leituras: many(leitura),
}));

export const contaPortalRelations = relations(contaPortal, ({ one, many }) => ({
  empresa: one(empresa, {
    fields: [contaPortal.empresaId],
    references: [empresa.id],
  }),
  vinculos: many(vinculoPortal),
}));

export const vinculoPortalRelations = relations(vinculoPortal, ({ one }) => ({
  empresa: one(empresa, {
    fields: [vinculoPortal.empresaId],
    references: [empresa.id],
  }),
  usina: one(usina, { fields: [vinculoPortal.usinaId], references: [usina.id] }),
  contaPortal: one(contaPortal, {
    fields: [vinculoPortal.contaPortalId],
    references: [contaPortal.id],
  }),
}));

export const etapaRelations = relations(etapa, ({ one, many }) => ({
  empresa: one(empresa, { fields: [etapa.empresaId], references: [empresa.id] }),
  projetos: many(projeto),
}));

export const projetoRelations = relations(projeto, ({ one, many }) => ({
  empresa: one(empresa, { fields: [projeto.empresaId], references: [empresa.id] }),
  cliente: one(cliente, { fields: [projeto.clienteId], references: [cliente.id] }),
  usina: one(usina, { fields: [projeto.usinaId], references: [usina.id] }),
  etapa: one(etapa, { fields: [projeto.etapaId], references: [etapa.id] }),
  responsavel: one(usuario, {
    fields: [projeto.responsavelId],
    references: [usuario.id],
  }),
  eventos: many(projetoEvento),
  documentos: many(documento),
  seriais: many(serialInstalado),
  ordensServico: many(ordemServico),
}));

export const serialInstaladoRelations = relations(serialInstalado, ({ one }) => ({
  projeto: one(projeto, {
    fields: [serialInstalado.projetoId],
    references: [projeto.id],
  }),
  usina: one(usina, {
    fields: [serialInstalado.usinaId],
    references: [usina.id],
  }),
  registradoPor: one(usuario, {
    fields: [serialInstalado.registradoPor],
    references: [usuario.id],
  }),
}));

export const projetoEventoRelations = relations(projetoEvento, ({ one }) => ({
  projeto: one(projeto, {
    fields: [projetoEvento.projetoId],
    references: [projeto.id],
  }),
  etapaDe: one(etapa, {
    fields: [projetoEvento.etapaDeId],
    references: [etapa.id],
    relationName: "etapaDe",
  }),
  etapaPara: one(etapa, {
    fields: [projetoEvento.etapaParaId],
    references: [etapa.id],
    relationName: "etapaPara",
  }),
  usuario: one(usuario, {
    fields: [projetoEvento.usuarioId],
    references: [usuario.id],
  }),
}));

export const ordemServicoRelations = relations(ordemServico, ({ one, many }) => ({
  empresa: one(empresa, {
    fields: [ordemServico.empresaId],
    references: [empresa.id],
  }),
  cliente: one(cliente, {
    fields: [ordemServico.clienteId],
    references: [cliente.id],
  }),
  usina: one(usina, { fields: [ordemServico.usinaId], references: [usina.id] }),
  responsavel: one(usuario, {
    fields: [ordemServico.responsavelId],
    references: [usuario.id],
  }),
  abertaPor: one(usuario, {
    fields: [ordemServico.abertaPorId],
    references: [usuario.id],
    relationName: "osAbertaPor",
  }),
  projeto: one(projeto, { fields: [ordemServico.projetoId], references: [projeto.id] }),
  osOrigem: one(ordemServico, {
    fields: [ordemServico.osOrigemId],
    references: [ordemServico.id],
    relationName: "retorno",
  }),
  retornos: many(ordemServico, { relationName: "retorno" }),
  checklist: many(osChecklistItem),
  anexos: many(osAnexo),
  eventos: many(osEvento),
  alertas: many(alerta),
}));

export const osChecklistItemRelations = relations(osChecklistItem, ({ one, many }) => ({
  ordemServico: one(ordemServico, {
    fields: [osChecklistItem.ordemServicoId],
    references: [ordemServico.id],
  }),
  respondidoPor: one(usuario, {
    fields: [osChecklistItem.respondidoPorId],
    references: [usuario.id],
  }),
  anexos: many(osAnexo),
}));

export const osAnexoRelations = relations(osAnexo, ({ one }) => ({
  ordemServico: one(ordemServico, {
    fields: [osAnexo.ordemServicoId],
    references: [ordemServico.id],
  }),
  enviadoPor: one(usuario, {
    fields: [osAnexo.enviadoPorId],
    references: [usuario.id],
  }),
  checklistItem: one(osChecklistItem, {
    fields: [osAnexo.checklistItemId],
    references: [osChecklistItem.id],
  }),
  documento: one(documento, { fields: [osAnexo.documentoId], references: [documento.id] }),
}));

export const osEventoRelations = relations(osEvento, ({ one }) => ({
  ordemServico: one(ordemServico, {
    fields: [osEvento.ordemServicoId],
    references: [ordemServico.id],
  }),
  usuario: one(usuario, { fields: [osEvento.usuarioId], references: [usuario.id] }),
}));

export const modeloOsRelations = relations(modeloOs, ({ one, many }) => ({
  empresa: one(empresa, { fields: [modeloOs.empresaId], references: [empresa.id] }),
  itens: many(modeloOsItem),
}));

export const modeloOsItemRelations = relations(modeloOsItem, ({ one }) => ({
  modelo: one(modeloOs, { fields: [modeloOsItem.modeloId], references: [modeloOs.id] }),
}));

export const comentarioRelations = relations(comentario, ({ one }) => ({
  empresa: one(empresa, {
    fields: [comentario.empresaId],
    references: [empresa.id],
  }),
  autor: one(usuario, { fields: [comentario.autorId], references: [usuario.id] }),
}));

export const leituraRelations = relations(leitura, ({ one }) => ({
  usina: one(usina, { fields: [leitura.usinaId], references: [usina.id] }),
  equipamento: one(equipamento, {
    fields: [leitura.equipamentoId],
    references: [equipamento.id],
  }),
}));

export const alertaRelations = relations(alerta, ({ one }) => ({
  empresa: one(empresa, { fields: [alerta.empresaId], references: [empresa.id] }),
  usina: one(usina, { fields: [alerta.usinaId], references: [usina.id] }),
  ordemServico: one(ordemServico, {
    fields: [alerta.ordemServicoId],
    references: [ordemServico.id],
  }),
}));

export const posicaoAtualRelations = relations(posicaoAtual, ({ one }) => ({
  usuario: one(usuario, { fields: [posicaoAtual.usuarioId], references: [usuario.id] }),
  ordemServico: one(ordemServico, {
    fields: [posicaoAtual.ordemServicoId],
    references: [ordemServico.id],
  }),
}));
