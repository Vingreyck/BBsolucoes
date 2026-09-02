import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { exigirUsuario } from "@/auth/sessao";
import { db } from "@/db";
import { usina as usinaTable } from "@/db/schema";

import {
  salvarPasso2,
  salvarPasso3,
  salvarPasso4,
  salvarPasso5,
} from "../../actions";
import { passoPorNumero } from "../../passos";
import { Trilha } from "../../trilha";

export const dynamic = "force-dynamic";

export default async function CadastroPasso({
  params,
}: {
  params: Promise<{ id: string; passo: string }>;
}) {
  await exigirUsuario();
  const { id, passo } = await params;

  const numero = Number(passo);
  if (!passoPorNumero(numero) || numero < 2) notFound();

  const usina = await db.query.usina.findFirst({
    where: eq(usinaTable.id, id),
    with: { cliente: true, equipamentos: true },
  });
  if (!usina) notFound();

  return (
    <main>
      <header className="topo">
        <h1>{usina.cliente.nome}</h1>
        <span className="sub">{usina.nome}</span>
      </header>

      <div className="ficha">
        <Trilha atual={numero} usinaId={usina.id} concluidos={usina.cadastroPasso} />

        {numero === 2 && (
          <form action={salvarPasso2.bind(null, usina.id)} className="form-ficha">
            <fieldset>
              <legend>O que o técnico encontrou</legend>
              <label>
                Observações da vistoria
                <textarea
                  name="observacoes"
                  rows={5}
                  defaultValue={usina.observacoesVistoria ?? ""}
                  placeholder="Estado do quadro, medidas, orientação do telhado, obstáculos, local do aparelho"
                />
              </label>
              <label>
                Pasta do cliente no Drive
                <input
                  name="linkDrive"
                  defaultValue={usina.linkDrive ?? ""}
                  placeholder="https://drive.google.com/..."
                />
              </label>
              <p className="ajuda">
                As fotos e o vídeo continuam no Drive por enquanto, onde vocês já
                organizam por cliente. Guardar o link aqui liga as duas coisas sem
                mexer no que já funciona; upload direto na ficha fica para depois.
              </p>
            </fieldset>
            <Acoes voltarPara={`/cadastro/${usina.id}/1`} />
          </form>
        )}

        {numero === 3 && (
          <form action={salvarPasso3.bind(null, usina.id)} className="form-ficha">
            <fieldset>
              <legend>Inversor</legend>
              <div className="dupla">
                <label>
                  Tipo
                  <select name="tipo" defaultValue="inversor">
                    <option value="inversor">Inversor</option>
                    <option value="microinversor">Microinversor</option>
                  </select>
                </label>
                <label>
                  Fabricante
                  <input name="fabricante" defaultValue="Growatt" />
                </label>
                <label>
                  Modelo
                  <input name="modelo" placeholder="MIN 10000TL-X2" />
                </label>
              </div>
              <div className="dupla">
                <label>
                  Número de série
                  <input name="numeroSerie" placeholder="ZBPCF9A08P" />
                </label>
                <label className="curto">
                  Potência (W)
                  <input name="potenciaW" inputMode="numeric" placeholder="10000" />
                </label>
                <label>
                  Série do datalogger
                  <input name="datalogger" placeholder="ZOD5F770NB" />
                </label>
              </div>
              <p className="ajuda">
                O número de série é o que liga uma falha do portal a este cliente —
                o log de falhas da Growatt identifica o equipamento só por ele.
              </p>
              {usina.equipamentos.length > 0 && (
                <p className="ajuda">
                  Já cadastrados nesta usina:{" "}
                  {usina.equipamentos
                    .map((e) => `${e.tipo} ${e.numeroSerie ?? ""}`.trim())
                    .join(", ")}
                  .
                </p>
              )}
            </fieldset>
            <Acoes voltarPara={`/cadastro/${usina.id}/2`} />
          </form>
        )}

        {numero === 4 && (
          <form action={salvarPasso4.bind(null, usina.id)} className="form-ficha">
            <fieldset>
              <legend>Módulos usados nesta obra</legend>
              <div className="dupla">
                <label className="curto">
                  Quantidade
                  <input name="quantidade" inputMode="numeric" placeholder="18" />
                </label>
                <label>
                  Marca
                  <input name="marcaModulo" placeholder="Canadian, JA Solar, Trina" />
                </label>
                <label>
                  Modelo
                  <input name="modeloModulo" />
                </label>
                <label className="curto">
                  Potência unitária (W)
                  <input name="potenciaModulo" inputMode="numeric" placeholder="580" />
                </label>
              </div>
              <p className="ajuda">
                Painel se registra por quantidade, não por número de série — ninguém
                anota a série de vinte peças. O que faltava era saber{" "}
                <strong>quantos, de qual marca e para qual obra</strong>, que é
                justamente o que o controle por quantidade da Conta Azul não responde.
              </p>
            </fieldset>
            <Acoes voltarPara={`/cadastro/${usina.id}/3`} />
          </form>
        )}

        {numero === 5 && (
          <form action={salvarPasso5.bind(null, usina.id)} className="form-ficha">
            <input type="hidden" name="nomeUsina" value={usina.nome} />
            <fieldset>
              <legend>Contrato e documentos</legend>
              <div className="dupla">
                <label>
                  Valor do contrato (R$)
                  <input name="valor" inputMode="decimal" placeholder="32500,00" />
                </label>
                <label>
                  Número da ART
                  <input name="numeroArt" />
                </label>
              </div>
              <label>
                Pasta do cliente no Drive
                <input
                  name="linkDrive"
                  defaultValue={usina.linkDrive ?? ""}
                  placeholder="https://drive.google.com/..."
                />
              </label>
              <p className="ajuda">
                Contrato, procuração e memorial descritivo seguem no Drive. A ficha
                guarda para onde apontar.
              </p>
            </fieldset>
            <Acoes voltarPara={`/cadastro/${usina.id}/4`} ultimo />
          </form>
        )}
      </div>
    </main>
  );
}

function Acoes({ voltarPara, ultimo }: { voltarPara: string; ultimo?: boolean }) {
  return (
    <div className="ficha-acoes">
      <a className="voltar" href={voltarPara}>
        ← Voltar
      </a>
      <button type="submit" className="primario">
        {ultimo ? "Concluir cadastro" : "Salvar e continuar"}
      </button>
    </div>
  );
}
