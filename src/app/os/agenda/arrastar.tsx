"use client";

import { CalendarClock, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { agendarArrastando } from "./actions";

/**
 * Arrastar e soltar na agenda: a OS da fila (ou já marcada) cai numa pessoa
 * e num dia.
 *
 * A agenda continua desenhada no servidor; este componente só escuta. Os
 * cartões que podem ir trazem `data-os-*`, as casas da grade trazem
 * `data-dia` e `data-pessoa`. Ao soltar, abre uma janelinha com o horário (e
 * o motivo, se for reagendamento), porque soltar num dia não diz a hora.
 *
 * Sem mouse (celular, teclado) continua valendo agendar pela tela da OS.
 */

interface Arrastado {
  id: string;
  rotulo: string;
  hora: string;
  tinhaData: boolean;
}

interface Pedido {
  os: Arrastado;
  pessoa: string;
  pessoaNome: string;
  dia: string;
  diaRotulo: string;
}

export function AgendaArrastavel({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const arrastado = useRef<Arrastado | null>(null);
  const alvo = useRef<HTMLElement | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, iniciar] = useTransition();

  const casa = (e: React.DragEvent) => (e.target as HTMLElement).closest<HTMLElement>("td[data-dia]");

  function marcarAlvo(td: HTMLElement | null) {
    if (alvo.current === td) return;
    alvo.current?.classList.remove("alvo");
    td?.classList.add("alvo");
    alvo.current = td;
  }

  function terminar() {
    marcarAlvo(null);
    arrastado.current = null;
    caixa.current?.classList.remove("arrastando");
  }

  useEffect(() => {
    if (!pedido) return;
    const fechar = (e: KeyboardEvent) => e.key === "Escape" && setPedido(null);
    window.addEventListener("keydown", fechar);
    return () => window.removeEventListener("keydown", fechar);
  }, [pedido]);

  function agendar(form: FormData) {
    if (!pedido) return;
    const hora = String(form.get("hora") ?? "");
    const motivo = String(form.get("motivo") ?? "");
    iniciar(async () => {
      const r = await agendarArrastando(pedido.os.id, {
        responsavelId: pedido.pessoa || null,
        dia: pedido.dia,
        hora,
        motivo,
      });
      if (r.erro) {
        setErro(r.erro);
        return;
      }
      setPedido(null);
      router.refresh();
    });
  }

  return (
    <div
      ref={caixa}
      className="agenda agenda-arrastavel"
      onDragStart={(e) => {
        const cartao = (e.target as HTMLElement).closest<HTMLElement>("[data-os-id]");
        if (!cartao) return;
        arrastado.current = {
          id: cartao.dataset.osId!,
          rotulo: cartao.dataset.osRotulo ?? "",
          hora: cartao.dataset.hora || "08:00",
          tinhaData: cartao.dataset.tinhaData === "1",
        };
        e.dataTransfer.setData("text/plain", cartao.dataset.osRotulo ?? "");
        e.dataTransfer.effectAllowed = "move";
        caixa.current?.classList.add("arrastando");
      }}
      onDragEnd={terminar}
      onDragOver={(e) => {
        const td = casa(e);
        if (!td || !arrastado.current) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        marcarAlvo(td);
      }}
      onDragLeave={(e) => {
        const td = casa(e);
        if (td && !td.contains(e.relatedTarget as Node | null)) marcarAlvo(null);
      }}
      onDrop={(e) => {
        const td = casa(e);
        const os = arrastado.current;
        terminar();
        if (!td || !os) return;
        e.preventDefault();
        setErro("");
        setPedido({
          os,
          pessoa: td.dataset.pessoa ?? "",
          pessoaNome: td.dataset.pessoaNome ?? "",
          dia: td.dataset.dia!,
          diaRotulo: td.dataset.diaRotulo ?? td.dataset.dia!,
        });
      }}
    >
      {children}

      {pedido && (
        <div className="dialogo-fundo" onClick={() => !salvando && setPedido(null)}>
          <form
            className="dialogo"
            role="dialog"
            aria-modal="true"
            aria-labelledby="agendar-titulo"
            onClick={(e) => e.stopPropagation()}
            action={agendar}
          >
            <header className="dialogo-topo">
              <span className="dialogo-icone" aria-hidden>
                <CalendarClock size={18} />
              </span>
              <div>
                <h2 id="agendar-titulo">{pedido.os.tinhaData ? "Reagendar" : "Agendar"}</h2>
                <p>{pedido.os.rotulo}</p>
              </div>
              <button type="button" className="botao-icone" onClick={() => setPedido(null)} aria-label="Fechar">
                <X size={16} aria-hidden />
              </button>
            </header>

            <dl className="dialogo-resumo">
              <div>
                <dt>Quem vai</dt>
                <dd>{pedido.pessoaNome || "Sem responsável"}</dd>
              </div>
              <div>
                <dt>Dia</dt>
                <dd>{pedido.diaRotulo}</dd>
              </div>
            </dl>

            <label className="entrada">
              <span className="entrada-rotulo">Horário</span>
              <input type="time" name="hora" defaultValue={pedido.os.hora} required autoFocus />
            </label>
            {pedido.os.tinhaData && (
              <label className="entrada">
                <span className="entrada-rotulo">Motivo do reagendamento</span>
                <input name="motivo" required placeholder="Ex.: o cliente pediu outro dia" maxLength={200} />
              </label>
            )}

            {erro && (
              <p className="dialogo-erro" role="alert">
                {erro}
              </p>
            )}

            <div className="dialogo-acoes">
              <button type="button" className="botao secundario" onClick={() => setPedido(null)} disabled={salvando}>
                Cancelar
              </button>
              <button type="submit" className="botao" disabled={salvando}>
                {salvando ? "Agendando…" : pedido.os.tinhaData ? "Reagendar" : "Agendar"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
