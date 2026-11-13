"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";

import { DISPONIBILIDADE_KWH, ehLigacao, ROTULO_LIGACAO, sugerirSistema, type Ligacao } from "@/proposta/calculo";

export interface ModeloParaEscolher {
  id: string;
  rotulo: string;
  potenciaW: number | null;
}

/** "632", "1.250,5" → número; o resto vira nulo. */
function lerNumero(texto: string): number | null {
  let t = texto.replace(/\s/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const br = (n: number, casas: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: casas });

/**
 * O dimensionamento do sistema no cadastro do projeto: tudo o que a proposta
 * comercial precisa além do cliente e do valor — consumo, ligação, kit,
 * potência, telhado e concessionária.
 *
 * Com o consumo, a ligação e o módulo escolhidos, sugere quantos módulos zeram
 * a conta (a mesma conta da proposta). É sugestão: quem vende clica em "Usar"
 * ou digita outra quantidade.
 */
export function Dimensionamento({
  modulos,
  inversores,
  telhados,
  premissas,
}: {
  modulos: ModeloParaEscolher[];
  inversores: ModeloParaEscolher[];
  telhados: string[];
  /** Irradiação e desempenho da empresa (ou a sugestão, se o adm ainda não salvou). */
  premissas: { irradiacaoDia: number; desempenho: number };
}) {
  const [consumo, setConsumo] = useState("");
  const [ligacao, setLigacao] = useState<Ligacao | "">("");
  const [moduloId, setModuloId] = useState("");
  const [moduloQtd, setModuloQtd] = useState("");
  const [potencia, setPotencia] = useState("");
  const [potenciaDigitada, setPotenciaDigitada] = useState(false);

  const modulo = modulos.find((m) => m.id === moduloId) ?? null;
  const qtd = Number.parseInt(moduloQtd, 10);
  // A potência acompanha os módulos até alguém digitar outra.
  const potenciaDoKit = modulo?.potenciaW && qtd > 0 ? (qtd * modulo.potenciaW) / 1000 : null;
  const potenciaMostrada = potenciaDigitada ? potencia : potenciaDoKit ? br(potenciaDoKit, 3) : "";

  const consumoKwh = lerNumero(consumo);
  const sugestao = consumoKwh ? sugerirSistema(consumoKwh, ligacao || "bifasico", premissas, modulo?.potenciaW) : null;

  function usarSugestao() {
    if (!sugestao) return;
    if (sugestao.modulos) {
      setModuloQtd(String(sugestao.modulos));
      setPotenciaDigitada(false);
    } else {
      setPotencia(br(sugestao.kwp, 2));
      setPotenciaDigitada(true);
    }
  }

  return (
    <div className="form-ficha">
      <div className="dupla">
        <label>
          Consumo médio (kWh/mês)
          <input name="consumoMedioKwh" inputMode="decimal" placeholder="500" value={consumo} onChange={(e) => setConsumo(e.target.value)} />
          <small className="entrada-ajuda">A média dos 12 meses da conta de luz.</small>
        </label>
        <label>
          Tipo de ligação
          <select name="ligacao" value={ligacao} onChange={(e) => setLigacao(ehLigacao(e.target.value) ? e.target.value : "")}>
            <option value="">Ainda não sei</option>
            {(Object.keys(DISPONIBILIDADE_KWH) as Ligacao[]).map((l) => (
              <option key={l} value={l}>
                {ROTULO_LIGACAO[l]}
              </option>
            ))}
          </select>
          <small className="entrada-ajuda">Está na conta de luz. Sem ela, vale o que o técnico anotar na vistoria.</small>
        </label>
        <label>
          Concessionária
          <input name="concessionaria" list="concessionarias" placeholder="Energisa Sergipe" />
          <datalist id="concessionarias">
            <option value="Energisa Sergipe" />
            <option value="Sulgipe" />
          </datalist>
        </label>
      </div>

      <div className="dupla">
        <label>
          Módulo
          <select name="moduloModeloId" value={moduloId} onChange={(e) => setModuloId(e.target.value)}>
            <option value="">{modulos.length ? "Escolha do catálogo…" : "Catálogo vazio"}</option>
            {modulos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="curto">
          Quantos
          <input name="moduloQtd" type="number" min={1} max={9999} value={moduloQtd} onChange={(e) => setModuloQtd(e.target.value)} />
        </label>
        <label>
          Inversor
          <select name="inversorModeloId" defaultValue="">
            <option value="">{inversores.length ? "Escolha do catálogo…" : "Catálogo vazio"}</option>
            {inversores.map((m) => (
              <option key={m.id} value={m.id}>
                {m.rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="curto">
          Quantos
          <input name="inversorQtd" type="number" min={1} max={999} defaultValue="" placeholder="1" />
        </label>
      </div>

      {sugestao && (
        <div className="sugestao-sistema" role="status">
          <Sparkles size={15} aria-hidden />
          <span>
            Para {br(consumoKwh!, 0)} kWh/mês:{" "}
            <strong>
              {sugestao.modulos
                ? `${sugestao.modulos} módulos de ${br(modulo!.potenciaW!, 0)} W = ${br(sugestao.kwp, 2)} kWp`
                : `cerca de ${br(sugestao.kwp, 2)} kWp`}
            </strong>
            , gerando perto de {br(sugestao.geracaoMes, 0)} kWh/mês.
            {!modulo && modulos.length > 0 && " Escolha o módulo para saber quantos."}
          </span>
          <button type="button" className="botao secundario" onClick={usarSugestao}>
            Usar
          </button>
        </div>
      )}

      <div className="dupla">
        <label>
          Potência (kWp)
          <input
            name="potenciaKwp"
            inputMode="decimal"
            placeholder="em branco: módulos × potência"
            value={potenciaMostrada}
            onChange={(e) => {
              setPotencia(e.target.value);
              setPotenciaDigitada(true);
            }}
          />
        </label>
        <label>
          Tipo de telhado
          <select name="telhadoTipo" defaultValue="">
            <option value="">Ainda não sei</option>
            {telhados.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <small className="entrada-ajuda">A vistoria do técnico confirma ou corrige.</small>
        </label>
      </div>
    </div>
  );
}
