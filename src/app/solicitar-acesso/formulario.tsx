"use client";

import { CheckCircle2 } from "lucide-react";
import { useActionState, useState } from "react";

import { CampoSenha } from "../_acesso/campo-senha";
import { pedirAcesso, type EstadoPedido } from "./actions";

/** 12345678909 → 123.456.789-09, enquanto digita. */
function mascaraCpf(bruto: string): string {
  const d = bruto.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

function Erro({ estado, campo }: { estado: EstadoPedido; campo: string }) {
  const texto = estado.campos?.[campo];
  if (!texto) return null;
  return (
    <span className="entrada-erro" id={`erro-${campo}`}>
      {texto}
    </span>
  );
}

export function FormularioPedido() {
  const [estado, acao, enviando] = useActionState<EstadoPedido, FormData>(pedirAcesso, {});
  // null = a pessoa ainda não mexeu: mostra o que voltou do servidor.
  const [cpf, setCpf] = useState<string | null>(null);

  if (estado.ok) {
    return (
      <div className="acesso-sucesso" role="status">
        <CheckCircle2 size={40} aria-hidden />
        <h2>Pedido enviado</h2>
        <p>
          Agora falta um administrador da <strong>{estado.empresa}</strong> liberar o seu acesso e
          escolher o seu papel na equipe.
        </p>
        <ol>
          <li>Avise a sua coordenação que você pediu acesso.</li>
          <li>Quando for liberado, entre com o seu CPF (ou e-mail) e a senha que acabou de criar.</li>
          <li>O mesmo acesso vale no aplicativo BBSolution, no celular.</li>
        </ol>
        <a href="/login?pedido=enviado" className="botao-grande">
          Ir para o login
        </a>
      </div>
    );
  }

  const v = estado.valores;
  const invalido = (campo: string) => (estado.campos?.[campo] ? true : undefined);

  return (
    <>
      {estado.mensagem && (
        <p className="acesso-mensagem erro" role="alert">
          {estado.mensagem}
        </p>
      )}

      <form action={acao} className="acesso-form">
        <label className="entrada">
          <span className="entrada-rotulo">Código da empresa</span>
          <input
            name="codigo"
            defaultValue={v?.codigo}
            required
            autoFocus
            autoComplete="off"
            aria-invalid={invalido("codigo")}
            aria-describedby="ajuda-codigo"
          />
          <span className="entrada-ajuda" id="ajuda-codigo">
            O administrador da empresa passa esse código. É o mesmo do aplicativo.
          </span>
          <Erro estado={estado} campo="codigo" />
        </label>

        <label className="entrada">
          <span className="entrada-rotulo">Nome completo</span>
          <input name="nome" defaultValue={v?.nome} required autoComplete="name" aria-invalid={invalido("nome")} />
          <Erro estado={estado} campo="nome" />
        </label>

        <div className="entrada-dupla">
          <label className="entrada">
            <span className="entrada-rotulo">CPF</span>
            <input
              name="cpf"
              inputMode="numeric"
              placeholder="000.000.000-00"
              value={cpf ?? v?.cpf ?? ""}
              onChange={(e) => setCpf(mascaraCpf(e.target.value))}
              required
              aria-invalid={invalido("cpf")}
            />
            <Erro estado={estado} campo="cpf" />
          </label>

          <label className="entrada">
            <span className="entrada-rotulo">
              E-mail <span className="entrada-opcional">opcional</span>
            </span>
            <input
              name="email"
              type="email"
              defaultValue={v?.email}
              autoComplete="email"
              aria-invalid={invalido("email")}
            />
            <Erro estado={estado} campo="email" />
          </label>
        </div>

        <label className="entrada">
          <span className="entrada-rotulo">Crie uma senha</span>
          <CampoSenha name="senha" autoComplete="new-password" minLength={8} invalido={invalido("senha")} descricao="ajuda-senha" />
          <span className="entrada-ajuda" id="ajuda-senha">
            Pelo menos 8 caracteres. Não use o seu CPF nem senhas óbvias.
          </span>
          <Erro estado={estado} campo="senha" />
        </label>

        <label className="entrada">
          <span className="entrada-rotulo">Repita a senha</span>
          <CampoSenha name="repetida" autoComplete="new-password" minLength={8} invalido={invalido("repetida")} />
          <Erro estado={estado} campo="repetida" />
        </label>

        <button type="submit" className="botao-grande" disabled={enviando}>
          {enviando ? "Enviando…" : "Solicitar acesso"}
        </button>
      </form>
    </>
  );
}
