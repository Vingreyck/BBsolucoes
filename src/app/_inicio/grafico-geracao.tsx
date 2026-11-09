"use client";

import { useState } from "react";

import { energiaTexto } from "../formatar";

/**
 * A geração do parque, uma coluna por dia. Coluna, e não linha, porque a
 * energia de um dia é um total fechado, não um sinal contínuo; é como os
 * portais dos fabricantes mostram o mês, e quem lê já está acostumado.
 *
 * Passar o mouse (ou as setas, com o gráfico em foco) mostra o dia e o valor.
 * A tabela escondida repete tudo para leitor de tela.
 */

export interface DiaGrafico {
  /** AAAA-MM-DD */
  dia: string;
  kwh: number | null;
}

const DIA_LONGO = new Intl.DateTimeFormat("pt-BR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const DIA_CURTO = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const NUMERO_EIXO = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

const quando = (dia: string) => new Date(`${dia}T12:00:00Z`);

/** Passo "redondo" do eixo: 1, 2, 2,5 ou 5 vezes uma potência de dez. */
function passoRedondo(alvo: number): number {
  const p = 10 ** Math.floor(Math.log10(alvo));
  for (const m of [1, 2, 2.5, 5]) if (m * p >= alvo) return m * p;
  return 10 * p;
}

/** Três marcas no máximo, e a coluna mais alta perto do topo. */
function escala(maior: number): { teto: number; marcas: number[] } {
  if (maior <= 0) return { teto: 1, marcas: [0] };
  const passo = passoRedondo(maior / 3);
  const teto = Math.ceil(maior / passo) * passo;
  const marcas: number[] = [];
  for (let v = 0; v <= teto + passo / 2; v += passo) marcas.push(v);
  return { teto, marcas };
}

export function GraficoGeracao({ dias, media }: { dias: DiaGrafico[]; media: number | null }) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const maior = Math.max(0, ...dias.map((d) => d.kwh ?? 0));
  const { teto, marcas } = escala(maior);
  // Um eixo, uma unidade: em MWh quando o topo passa de mil kWh.
  const emMwh = teto >= 1000;
  const rotuloEixo = (v: number) => NUMERO_EIXO.format(emMwh ? v / 1000 : v);
  const n = dias.length;
  const dia = ativo !== null ? dias[ativo] : null;

  function teclas(e: React.KeyboardEvent) {
    const atual = ativo ?? n - 1;
    const proximo =
      e.key === "ArrowLeft" ? Math.max(0, atual - 1)
      : e.key === "ArrowRight" ? Math.min(n - 1, atual + 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? n - 1
      : null;
    if (proximo === null) return;
    e.preventDefault();
    setAtivo(proximo);
  }

  // A dica fica sobre a coluna, mas nas pontas encosta para dentro do gráfico.
  const lado = ativo === null ? "" : ativo < 3 ? " inicio" : ativo > n - 4 ? " fim" : "";

  return (
    <div className="grafico-geracao">
      <div className="grafico-eixo-y" aria-hidden>
        {marcas.map((m) => (
          <span key={m} style={{ bottom: `${(m / teto) * 100}%` }}>
            {rotuloEixo(m)}
            {m === marcas[marcas.length - 1] && <small> {emMwh ? "MWh" : "kWh"}</small>}
          </span>
        ))}
      </div>

      <div
        className="grafico-area"
        role="group"
        tabIndex={0}
        aria-label={`Geração por dia nos últimos ${n} dias. Use as setas para ler cada dia.`}
        onKeyDown={teclas}
        onFocus={() => setAtivo((a) => a ?? n - 1)}
        onBlur={() => setAtivo(null)}
        onPointerLeave={() => setAtivo(null)}
      >
        <div className="grafico-grade" aria-hidden>
          {marcas.map((m) => (
            <span key={m} style={{ bottom: `${(m / teto) * 100}%` }} />
          ))}
        </div>

        {media !== null && media > 0 && (
          <div className="grafico-media" style={{ bottom: `${(media / teto) * 100}%` }} aria-hidden>
            <span>média</span>
          </div>
        )}

        <div className="grafico-colunas" aria-hidden>
          {dias.map((d, i) => (
            <div
              key={d.dia}
              className={`grafico-coluna${i === ativo ? " ativa" : ""}`}
              onPointerEnter={() => setAtivo(i)}
              onPointerDown={() => setAtivo(i)}
            >
              <span
                className={`grafico-barra${d.kwh === null ? " sem-dado" : ""}`}
                style={{
                  height: d.kwh === null ? undefined : `${Math.max(0.5, (d.kwh / teto) * 100)}%`,
                  animationDelay: `${i * 14}ms`,
                }}
              />
            </div>
          ))}
        </div>

        <div
          className={`grafico-dica${dia ? " visivel" : ""}${lado}`}
          style={ativo !== null ? { left: `${((ativo + 0.5) / n) * 100}%` } : undefined}
          aria-live="polite"
        >
          {dia && (
            <>
              <strong>{dia.kwh === null ? "sem leitura" : energiaTexto(dia.kwh)}</strong>
              <span>{DIA_LONGO.format(quando(dia.dia))}</span>
            </>
          )}
        </div>
      </div>

      <div className="grafico-eixo-x" aria-hidden>
        {dias.map((d, i) =>
          (n - 1 - i) % 7 === 0 ? (
            <span key={d.dia} style={{ left: `${((i + 0.5) / n) * 100}%` }}>
              {DIA_CURTO.format(quando(d.dia))}
            </span>
          ) : null,
        )}
      </div>

      <table className="sr-only">
        <caption>Geração do parque por dia</caption>
        <thead>
          <tr>
            <th scope="col">Dia</th>
            <th scope="col">Geração</th>
          </tr>
        </thead>
        <tbody>
          {dias.map((d) => (
            <tr key={d.dia}>
              <td>{DIA_LONGO.format(quando(d.dia))}</td>
              <td>{d.kwh === null ? "sem leitura" : energiaTexto(d.kwh)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
