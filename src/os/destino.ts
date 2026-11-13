/**
 * O destino de uma OS no Google Maps: o endereço escrito do jeito que o mapa
 * entende e o link que **traça a rota** (e não só marca um ponto).
 *
 * Sem banco — conferido pelo `testar-regras.ts`.
 *
 * Os problemas que isto resolve, que faziam a rota cair no lugar errado:
 * - o link antigo era uma **busca** (`/maps/search`): mostra um pino, não traça
 *   caminho. O de rota é `/maps/dir`, que parte de onde a pessoa está;
 * - o endereço saía com " · " entre as partes e "Cidade - UF", que o Google lê
 *   mal; as vírgulas, a UF e o "Brasil" no fim evitam cair noutra "Itabaiana"
 *   ou noutra rua de mesmo nome;
 * - o complemento ("apto 2", "perto da padaria") e o "S/N" confundem a busca e
 *   ficam de fora (o complemento continua na tela, para o técnico ler);
 * - a coordenada da usina só vale se for confiável: o portal manda "0,0" quando não sabe, e
   coordenada fora do Brasil é lixo. Sendo boa, chega na porta e ganha do endereço.
 */

export interface EnderecoDoCliente {
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
}

const limpo = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** 49500000 → 49500-000; o que não tem 8 dígitos não entra. */
function cepBonito(cep: string | null): string | null {
  const d = (cep ?? "").replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : null;
}

/** "S/N", "s/n", "sn" não ajudam o mapa: ele acha a rua e põe o pino no meio. */
function numeroUtil(numero: string | null): string | null {
  const n = limpo(numero);
  return n && !/^s\s*\/?\s*n$/i.test(n) ? n : null;
}

/** Dentro do Brasil e fora do "0,0" que o portal manda quando não sabe. */
export function coordenadaValida(latitude: number | null, longitude: number | null): boolean {
  if (latitude === null || longitude === null) return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude === 0 && longitude === 0) return false;
  return latitude >= -34 && latitude <= 6 && longitude >= -74 && longitude <= -34;
}

/**
 * "Rua das Flores, 123, Centro, Itabaiana, SE, 49500-000, Brasil".
 * Nulo se não há rua nem cidade: com nada para procurar, não há destino.
 */
export function destinoEmTexto(c: EnderecoDoCliente): string | null {
  const rua = limpo(c.logradouro);
  const cidade = limpo(c.cidade);
  if (!rua && !cidade) return null;
  const numero = rua ? numeroUtil(c.numero) : null;
  const partes = [
    rua ? [rua, numero].filter(Boolean).join(", ") : null,
    rua ? limpo(c.bairro) : null,
    cidade || null,
    limpo(c.uf).toUpperCase() || null,
    cepBonito(c.cep),
    "Brasil",
  ];
  return partes.filter(Boolean).join(", ");
}

/**
 * O que o Maps recebe como destino: a coordenada da usina, se for confiável (chega
 * na porta); senão o endereço do cliente; senão a cidade.
 */
export function destinoDaOs(
  cliente: EnderecoDoCliente,
  // A coordenada vem do banco como texto ("-10.9123456"); aceita número também.
  usina?: { latitude: string | number | null; longitude: string | number | null } | null,
): string | null {
  const numero = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
  const lat = numero(usina?.latitude);
  const lon = numero(usina?.longitude);
  if (coordenadaValida(lat, lon)) return `${lat},${lon}`;
  return destinoEmTexto(cliente);
}

/** O link que abre o Google Maps já com a rota traçada, saindo de onde a pessoa está. */
export function linkDaRota(destino: string | null): string | null {
  if (!destino) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destino)}&travelmode=driving`;
}
