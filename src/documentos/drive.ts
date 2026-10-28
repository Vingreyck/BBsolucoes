/**
 * Cliente do Google Drive da empresa.
 *
 * **Uma conexão só, da empresa — não uma por usuário.** Foi a decisão do
 * Vinícius: engenheiro, técnico e vendedor entram no Selebi e pronto, ninguém
 * precisa de conta no Google. O Selebi age como a conta
 * `bbsolucoesengenharia` ao criar pasta, gravar arquivo e devolver arquivo.
 *
 * É por isso também que **o download passa por aqui e não por link do Drive**:
 * se a tela só mostrasse o link, quem não tem conta Google esbarraria na tela
 * de login do Google. O arquivo vem para o Selebi e o Selebi entrega.
 *
 * Sem `googleapis`: o Drive v3 é REST simples, e todos os outros coletores do
 * projeto (FoxESS, Solis, Huawei, Growatt) são fetch cru. Uma dependência de
 * 50 MB para quatro chamadas não se paga.
 *
 * Credenciais saem de `npm run drive:autorizar`, que roda uma vez na máquina
 * do dono e imprime o refresh token para ele colar no `.env`.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

/**
 * Escopo mínimo que serve.
 *
 * `drive.file` só enxerga o que o próprio app criou — não serviria, porque as
 * 178 pastas já existem e foram criadas por gente. `drive` completo é o que
 * permite ler a árvore antiga e gravar dentro dela. É acesso amplo, e é o
 * motivo de a credencial viver só no `.env` do servidor.
 */
export const ESCOPO = "https://www.googleapis.com/auth/drive";

export interface ArquivoDrive {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  webViewLink?: string;
  modifiedTime?: string;
}

/**
 * Access token em memória, renovado quando falta um minuto.
 *
 * O refresh token não expira; o access token dura uma hora. Pedir um novo a
 * cada request seria uma chamada extra por clique, e o Google limita.
 */
let tokenCache: { valor: string; expiraEm: number } | null = null;

function exigirVariavel(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(
      `${nome} não está no .env. Rode \`npm run drive:autorizar\` e siga as instruções.`,
    );
  }
  return valor;
}

/** Diz se a integração está configurada, sem estourar erro. */
export function driveConfigurado(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REFRESH_TOKEN,
  );
}

export async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiraEm > Date.now() + 60_000) return tokenCache.valor;

  const corpo = new URLSearchParams({
    client_id: exigirVariavel("GOOGLE_CLIENT_ID"),
    client_secret: exigirVariavel("GOOGLE_CLIENT_SECRET"),
    refresh_token: exigirVariavel("GOOGLE_REFRESH_TOKEN"),
    grant_type: "refresh_token",
  });

  const resposta = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: corpo,
  });

  if (!resposta.ok) {
    const texto = await resposta.text();
    /**
     * `invalid_grant` aqui quase nunca é bug: é o refresh token revogado — a
     * senha da conta mudou, ou alguém tirou o acesso do app em
     * myaccount.google.com. A mensagem diz o que fazer em vez de mandar
     * procurar.
     */
    if (texto.includes("invalid_grant")) {
      throw new Error(
        "O Google recusou o refresh token (invalid_grant). Isso costuma ser " +
          "acesso revogado ou senha trocada. Rode `npm run drive:autorizar` de novo.",
      );
    }
    throw new Error(`Não consegui renovar o token do Drive: ${resposta.status} ${texto}`);
  }

  const dados = (await resposta.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    valor: dados.access_token,
    expiraEm: Date.now() + dados.expires_in * 1000,
  };
  return tokenCache.valor;
}

async function chamar(caminho: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  const resposta = await fetch(`${API}${caminho}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${token}` },
  });
  if (!resposta.ok) {
    throw new Error(`Drive respondeu ${resposta.status}: ${await resposta.text()}`);
  }
  return resposta;
}

/**
 * Escapa aspas simples na consulta.
 *
 * O nome do cliente entra na query do Drive, e há pastas com apóstrofo no
 * Drive da BB. Sem escapar, "SANT'ANA" quebraria a consulta — e a forma de
 * escapar no Drive é a barra invertida.
 */
