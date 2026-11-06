import { exigirGestaoWeb } from "@/os/acesso";

import { Cabecalho } from "../../_ui";
import { Importador } from "./importador";

export const dynamic = "force-dynamic";

/**
 * A janela que o favorito "Enviar ao Selebi" abre: recebe a lista do portal da
 * Energisa e atualiza a esteira. Aberta à mão, só explica de onde ela vem.
 */
export default async function Importar() {
  await exigirGestaoWeb();
  return (
    <main>
      <Cabecalho trilha={[{ href: "/energisa", rotulo: "Energisa" }]} titulo="Enviar ao Selebi" />
      <div className="pagina-corpo">
        <Importador />
      </div>
    </main>
  );
}
