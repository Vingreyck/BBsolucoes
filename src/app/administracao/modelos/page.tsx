import { asc, eq } from "drizzle-orm";
import {
  ArrowRight,
  ClipboardList,
  Clock,
  Droplets,
  Info,
  KanbanSquare,
  PenLine,
  ScanSearch,
  ShieldCheck,
  SunMedium,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";
import { garantirModelos } from "@/os/modelos";
import { TIPO_ROTULO } from "@/os/tipos";

import { Cabecalho } from "../../_ui";

export const dynamic = "force-dynamic";

/** Um ícone por tipo, para a grade se ler de relance. */
const ICONE_TIPO: Record<string, LucideIcon> = {
  vistoria: ScanSearch,
  instalacao: SunMedium,
  corretiva: Wrench,
  preventiva: ShieldCheck,
  limpeza: Droplets,
  garantia: ShieldCheck,
};

export default async function Modelos() {
  const usuario = await exigirUsuario();
  if (usuario.papel !== "adm") redirect("/sem-acesso");
  await garantirModelos(usuario.empresaId);

  const [modelos, etapas] = await Promise.all([
    db.query.modeloOs.findMany({
      where: eq(schema.modeloOs.empresaId, usuario.empresaId),
      with: { itens: { columns: { obrigatorio: true, fotosMinimas: true } } },
    }),
    db.query.etapa.findMany({
      where: eq(schema.etapa.empresaId, usuario.empresaId),
      columns: { slug: true, nome: true },
      orderBy: asc(schema.etapa.ordem),
    }),
  ]);
  const nomeEtapa = new Map(etapas.map((e) => [e.slug, e.nome]));
  modelos.sort((a, b) => a.nome.localeCompare(b.nome));

  return (
    <main>
      <Cabecalho
        titulo="Modelos de OS"
        meta="O checklist, o prazo e a regra de cada tipo de ordem de serviço."
      />

      <details className="como-ler">
        <summary>
          <Info size={15} aria-hidden /> O que acontece com as OS já abertas
        </summary>
        <div>
          <p>
            O que muda aqui vale para as OS abertas daqui em diante. As que já existem guardaram a própria cópia do
            checklist: o técnico no meio de um atendimento não vê a lista mudar, e o relatório continua batendo.
          </p>
        </div>
      </details>

      <div className="grade-modelos">
        {modelos.map((m) => {
          const Icone = ICONE_TIPO[m.tipo] ?? ClipboardList;
          const obrigatorios = m.itens.filter((i) => i.obrigatorio).length;
          const fotos = m.itens.reduce((s, i) => s + i.fotosMinimas, 0);
          return (
            <Link key={m.id} href={`/administracao/modelos/${m.tipo}`} className="modelo-cartao">
              <header>
                <span className="ui-cartao-icone" aria-hidden>
                  <Icone size={16} />
                </span>
                <div>
                  <strong>{m.nome}</strong>
                  <small>{TIPO_ROTULO[m.tipo] ?? m.tipo}</small>
                </div>
              </header>

              <div className="modelo-numeros">
                <span className={m.itens.length ? "" : "texto-perigo"}>
                  <strong>{m.itens.length || "0"}</strong> itens
                </span>
                <span>
                  <strong>{obrigatorios}</strong> obrigatórios
                </span>
                <span>
                  <strong>{fotos}</strong> fotos
                </span>
              </div>

              <ul className="modelo-regras">
                <li>
                  <Clock size={13} aria-hidden /> {m.prazoHoras ? `prazo de ${m.prazoHoras} h` : "sem prazo"}
                </li>
                <li>
                  <PenLine size={13} aria-hidden /> {m.exigeAssinatura ? "exige assinatura" : "sem assinatura"}
                </li>
                {m.etapaSlug && (
                  <li>
                    <KanbanSquare size={13} aria-hidden /> anda a esteira de {nomeEtapa.get(m.etapaSlug) ?? m.etapaSlug}
                  </li>
                )}
              </ul>

              <span className="link-acao modelo-editar">
                Editar checklist <ArrowRight size={14} aria-hidden />
              </span>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
