/**
 * Confere a busca de tarifa na ANEEL de verdade (rede), sem banco:
 *   npm run tarifa:conferir
 * Mostra TE, TUSD e Fio B da Energisa Sergipe e da Sulgipe (residencial), e,
 * se a ANEEL não responder, o motivo exato (DNS, tempo esgotado, TLS…) e o que
 * a tabela que vai junto com o sistema tem.
 */
import { distribuidoraPorNome } from "./municipios";
import { buscarNaAneel, tarifaDaTabela } from "./tarifas-aneel";
import { comImpostos } from "./tarifas";

/** O motivo de baixo do "fetch failed": o Node guarda em `cause`. */
function motivo(e: unknown): string {
  const partes: string[] = [];
  let atual: unknown = e;
  for (let i = 0; i < 4 && atual; i++) {
    const x = atual as { message?: string; code?: string; cause?: unknown };
    partes.push([x.code, x.message].filter(Boolean).join(" "));
    atual = x.cause;
  }
  return partes.filter(Boolean).join(" ← ");
}

async function principal() {
  for (const nome of ["Energisa Sergipe", "Sulgipe"]) {
    const d = distribuidoraPorNome(nome);
    if (!d) {
      console.log(nome, "não achada na tabela de municípios");
      continue;
    }
    const inicio = Date.now();
    try {
      const t = await buscarNaAneel(d.cnpj, "B1");
      console.log(
        `${nome}: ANEEL respondeu em ${Date.now() - inicio} ms.`,
        t ? `TE+TUSD ${(t.te + t.tusd).toFixed(5)}, Fio B ${t.fioB?.toFixed(5) ?? "—"}, ${t.resolucao} → com 20% + 5%: ${comImpostos(t.te + t.tusd, { icms: 0.2, pisCofins: 0.05 }).toFixed(4)} R$/kWh` : "sem tarifa",
      );
    } catch (e) {
      console.log(`${nome}: a ANEEL não respondeu em ${Date.now() - inicio} ms: ${motivo(e)}`);
    }
    const tab = tarifaDaTabela(d.cnpj, "B1");
    console.log(`  tabela do sistema: ${tab ? `TE+TUSD ${(tab.te + tab.tusd).toFixed(5)}, Fio B ${tab.fioB?.toFixed(5) ?? "—"}, desde ${tab.vigenciaInicio}` : "não tem"}`);
  }
}
principal();
