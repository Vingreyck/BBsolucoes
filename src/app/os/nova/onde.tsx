"use client";

import { MapPin } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Cartao } from "../../_ui";

/** Nestes tipos a usina ainda não existe: a vistoria é antes da venda e a instalação é quem a cria. */
const SEM_USINA = ["vistoria", "instalacao"];

export interface UsinaDoCliente {
  id: string;
  nome: string;
  cidade: string | null;
}

export interface VendaDoCliente {
  id: string;
  titulo: string;
  etapa: string;
}

/**
 * O "Onde" da nova OS: a usina e a venda a que ela serve.
 *
 * Acompanha o tipo escolhido lá em cima (o `select` é do formulário, não daqui):
 * - **vistoria ou instalação:** a usina não existe ainda, então o campo some e
 *   não é enviado. Se a venda já veio escolhida (a OS foi aberta pelo projeto),
 *   o cartão inteiro vira uma linha só, porque não há o que decidir;
 * - **qualquer outro tipo** (corretiva, preventiva, limpeza, garantia): é de uma
 *   usina que já existe, e o cartão volta inteiro.
 */
export function OndeDaOs({
  tipoInicial,
  usinas,
  usinaPadrao,
  vendas,
  vendaPadrao,
}: {
  tipoInicial: string;
  usinas: UsinaDoCliente[];
  usinaPadrao: string;
  vendas: VendaDoCliente[];
  vendaPadrao: string;
}) {
  const [tipo, setTipo] = useState(tipoInicial);
  const ancora = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const campo = ancora.current?.closest("form")?.elements.namedItem("tipo");
    if (!(campo instanceof HTMLSelectElement)) return;
    const ler = () => setTipo(campo.value);
    ler();
    campo.addEventListener("change", ler);
    return () => campo.removeEventListener("change", ler);
  }, []);

  const semUsina = SEM_USINA.includes(tipo);
  const venda = vendas.find((v) => v.id === vendaPadrao);

  return (
    <>
      <span ref={ancora} hidden />
      {semUsina && venda ? (
        <p className="ajuda" style={{ margin: "0 0 0.25rem" }}>
          <MapPin size={13} aria-hidden style={{ verticalAlign: "-2px" }} /> Venda: <strong>{venda.titulo}</strong> · {venda.etapa}.
          Concluída, a OS anda a esteira sozinha.
          <input type="hidden" name="projetoId" value={venda.id} />
        </p>
      ) : (
        <Cartao titulo={semUsina ? "Venda" : "Onde"} icone={<MapPin size={16} />}>
          <div className="form-ficha">
            <div className="dupla">
              {!semUsina && (
                <label>
                  Usina
                  <select name="usinaId" defaultValue={usinaPadrao}>
                    <option value="">Nenhuma</option>
                    {usinas.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.nome}
                        {u.cidade ? ` · ${u.cidade}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Venda (projeto)
                <select name="projetoId" defaultValue={vendaPadrao}>
                  <option value="">Nenhuma — não é de uma venda</option>
                  {vendas.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.titulo} · {v.etapa}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="ajuda">
              {semUsina
                ? "A usina ainda não existe: ela aparece no portal depois da instalação. "
                : ""}
              Ligada à venda, a OS aparece no projeto, as fotos que viram documento entram no dossiê e, concluída, a
              vistoria ou a instalação andam a esteira sozinhas.
            </p>
          </div>
        </Cartao>
      )}
    </>
  );
}