function seguro(texto: string): string {
  return texto.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Procura uma pasta pelo nome exato dentro de outra. */
export async function acharPasta(
  nome: string,
  paiId: string,
): Promise<ArquivoDrive | null> {
  const q = [
    `name = '${seguro(nome)}'`,
    `'${seguro(paiId)}' in parents`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
  ].join(" and ");

  const resposta = await chamar(
    `/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType)&pageSize=2`,
  );
  const dados = (await resposta.json()) as { files: ArquivoDrive[] };
  return dados.files[0] ?? null;
}

/** Acha a pasta, e cria se não existir. */
export async function garantirPasta(nome: string, paiId: string): Promise<string> {
  const existente = await acharPasta(nome, paiId);
  if (existente) return existente.id;

  const resposta = await chamar("/files?fields=id", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: nome,
      mimeType: "application/vnd.google-apps.folder",
      parents: [paiId],
    }),
  });
  const dados = (await resposta.json()) as { id: string };
  return dados.id;
}

/** Os campos que o Drive devolve de cada arquivo enviado. */
const CAMPOS_ENVIO = "id,name,mimeType,size,webViewLink,modifiedTime";

/**
 * Acima disto o envio vai pelo upload "retomável" do Drive.
 *
 * O multipart numa requisição só é o caminho que o Google recomenda até 5 MB.
 * Foto de celular fica bem abaixo; o vídeo da vistoria (até 50 MB) e a cópia
 * de segurança do banco, não — para esses, o caminho documentado é o retomável.
 */
const LIMITE_MULTIPART = 5 * 1024 * 1024;

/**
 * Sobe um arquivo.
 *
 * Até 5 MB, multipart numa requisição só; acima, o upload retomável (ver
 * [enviarRetomavel]). **Sem comprimir**: foi decisão explícita do Vinícius, e é
 * a decisão certa para papel que pode virar prova. Comprimir PDF escaneado é
 * perder informação de um documento que a concessionária ou um juiz pode
 * querer ler.
 */
export async function enviarArquivo(opcoes: {
  nome: string;
  mimeType: string;
  pastaId: string;
  conteudo: ArrayBuffer | Uint8Array;
}): Promise<ArquivoDrive> {
  const miolo =
    opcoes.conteudo instanceof Uint8Array
      ? opcoes.conteudo
      : new Uint8Array(opcoes.conteudo);
  if (miolo.byteLength > LIMITE_MULTIPART) return enviarRetomavel({ ...opcoes, conteudo: miolo });

  const token = await accessToken();
  const limite = `selebi-${crypto.randomUUID()}`;

  const metadados = JSON.stringify({
    name: opcoes.nome,
    parents: [opcoes.pastaId],
  });

  const abertura = new TextEncoder().encode(
    `--${limite}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadados}\r\n` +
      `--${limite}\r\ncontent-type: ${opcoes.mimeType}\r\n\r\n`,
  );
  const fechamento = new TextEncoder().encode(`\r\n--${limite}--\r\n`);

  const corpo = new Uint8Array(abertura.length + miolo.length + fechamento.length);
  corpo.set(abertura, 0);
  corpo.set(miolo, abertura.length);
  corpo.set(fechamento, abertura.length + miolo.length);

  const resposta = await fetch(
    `${UPLOAD}/files?uploadType=multipart&fields=${CAMPOS_ENVIO}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/related; boundary=${limite}`,
      },
      body: corpo,
    },
  );

  if (!resposta.ok) {
    throw new Error(`Drive recusou o upload (${resposta.status}): ${await resposta.text()}`);
  }
  return (await resposta.json()) as ArquivoDrive;
}

/**
 * Upload retomável, numa tacada só.
 *
 * Duas chamadas: a primeira diz ao Drive o nome, a pasta e o tamanho, e ele
 * devolve no `Location` o endereço da sessão de envio; a segunda manda o
 * arquivo inteiro para esse endereço. Não retoma de verdade no meio — para os
 * tamanhos daqui (dezenas de MB), recomeçar do zero na próxima rodada é mais
 * simples que guardar sessão, e o resultado é o mesmo.
 */
