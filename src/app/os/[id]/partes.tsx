import type { OsCompleta } from "@/os/consultas";
import { detalheDoEvento, textoDaResposta } from "@/os/formatar";
import { formatarInstante } from "@/os/relogio";
import { EVENTO_ROTULO, ORIGEM_EVENTO_ROTULO } from "@/os/tipos";

import { acaoOsAction, anexarAction, removerAnexoAction, responderItemAction } from "../actions";

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
        <label className="linha-check">
          <input type="checkbox" name="valor" value="sim" defaultChecked={v === true} /> Feito
        </label>
      );
    case "sim_nao":
      return (
        <div className="linha-radios">
          <label>
            <input type="radio" name="valor" value="sim" defaultChecked={v === true} required /> Sim
          </label>
          <label>
            <input type="radio" name="valor" value="nao" defaultChecked={v === false} /> Não
          </label>
        </div>
      );
    case "numero":
      return (
        <label className="linha-numero">
          <input
            type="text"
            inputMode="decimal"
            name="valor"
            defaultValue={typeof v === "number" ? String(v).replace(".", ",") : ""}
            required
          />
          {item.unidade && <span>{item.unidade}</span>}
        </label>
      );
    case "texto":
      return <textarea name="valor" rows={2} defaultValue={typeof v === "string" ? v : ""} required maxLength={2000} />;
    case "escolha":
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
        <div className="linha-radios">
          {(item.opcoes ?? []).map((o) => (
            <label key={o}>
              <input type="checkbox" name="valor" value={o} defaultChecked={Array.isArray(v) && v.includes(o)} /> {o}
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
        {(item.fotosMinimas > 0 || item.tipoResposta === "foto") && (
          <span className={`fotos-contador${faltaFoto ? " falta" : ""}`}>
            {fotos}/{Math.max(item.fotosMinimas, 1)} foto{Math.max(item.fotosMinimas, 1) > 1 ? "s" : ""}
          </span>
        )}
      </div>
      {item.ajuda && <p className="item-ajuda">{item.ajuda}</p>}

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
              <a href={`/os/anexo/${a.id}`} target="_blank" rel="noopener">
                {/* eslint-disable-next-line @next/next/no-img-element -- vem do Drive pelo proxy autenticado */}
                <img src={`/os/anexo/${a.id}`} alt={`Foto: ${item.descricao}`} loading="lazy" />
              </a>
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
          {item.tipoResposta !== "foto" && (
            <details open={!respondido && item.obrigatorio}>
              <summary>{respondido ? "Mudar resposta" : "Responder"}</summary>
              <form action={responderItemAction.bind(null, osId, item.id)} className="form-resposta">
                <input type="hidden" name="tipoResposta" value={item.tipoResposta} />
                <CampoResposta item={item} />
                <input
                  type="text"
                  name="observacao"
                  defaultValue={item.observacao ?? ""}
                  placeholder="Observação (opcional)"
                  maxLength={2000}
                />
                <button type="submit" className="botao secundario">
                  Salvar
                </button>
              </form>
            </details>
          )}
          <form action={anexarAction.bind(null, osId)} className="form-foto">
            <input type="hidden" name="itemId" value={item.id} />
            <input type="file" name="arquivo" accept="image/jpeg,image/png" capture="environment" multiple required />
            <button type="submit" className="botao secundario">
              Enviar foto
            </button>
          </form>
          {item.apenasCamera && (
            <p className="nota">No app, este item só aceita foto tirada na hora, pela câmera.</p>
          )}
        </div>
      )}
    </li>
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
