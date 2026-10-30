"use client";

import { MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { registrarEnvioRelatorio } from "./actions";

/**
 * Abre o WhatsApp com a mensagem e o link do PDF, e anota o envio. O WhatsApp
 * abre dentro do próprio clique (o navegador bloqueia janela aberta depois de
 * uma espera); a anotação vem em seguida.
 */
export function BotaoEnviar({ usinaId, mes, link, jaEnviado }: { usinaId: string; mes: string; link: string; jaEnviado: boolean }) {
  const router = useRouter();
  const [anotando, iniciar] = useTransition();
  return (
    <a
      href={link}
      target="_blank"
      rel="noreferrer"
      className={`botao ${jaEnviado ? "secundario" : "botao-whatsapp"}`}
      aria-busy={anotando}
      onClick={() =>
        iniciar(async () => {
          await registrarEnvioRelatorio(usinaId, mes);
          router.refresh();
        })
      }
    >
      <MessageCircle size={15} aria-hidden /> {jaEnviado ? "Enviar de novo" : "Enviar"}
    </a>
  );
}
