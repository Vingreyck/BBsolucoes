/**
 * O favorito "Enviar ao Selebi": um botão na barra de favoritos do navegador
 * que leva a lista "Meus projetos" do portal da Energisa para o Selebi.
 *
 * Por que favorito e não robô: o portal recusa acesso automatizado (Akamai —
 * "Access Denied" para o robô no servidor). Com o favorito, quem abre o portal
 * é uma pessoa, no navegador dela, logada como sempre; o clique só entrega ao
 * Selebi a lista que a própria página já recebeu.
 *
 * O que ele faz, na aba do portal:
 *  1. pede à página a mesma lista que ela mostra (`/_next/data/<build>/AWGPE/dashboard.json`);
 *  2. abre `/energisa/importar` no Selebi numa janela nova;
 *  3. quando o Selebi avisa que está pronto, entrega a lista por `postMessage`,
 *     só para a origem do Selebi.
 *
 * Só os campos que o Selebi usa viajam — nada de CPF ou dado do projetista.
 */

/** Os campos de cada projeto que o Selebi lê (ver `normalizarItem`). */
export const CAMPOS = [
  "numeroProjetoEletrico",
  "nomeEmpreendimento",
  "descricaoLogradouro",
  "numeroEndereco",
  "nomeBairro",
  "codigoUF",
  "dataAberturaISO",
  "codigoSituacaoProjetoEletrico",
  "descricaoSituacaoProjetoEletrico",
];

export const ORIGEM_ENERGISA = "https://servicos.energisa.com.br";

/** O código do favorito, já no formato `javascript:…`, para a origem do Selebi informada. */
export function codigoDoFavorito(origemSelebi: string): string {
  const selebi = JSON.stringify(origemSelebi.replace(/\/+$/, ""));
  const campos = JSON.stringify(CAMPOS);
  // A janela do Selebi abre já no clique: aberta depois da espera do fetch, o
  // navegador a trataria como pop-up indesejado e bloquearia. A lista vai quando
  // os dois lados estiverem prontos — a página buscou e o Selebi avisou.
  const corpo = `(async()=>{
if(location.origin!==${JSON.stringify(ORIGEM_ENERGISA)}){alert("Abra o portal da Energisa (Meus projetos), entre com o seu login e clique de novo.");return;}
const S=${selebi};const w=window.open(S+"/energisa/importar","selebi-energisa");
if(!w){alert("O navegador bloqueou a janela do Selebi. Permita pop-ups deste site e clique de novo.");return;}
let leve=null,pronto=false;
const ouvir=e=>{if(e.origin===S&&e.data==="selebi-pronto"){pronto=true;enviar();}};
const enviar=()=>{if(leve&&pronto){w.postMessage({tipo:"energisa",lista:leve},S);removeEventListener("message",ouvir);}};
addEventListener("message",ouvir);
const N=window.__NEXT_DATA__||{};const emp=new URLSearchParams(location.search).get("CodigoEmpresaWeb")||"3";
let j;try{const r=await fetch("/_next/data/"+N.buildId+"/AWGPE/dashboard.json?CodigoEmpresaWeb="+emp,{credentials:"include"});j=await r.json();}catch(e){w.close();alert("Não consegui ler a lista no portal. Recarregue a página e tente de novo.");return;}
const s=j&&j.pageProps&&j.pageProps.dadosServerSide;const lista=s&&s.solicitacao;
if(!Array.isArray(lista)){w.close();alert("O portal não entregou a lista: entre no portal da Energisa (login com o código do SMS) e clique de novo.");return;}
const C=${campos};leve=lista.map(p=>{const o={};for(const k of Object.keys(p))if(C.includes(k)||/^descricaoTipo/i.test(k))o[k]=p[k];return o;});
enviar();
})();`;
  return "javascript:" + encodeURIComponent(corpo.replace(/\n/g, ""));
}
