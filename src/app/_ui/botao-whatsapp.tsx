"use client";

import { MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Abre o WhatsApp com a mensagem pronta e, em seguida, anota no servidor que
 * foi enviado (o `anotar`, uma Server Action já com o id preso).
 *
 * O WhatsApp abre **antes** de falar com o servidor, dentro do próprio clique:
 * navegador bloqueia janela aberta depois de uma espera. Sem JavaScript, o link
 * continua abrindo o WhatsApp — só não fica anotado.
 */
export function BotaoWhatsapp({
  link,
  rotulo,
  classe = "botao botao-whatsapp",
  anotar,
}: {
  link: string;
  rotulo: string;
  classe?: string;
  anotar?: () => Promise<void>;
}) {
  const router = useRouter();
  const [anotando, iniciar] = useTransition();
  return (
    <a
      href={link}
      target="_blank"
      rel="noreferrer"
      className={classe}
      aria-busy={anotando}
      onClick={() => {
        if (!anotar) return;
        iniciar(async () => {
          await anotar();
          router.refresh();
        });
      }}
    >
      <MessageCircle size={14} aria-hidden /> {rotulo}
    </a>
  );
}