async function enviarRetomavel(opcoes: {
  nome: string;
  mimeType: string;
  pastaId: string;
  conteudo: Uint8Array;
}): Promise<ArquivoDrive> {
  const token = await accessToken();
  const abertura = await fetch(`${UPLOAD}/files?uploadType=resumable&fields=${CAMPOS_ENVIO}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": opcoes.mimeType,
      "x-upload-content-length": String(opcoes.conteudo.byteLength),
    },
    body: JSON.stringify({ name: opcoes.nome, parents: [opcoes.pastaId] }),
  });
  const sessao = abertura.headers.get("location");
  if (!abertura.ok || !sessao) {
    throw new Error(`Drive recusou abrir o envio (${abertura.status}): ${await abertura.text()}`);
  }

  const resposta = await fetch(sessao, {
    method: "PUT",
    headers: {
      "content-type": opcoes.mimeType,
      "content-length": String(opcoes.conteudo.byteLength),
    },
    // Os bytes vêm de um Buffer ou de um ArrayBuffer comum, nunca de memória
    // compartilhada entre threads — a conversão de tipo só diz isso ao TypeScript.
    body: opcoes.conteudo as Uint8Array<ArrayBuffer>,
  });
  if (!resposta.ok) {
    throw new Error(`Drive recusou o upload (${resposta.status}): ${await resposta.text()}`);
  }
  return (await resposta.json()) as ArquivoDrive;
}

/** Os arquivos de uma pasta (sem as subpastas), do mais novo para o mais velho. */
export async function listarArquivos(
  pastaId: string,
): Promise<Array<ArquivoDrive & { createdTime?: string }>> {
  const q = [
    `'${seguro(pastaId)}' in parents`,
    "mimeType != 'application/vnd.google-apps.folder'",
    "trashed = false",
  ].join(" and ");
  const arquivos: Array<ArquivoDrive & { createdTime?: string }> = [];
  let pagina: string | undefined;
  do {
    const resposta = await chamar(
      `/files?q=${encodeURIComponent(q)}&orderBy=${encodeURIComponent("createdTime desc")}&pageSize=200` +
        `&fields=nextPageToken,files(id,name,mimeType,size,createdTime)` +
        (pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ""),
    );
    const dados = (await resposta.json()) as {
      files: Array<ArquivoDrive & { createdTime?: string }>;
      nextPageToken?: string;
    };
    arquivos.push(...dados.files);
    pagina = dados.nextPageToken;
  } while (pagina);
  return arquivos;
}

/**
 * Baixa um arquivo pelo id.
 *
 * Devolve o corpo como stream para o arquivo não passar inteiro pela memória
 * do servidor — há memoriais escaneados de 30 MB no Drive da BB, e vários
 * downloads simultâneos derrubariam o processo se cada um virasse Buffer.
 */
export async function baixarArquivo(
  fileId: string,
): Promise<{ corpo: ReadableStream<Uint8Array>; tipo: string; tamanho: string | null }> {
  const token = await accessToken();
  const resposta = await fetch(
    `${API}/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { authorization: `Bearer ${token}` } },
  );

  if (!resposta.ok || !resposta.body) {
    throw new Error(`Drive recusou o download (${resposta.status}): ${await resposta.text()}`);
  }

  return {
    corpo: resposta.body,
    tipo: resposta.headers.get("content-type") ?? "application/octet-stream",
    tamanho: resposta.headers.get("content-length"),
  };
}

/**
 * Manda um arquivo ou pasta para a lixeira do Drive.
 *
 * Lixeira e não exclusão definitiva, e isso é de propósito: o Drive guarda por
 * 30 dias e dá para restaurar com dois cliques. Documento de cliente apagado
 * por engano — o estagiário que anexou no dossiê errado e "corrigiu" — é
 * prejuízo que não se desfaz, e a API tem `files.delete` justamente para isso
 * acontecer. Não vamos usar.
 */
export async function moverParaLixeira(fileId: string): Promise<void> {
  await chamar(`/files/${encodeURIComponent(fileId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
}

/**
 * Tira do link do Drive o id do arquivo.
 *
 * Os 2.788 documentos importados guardam a URL inteira
 * (`https://drive.google.com/file/d/<id>/view?usp=drivesdk`), não o id — foi o
 * que o Apps Script deu. Para baixar pelo Selebi é o id que vale.
 */
export function idDoLink(link: string | null): string | null {
  if (!link) return null;
  const porCaminho = link.match(/\/d\/([A-Za-z0-9_-]{10,})/);
  if (porCaminho) return porCaminho[1];
  const porParametro = link.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  return porParametro ? porParametro[1] : null;
}
