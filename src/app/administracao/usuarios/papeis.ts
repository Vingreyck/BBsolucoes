/**
 * Os papéis que o administrador escolhe, na ordem do menu.
 *
 * Arquivo comum (nem servidor nem navegador) de propósito: a página, que roda no
 * servidor, e o seletor, que roda no navegador, leem a mesma lista.
 */
export const OPCOES_PAPEL = [
  ["tecnico", "Técnico"],
  ["vendedor", "Vendas"],
  ["engenheiro", "Engenharia"],
  ["estoque", "Estoque"],
  ["adm", "Administração"],
] as const;
