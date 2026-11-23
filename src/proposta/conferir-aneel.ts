/**
 * Confere a busca de tarifa na ANEEL de verdade (rede), sem banco:
 *   npx tsx src/proposta/conferir-aneel.ts
 * Mostra TE, TUSD e Fio B da Energisa Sergipe e da Sulgipe, residencial.
 */
import { distribuidoraPorNome } from "./municipios";
import { buscarNaAneel } from "./tarifas-aneel";
import { comImpostos } from "./tarifas";

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
      console.log(`${nome} (${d.cnpj}) em ${Date.now() - inicio} ms:`, t, t ? `→ com 20% + 5%: ${comImpostos(t.te + t.tusd, { icms: 0.2, pisCofins: 0.05 }).toFixed(4)} R$/kWh` : "");
    } catch (e) {
      console.log(`${nome}: a ANEEL não respondeu (${(e as Error).message})`);
    }
  }
}
principal();
