import { CalendarDays, ClipboardList, Gauge } from "lucide-react";
import Link from "next/link";

import { exigirGestaoWeb } from "@/os/acesso";
import { emCampo, produtividade } from "@/rastreamento/acompanhamento";

import { Cabecalho, Cartao, Vazio } from "../../_ui";
import PainelCampo from "./painel";

export const dynamic = "force-dynamic";

function minutos(m: number | null): string {
  if (m === null) return "—";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

/**
 * O "Acompanhar técnico" do SeeNet no site: quem está a caminho ou atendendo,
 * onde está agora, por onde passou — e quanto a equipe rendeu no mês.
 *
 * Só a gestão vê. O técnico é rastreado apenas entre o "Estou a caminho" e o
 * fim do atendimento, e o app mostra uma notificação fixa enquanto isso.
 */
export default async function Acompanhamento() {
  const ator = await exigirGestaoWeb();
  const [tecnicos, mes] = await Promise.all([emCampo(ator.empresaId), produtividade(ator.empresaId)]);

  return (
    <main>
      <Cabecalho
        trilha={[{ href: "/os", rotulo: "Ordens de serviço" }]}
        titulo="Em campo"
        selos={
          <span className="selo-ao-vivo">
            <span aria-hidden /> ao vivo
          </span>
        }
        meta="Quem está a caminho ou atendendo, onde está agora e por onde passou."
        acoes={
          <>
            <Link href="/os/agenda" className="botao secundario">
              <CalendarDays size={15} aria-hidden /> Agenda
            </Link>
            <Link href="/os" className="botao secundario">
              <ClipboardList size={15} aria-hidden /> Ordens de serviço
            </Link>
          </>
        }
      />

      <PainelCampo inicial={tecnicos} />

      <div className="pagina-corpo">
        <Cartao
          titulo="Produtividade do mês"
          icone={<Gauge size={16} />}
          ajuda="Deslocamento acima de 4 h e atendimento acima de 12 h ficam fora da média — são marcação esquecida, não trabalho."
        >
          {mes.length === 0 ? (
            <Vazio icone={<Gauge size={20} />} titulo="Nenhuma OS concluída neste mês ainda">
              Quando a equipe concluir OS pelo app, a média de deslocamento e de atendimento de cada técnico aparece aqui.
            </Vazio>
          ) : (
            <div className="tabela-wrap tabela-no-cartao">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Técnico</th>
                    <th className="num">Concluídas</th>
                    <th className="num">OS por dia</th>
                    <th className="num" title="Do 'Estou a caminho' até o 'Cheguei'">
                      Deslocamento médio
                    </th>
                    <th className="num" title="Tempo atendendo, sem contar as pausas">
                      Atendimento médio
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {mes.map((p) => (
                    <tr key={p.tecnico.id}>
                      <td className="forte">{p.tecnico.nome}</td>
                      <td className="num">{p.concluidas}</td>
                      <td className="num">{p.osPorDia.toLocaleString("pt-BR", { minimumFractionDigits: 1 })}</td>
                      <td className="num">{minutos(p.mediaDeslocamentoMin)}</td>
                      <td className="num">{minutos(p.mediaExecucaoMin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Cartao>
      </div>
    </main>
  );
}
