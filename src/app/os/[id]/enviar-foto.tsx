"use client";

import { Camera, LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";

import { anexarAction } from "../actions";

/**
 * "Adicionar foto": um botão só. Escolheu o arquivo, ele já sobe.
 *
 * Antes eram três peças — o "Escolher arquivos" do navegador, o "Nenhum
 * arquivo escolhido" e um "Enviar foto" — e quem escolhia a foto e não via o
 * segundo botão achava que tinha enviado. O campo de arquivo continua lá, só
 * escondido dentro do botão; quem navega pelo teclado chega nele do mesmo
 * jeito, e o anel de foco aparece no botão.
 */
function Rotulo({ texto }: { texto: string }) {
  const { pending } = useFormStatus();
  return pending ? (
    <>
      <LoaderCircle size={15} className="girando" aria-hidden /> Enviando…
    </>
  ) : (
    <>
      <Camera size={15} aria-hidden /> {texto}
    </>
  );
}

export function EnviarFoto({
  osId,
  itemId,
  aceitaVideo,
  texto,
}: {
  osId: string;
  itemId: string;
  aceitaVideo: boolean;
  texto: string;
}) {
  return (
    <form action={anexarAction.bind(null, osId)} className="enviar-foto">
      <input type="hidden" name="itemId" value={itemId} />
      <label className="botao secundario enviar-foto-botao">
        <input
          type="file"
          name="arquivo"
          accept={aceitaVideo ? "image/jpeg,image/png,video/mp4,video/quicktime" : "image/jpeg,image/png"}
          capture="environment"
          multiple
          required
          className="sr-only"
          onChange={(e) => {
            if (e.currentTarget.files?.length) e.currentTarget.form?.requestSubmit();
          }}
        />
        <Rotulo texto={texto} />
      </label>
    </form>
  );
}
