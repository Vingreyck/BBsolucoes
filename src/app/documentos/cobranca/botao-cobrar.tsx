"use client";

import { MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { registrarCobranca } from "../actions";

/**
 * Abre o WhatsApp com a mensagem pronta e anota a cobrança.
 *
 * O WhatsApp abre **antes** de falar com o servidor, dentro do próprio clique:
 * navegador bloqueia janela aberta depois de uma espera. A anotação vem logo em
 * seguida, e a fila se reordena (quem acabou de ser cobrado vai para o fim).
 *
 * Sem JavaScript, o link continua abrindo o WhatsApp — só não fica anotado.
 */
export function BotaoCobrar({
  projetoId,
  link,
  rotulo = "Cobrar no WhatsApp",
}: {
  projetoId: string;
  link: string;
  rotulo?: string;
}) {
  const router = useRouter();
  const [anotando, iniciar] = useTransition();

  return (
    <a
      href={link}
      target="_blank"
      rel="noreferrer"
      className="botao botao-whatsapp"
      aria-busy={anotando}
      onClick={() => {
        iniciar(async () => {
          await registrarCobranca(projetoId);
          router.refresh();
        });
      }}
    >
      <MessageCircle size={15} aria-hidden /> {rotulo}
    </a>
  );
}
