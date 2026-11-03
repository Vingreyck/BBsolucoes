"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Recarrega a tela de tempos em tempos enquanto o robô está no meio do login. */
export function AtualizarSozinho({ segundos }: { segundos: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), segundos * 1000);
    return () => clearInterval(t);
  }, [router, segundos]);
  return null;
}
