/**
 * Onde o navegador lembra se a pessoa escolheu o tema claro ou o escuro.
 *
 * Arquivo comum de propósito: o layout (servidor) escreve o script que lê a
 * chave antes de pintar, e o botão (navegador) grava nela. Sem escolha
 * guardada, o site segue o tema do computador ou do celular.
 */
export const CHAVE_TEMA = "selebi-tema";

/**
 * O script do `<head>`: roda antes da primeira pintura e escreve `data-tema`
 * ("claro" ou "escuro") na página, com a escolha guardada ou, na falta dela,
 * o tema do sistema. Sem isto a tela abriria clara e escureceria logo depois,
 * piscando. Se o navegador não deixar ler o armazenamento, a página fica sem o
 * atributo e o CSS cai no tema do sistema.
 */
export const SCRIPT_TEMA = `try{var t=localStorage.getItem("${CHAVE_TEMA}");if(t!=="claro"&&t!=="escuro")t=matchMedia("(prefers-color-scheme: dark)").matches?"escuro":"claro";document.documentElement.dataset.tema=t}catch(e){}`;
