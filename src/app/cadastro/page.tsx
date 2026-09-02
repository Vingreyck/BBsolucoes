import { exigirUsuario } from "@/auth/sessao";

import { salvarPasso1 } from "./actions";
import { Trilha } from "./trilha";

export const dynamic = "force-dynamic";

const FABRICANTES = [
  ["growatt", "Growatt"],
  ["hoymiles", "Hoymiles"],
  ["solis", "Solis"],
  ["foxess", "FoxESS"],
  ["huawei", "Huawei"],
  ["solarportal_plus", "SolarPortal+"],
  ["nep", "NEP"],
  ["outro", "Outro ou nenhum"],
] as const;

export default async function CadastroPasso1({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  await exigirUsuario();
  const { erro } = await searchParams;

  return (
    <main>
      <header className="topo">
        <h1>Nova usina</h1>
        <span className="sub">Cadastro completo em 5 passos</span>
      </header>

      <div className="ficha">
        <Trilha atual={1} />

        <form action={salvarPasso1} className="form-ficha">
          <fieldset>
            <legend>Cliente</legend>
            <label>
              Nome<span className="req">*</span>
              <input name="cliente" required autoFocus />
            </label>
            <div className="dupla">
              <label>
                Telefone
                <input name="telefone" inputMode="tel" />
              </label>
              <label>
                Cidade
                <input name="cidade" />
              </label>
              <label className="curto">
                UF
                <input name="uf" maxLength={2} defaultValue="SE" />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Usina</legend>
            <div className="dupla">
              <label>
                Nome da usina
                <input name="usina" placeholder="Em branco usa o nome do cliente" />
              </label>
              <label className="curto">
                Potência (kWp)
                <input name="potenciaKwp" inputMode="decimal" placeholder="10,5" />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Monitoramento</legend>
            <div className="dupla">
              <label>
                Portal do fabricante
                <select name="fabricante" defaultValue="growatt">
                  {FABRICANTES.map(([valor, rotulo]) => (
                    <option key={valor} value={valor}>
                      {rotulo}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Nome ou id da usina no portal
                <input
                  name="idExterno"
                  placeholder="Como ela aparece lá; deixe vazio se ainda não existe"
                />
              </label>
            </div>
            <p className="ajuda">
              É este campo que liga a usina ao portal e faz a geração importada
              cair no cliente certo. Pode ficar vazio agora e ser preenchido
              depois, quando a usina for criada lá.
            </p>
          </fieldset>

          {erro && (
            <p className="erro-os" role="alert">
              {erro}
            </p>
          )}

          <div className="ficha-acoes">
            <button type="submit" className="primario">
              Salvar e continuar
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
