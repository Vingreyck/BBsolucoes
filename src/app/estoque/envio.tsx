"use client";

import { CircleCheck, FileText, Receipt, ScanLine } from "lucide-react";
import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { enviarDocumentosAction } from "./actions";

const LIMITE = 20 * 1024 * 1024;

function tamanho(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Uma área de soltar arquivo: clicar escolhe, arrastar solta, e mostra o que foi escolhido. */
function Soltar({
  nome,
  titulo,
  dica,
  aceita,
  opcional,
  icone,
  aoMudar,
}: {
  nome: "nota" | "pedido";
  titulo: string;
  dica: string;
  aceita: string;
  opcional?: boolean;
  icone: React.ReactNode;
  aoMudar: (temArquivo: boolean) => void;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function escolher(f: File | null) {
    if (f && f.size > LIMITE) {
      setErro(`${f.name} passa de 20 MB.`);
      if (entrada.current) entrada.current.value = "";
      f = null;
    } else setErro(null);
    setArquivo(f);
    aoMudar(Boolean(f));
  }

  return (
    <label
      className={`es-soltar${arquivo ? " escolhido" : ""}${arrastando ? " es-soltar-arrastando" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setArrastando(true);
      }}
      onDragLeave={() => setArrastando(false)}
      onDrop={(e) => {
        e.preventDefault();
        setArrastando(false);
        const f = e.dataTransfer.files[0];
        if (!f || !entrada.current) return;
        // Põe o arquivo solto dentro do campo do formulário, como se tivesse sido escolhido.
        const dt = new DataTransfer();
        dt.items.add(f);
        entrada.current.files = dt.files;
        escolher(f);
      }}
    >
      <input
        ref={entrada}
        type="file"
        name={nome}
        accept={aceita}
        onChange={(e) => escolher(e.target.files?.[0] ?? null)}
        aria-label={titulo}
      />
      <span className="es-soltar-icone" aria-hidden>
        {arquivo ? <CircleCheck size={20} /> : icone}
      </span>
      <strong>
        {titulo} {opcional && <span className="es-soltar-opcional">(opcional)</span>}
      </strong>
      {arquivo ? (
        <>
          <span className="es-soltar-arquivo">
            <FileText size={14} aria-hidden />
            <span>{arquivo.name}</span>
          </span>
          <small>{tamanho(arquivo.size)}</small>
          <button
            type="button"
            className="es-soltar-limpar"
            onClick={(e) => {
              e.preventDefault();
              if (entrada.current) entrada.current.value = "";
              escolher(null);
            }}
          >
            trocar ou tirar
          </button>
        </>
      ) : (
        <small>{erro ?? dica}</small>
      )}
    </label>
  );
}

function Enviar({ pronto }: { pronto: boolean }) {
  const { pending } = useFormStatus();
  if (pending) {
    return (
      <p className="es-lendo" role="status">
        <span className="pc-girando" aria-hidden /> Lendo os itens… pode levar até um minuto.
      </p>
    );
  }
  return (
    <button type="submit" className="botao" disabled={!pronto}>
      <ScanLine size={15} aria-hidden /> Ler e conferir
    </button>
  );
}

/**
 * A nota fiscal e o pedido, cada um na sua área de soltar. Basta um dos dois;
 * mandando os dois, o que repete começa desmarcado na conferência.
 */
export function EnvioDeDocumentos({ groq }: { groq: boolean }) {
  const [nota, setNota] = useState(false);
  const [pedido, setPedido] = useState(false);
  return (
    <form action={enviarDocumentosAction} className="es-linhas">
      <div className="es-soltar-grade">
        <Soltar
          nome="nota"
          titulo="Nota fiscal"
          dica={groq ? "XML, PDF (DANFE) ou foto. Solte aqui ou clique." : "XML da NF-e. Solte aqui ou clique."}
          aceita=".xml,text/xml,application/xml,application/pdf,image/jpeg,image/png,image/webp"
          icone={<Receipt size={20} />}
          aoMudar={setNota}
        />
        <Soltar
          nome="pedido"
          titulo="Pedido do fornecedor"
          opcional
          dica="PDF ou foto. Ajuda quando a nota vem com o kit num item só."
          aceita="application/pdf,image/jpeg,image/png,image/webp,.xml"
          icone={<FileText size={20} />}
          aoMudar={setPedido}
        />
      </div>
      <div className="es-rodape">
        <p className="nota">Nada entra no saldo antes de você conferir.</p>
        <Enviar pronto={nota || pedido} />
      </div>
    </form>
  );
}
