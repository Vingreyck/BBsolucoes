"use client";

import { useActionState } from "react";

import { enviarDocumento, type ResultadoEnvio } from "../actions";

/**
 * O campo de envio de um tipo de documento.
 *
 * Cliente por causa do estado do resultado — é o único pedaço de JavaScript da
 * tela. Se o navegador não executar nada, o formulário ainda envia: `action`
 * aponta para a Server Action, o `<input type="file">` é nativo e a página
 * recarrega mostrando o arquivo na lista. Perde-se a mensagem inline, não a
 * função.
 */
export function EnvioDocumento({
  projetoId,
  tipo,
  exigeAssinatura,
  desabilitado,
}: {
  projetoId: string;
  tipo: string;
  exigeAssinatura: boolean;
  desabilitado?: boolean;
}) {
  const [estado, acao, enviando] = useActionState<ResultadoEnvio, FormData>(
    enviarDocumento,
    {},
  );

  return (
    <form action={acao} className="envio">
      <input type="hidden" name="projetoId" value={projetoId} />
      <input type="hidden" name="tipo" value={tipo} />

      <input
        type="file"
        name="arquivo"
        required
        disabled={desabilitado || enviando}
        accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,.doc,.docx,.xls,.xlsx"
        aria-label={`Arquivo para ${tipo}`}
      />

      {exigeAssinatura && (
        <label className="marcar">
          <input
            type="checkbox"
            name="assinado"
            value="sim"
            disabled={desabilitado || enviando}
          />
          Já está assinado
        </label>
      )}

      <button type="submit" disabled={desabilitado || enviando}>
        {enviando ? "Enviando…" : "Enviar"}
      </button>

      {estado.erro && <p className="erro">{estado.erro}</p>}
      {estado.ok && <p className="ok">{estado.ok}</p>}
    </form>
  );
}
