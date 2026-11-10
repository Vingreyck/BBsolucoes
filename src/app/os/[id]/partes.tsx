import { Check, Pencil, Smartphone, Undo2, X } from "lucide-react";

import type { OsCompleta } from "@/os/consultas";
import { detalheDoEvento, textoDaResposta } from "@/os/formatar";
import { faltaNoItem } from "@/os/regras-item";
import { formatarInstante } from "@/os/relogio";
import { EVENTO_ROTULO, ORIGEM_EVENTO_ROTULO } from "@/os/tipos";

import {
  acaoOsAction,
  marcarVisitaDeVoltaAction,
  removerAnexoAction,
  responderItemAction,
} from "../actions";
import { EnviarFoto } from "./enviar-foto";

/*
 * Peças da tela de detalhe da OS. Tudo componente de servidor e formulário
 * comum: funciona sem JavaScript, que é o que a tela de login já ensinou —
 * o celular de campo com sinal ruim carrega o HTML e já consegue usar.
 */

type Item = OsCompleta["checklist"][number];
type Evento = OsCompleta["eventos"][number];

/** Um formulário de ação que pede motivo: lista + detalhe livre. */
export function FormMotivo({
  osId,
  acao,
  motivos,
  botao,
  perigo = false,
  detalheObrigatorio = false,
}: {
  osId: string;
  acao: string;
  motivos: string[];
  botao: string;
  perigo?: boolean;
  detalheObrigatorio?: boolean;
}) {
  return (
    <form action={acaoOsAction.bind(null, osId)} className="form-acao">
      <input type="hidden" name="acao" value={acao} />
      <select name="motivo" required={!detalheObrigatorio} defaultValue="">
        <option value="" disabled>
          Motivo…
        </option>
        {motivos.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <input
        type="text"
        name="motivoDetalhe"
        placeholder={detalheObrigatorio ? "Explique" : "Detalhe (obrigatório em “Outro”)"}
        required={detalheObrigatorio}
        maxLength={400}
      />
      <button type="submit" className={`botao${perigo ? " perigo" : ""}`}>
        {botao}
      </button>
    </form>
  );
}

function CampoResposta({ item }: { item: Item }) {
  const v = item.valor;
  switch (item.tipoResposta) {
    case "check":
      return (
        <label className="resposta-marcar">
          <input type="checkbox" name="valor" value="sim" defaultChecked={v === true} />
          <span>
            <Check size={15} aria-hidden /> Feito
          </span>
        </label>
      );
    case "sim_nao":
      return (
        <div className="resposta-segmentada" role="radiogroup" aria-label={item.descricao}>
          <label>
            <input type="radio" name="valor" value="sim" defaultChecked={v === true} required />
            <span>
              <Check size={15} aria-hidden /> Sim
            </span>
          </label>
          <label>
            <input type="radio" name="valor" value="nao" defaultChecked={v === false} />
            <span>
              <X size={15} aria-hidden /> Não
            </span>
          </label>
        </div>
      );
    case "numero":
      return (
        <label className="resposta-numero">
          <input
            type="text"
            inputMode="decimal"
            name="valor"
            defaultValue={typeof v === "number" ? String(v).replace(".", ",") : ""}
            placeholder="0"
            required
          />
          {item.unidade && <span>{item.unidade}</span>}
        </label>
      );
    case "texto":
      return <textarea name="valor" rows={2} defaultValue={typeof v === "string" ? v : ""} required maxLength={2000} />;
    case "escolha":
      // Poucas opções viram botões (vê tudo de uma vez); muitas ficam na lista.
      if ((item.opcoes ?? []).length <= 6)
        return (
          <div className="resposta-chips" role="radiogroup" aria-label={item.descricao}>
            {(item.opcoes ?? []).map((o, i) => (
              <label key={o}>
                <input type="radio" name="valor" value={o} defaultChecked={v === o} required={i === 0} />
                <span>{o}</span>
              </label>
            ))}
          </div>
        );
      return (
        <select name="valor" defaultValue={typeof v === "string" ? v : ""} required>
          <option value="" disabled>
            Escolha…
          </option>
          {(item.opcoes ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "multipla":
      return (
        <div className="resposta-chips" role="group" aria-label={item.descricao}>
          {(item.opcoes ?? []).map((o) => (
            <label key={o}>
              <input type="checkbox" name="valor" value={o} defaultChecked={Array.isArray(v) && v.includes(o)} />
              <span>
                <Check size={13} aria-hidden /> {o}
              </span>
            </label>
          ))}
        </div>
      );
    case "serial":
      return (
        <textarea
          name="valor"
          rows={2}
          defaultValue={Array.isArray(v) ? v.join("\n") : ""}
          placeholder="Um número de série por linha"
          required
        />
      );
    default:
      return null;
  }
}

/** Um item do checklist: resposta, fotos e — se pode — os formulários. */
export function ItemChecklist({
  osId,
  item,
  podeResponder,
  podeRemoverDe,
}: {
  osId: string;
  item: Item;
  podeResponder: boolean;
  /** Quem pode tirar uma foto: a gestão tira qualquer uma; o técnico, as dele. */
  podeRemoverDe: (enviadoPorId: string | null) => boolean;
}) {
  const fotos = item.anexos.length;
  const faltaFoto = item.fotosMinimas > 0 && fotos < item.fotosMinimas;
  const falta = item.concluido
    ? null
    : faltaNoItem(item, { valor: item.valor, fotos, observacao: item.observacao, agendar: item.agendar });
  const dicaObservacao =
    item.exigeObservacao === "sempre"
      ? "Observação (obrigatória)"
      : item.exigeObservacao === "sem_foto"
        ? "Observação (obrigatória se não houver foto)"
        : "Observação (opcional)";
  const respondido = item.respondidoEm !== null;
  const estado = item.concluido ? "cumprido" : item.obrigatorio ? "pendente" : "";

  return (
    <li id={`item-${item.id}`} className={`item-os ${estado}`}>
      <div className="item-topo">
        <span className="marca-item" aria-hidden>
          {item.concluido ? "✓" : item.obrigatorio ? "!" : "·"}
        </span>
        <span className="item-nome">{item.descricao}</span>
        {item.obrigatorio && !item.concluido && <span className="obrigatorio">obrigatório</span>}
        {item.agendar && <span className="obrigatorio">fica para a visita de volta</span>}
        {(item.fotosMinimas > 0 || item.tipoResposta === "foto") && (
          <span className={`fotos-contador${faltaFoto ? " falta" : ""}`}>
            {fotos}/{Math.max(item.fotosMinimas, 1)} foto{Math.max(item.fotosMinimas, 1) > 1 ? "s" : ""}
          </span>
        )}
      </div>
      {item.ajuda && <p className="item-ajuda">{item.ajuda}</p>}
      {falta && item.obrigatorio && <p className="item-ajuda">{falta}.</p>}

      {(respondido || item.tipoResposta === "foto") && (
        <p className="item-resposta">
          <strong>{textoDaResposta(item)}</strong>
          {item.respondidoPor && item.respondidoEm && (
            <span className="fraco">
              {" "}
              · {item.respondidoPor.nome}, {formatarInstante(item.respondidoEm, false)}
            </span>
          )}
        </p>
      )}
      {item.observacao && <p className="item-obs">{item.observacao}</p>}

      {fotos > 0 && (
        <div className="fotos-item">
          {item.anexos.map((a) => (
            <figure key={a.id}>
              {a.mime?.startsWith("video/") ? (
                <video src={`/os/anexo/${a.id}`} controls preload="metadata" />
              ) : (
                <a href={`/os/anexo/${a.id}`} target="_blank" rel="noopener">
                  {/* eslint-disable-next-line @next/next/no-img-element -- vem do Drive pelo proxy autenticado */}
                  <img src={`/os/anexo/${a.id}`} alt={`Foto: ${item.descricao}`} loading="lazy" />
                </a>
              )}
              <figcaption>
                {a.capturadoEm ? formatarInstante(a.capturadoEm, false) : ""}
                {a.latitude && a.longitude && (
                  <>
                    {" · "}
                    <a href={`https://www.google.com/maps?q=${a.latitude},${a.longitude}`} target="_blank" rel="noopener">
                      local
                    </a>
                  </>
                )}
                {podeResponder && podeRemoverDe(a.enviadoPorId) && (
                  <form action={removerAnexoAction.bind(null, osId, a.id)} className="form-mini">
                    <button type="submit" className="link-perigo" title="Tirar esta foto (vai para a lixeira do Drive)">
                      tirar
                    </button>
                  </form>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {podeResponder && (
        <div className="item-forms">
          {(item.tipoResposta !== "foto" || item.exigeObservacao !== "nao") &&
            (respondido ? (
              <details className="item-alterar">
                <summary>
                  <Pencil size={13} aria-hidden /> Alterar resposta
                </summary>
                <FormResposta osId={osId} item={item} dica={dicaObservacao} />
              </details>
            ) : (
              <FormResposta osId={osId} item={item} dica={dicaObservacao} />
            ))}
          <div className="item-acoes">
            <EnviarFoto
              osId={osId}
              itemId={item.id}
              aceitaVideo={item.aceitaVideo}
              texto={item.aceitaVideo ? "Adicionar foto ou vídeo" : fotos ? "Adicionar outra foto" : "Adicionar foto"}
            />
            {item.permiteAgendar && (
              <form action={marcarVisitaDeVoltaAction.bind(null, osId, item.id)} className="form-mini">
                <input type="hidden" name="agendar" value={item.agendar ? "nao" : "sim"} />
                <button
                  type="submit"
                  className="botao secundario"
                  title={
                    item.agendar
                      ? "O item volta a ser cobrado nesta visita."
                      : "Conta como feito agora; a conclusão abre uma OS só com os itens deixados."
                  }
                >
                  <Undo2 size={14} aria-hidden /> {item.agendar ? "Fazer nesta visita" : "Deixar para a visita de volta"}
                </button>
              </form>
            )}
            {item.apenasCamera && (
              <span className="item-camera">
                <Smartphone size={13} aria-hidden /> No app, só foto tirada na hora
              </span>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/** A resposta do item: o campo do tipo certo, a observação e o salvar. */
function FormResposta({ osId, item, dica }: { osId: string; item: Item; dica: string }) {
  return (
    <form action={responderItemAction.bind(null, osId, item.id)} className="form-resposta">
      <input type="hidden" name="tipoResposta" value={item.tipoResposta} />
      {item.tipoResposta !== "foto" && <CampoResposta item={item} />}
      <div className="form-resposta-linha">
        <input
          type="text"
          name="observacao"
          defaultValue={item.observacao ?? ""}
          placeholder={dica}
          aria-label={dica}
          required={item.exigeObservacao === "sempre"}
          maxLength={2000}
        />
        <button type="submit" className="botao secundario">
          Salvar
        </button>
      </div>
    </form>
  );
}

export function Historico({ eventos }: { eventos: Evento[] }) {
  return (
    <ol className="historico">
      {[...eventos].reverse().map((e) => {
        const detalhe = detalheDoEvento(e);
        return (
          <li key={e.id} className={`ev-${e.tipo}`}>
            <span className="quando">{formatarInstante(e.ocorridoEm, false)}</span>
            <span className="o-que">
              <strong>{EVENTO_ROTULO[e.tipo] ?? e.tipo}</strong>
              {detalhe && <span className="detalhe"> {detalhe}</span>}
              <span className="quem">
                {e.usuario?.nome ?? (e.origem === "sistema" ? "Selebi" : "—")}
                {" · "}
                {ORIGEM_EVENTO_ROTULO[e.origem] ?? e.origem}
                {e.latitude && e.longitude && (
                  <>
                    {" · "}
                    <a href={`https://www.google.com/maps?q=${e.latitude},${e.longitude}`} target="_blank" rel="noopener">
                      no mapa{e.precisaoM ? ` (±${e.precisaoM} m)` : ""}
                    </a>
                  </>
                )}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
