/**
 * Lista as pastas de cliente do Drive da BB Soluções em um CSV.
 *
 * Roda dentro da conta do Google, então não depende de credencial de API nem
 * de o Drive estar sincronizado em alguma máquina. O CSV que ele gera é a
 * entrada do `npm run import:drive`.
 *
 * **Desce nas subpastas.** As pastas de cliente não seguem um padrão: algumas
 * têm os documentos soltos, outras trazem um pacote `PE Solar ...` com
 * pranchas, memorial, ART assinada e datasheets lá dentro, às vezes em mais um
 * nível. A primeira versão deste script olhava só o primeiro nível e o WESLEY
 * aparecia sem ART — tendo a ART assinada dentro de `Documentos Assinados`.
 *
 * Padronizar 178 pastas à mão não é caminho. O jeito é o sistema não se
 * importar com o formato: o que vale é qual documento existe, esteja ele onde
 * estiver.
 *
 * COMO USAR
 *
 *   1. Abra https://script.google.com com a conta bbsolucoesengenharia
 *   2. Novo projeto, cole este arquivo inteiro
 *   3. Rode `listarClientes` (vai pedir autorização na primeira vez)
 *   4. O CSV aparece no Drive, na raiz, como "selebi-documentos-AAAA-MM-DD.csv"
 *   5. Baixe e salve em dados/ no projeto
 */

/** A pasta "Energia solar", que contém CLIENTES 2024, 2025 e 2026. */
var PASTA_RAIZ = "1D0WR5QREFHXBb4EH1Leoc15y3hX8Czd1";

/** Trava de segurança: pasta de cliente com aninhamento além disso é erro. */
var PROFUNDIDADE_MAXIMA = 5;

function listarClientes() {
  var raiz = DriveApp.getFolderById(PASTA_RAIZ);
  var linhas = [
    ["ano", "cliente", "caminho", "arquivo", "tipoMime", "tamanho", "modificado", "link", "idPasta"],
  ];

  var anos = raiz.getFolders();
  while (anos.hasNext()) {
    var ano = anos.next();
    var nomeAno = ano.getName();
    if (nomeAno.indexOf("CLIENTE") === -1) continue;

    var clientes = ano.getFolders();
    while (clientes.hasNext()) {
      var cliente = clientes.next();
      var antes = linhas.length;

      percorrer(cliente, nomeAno, cliente.getName(), cliente.getId(), "", 0, linhas);

      /**
       * Pasta vazia também vira linha. É informação: cliente com pasta criada e
       * nenhum documento dentro é exatamente o caso que some de qualquer
       * relatório e depois vira problema na homologação.
       */
      if (linhas.length === antes) {
        linhas.push([
          nomeAno,
          cliente.getName(),
          "",
          "",
          "",
          "",
          "",
          cliente.getUrl(),
          cliente.getId(),
        ]);
      }
    }
  }

  var csv = linhas
    .map(function (linha) {
      return linha
        .map(function (celula) {
          var texto = String(celula === null || celula === undefined ? "" : celula);
          return '"' + texto.replace(/"/g, '""') + '"';
        })
        .join(",");
    })
    .join("\n");

  var nome =
    "selebi-documentos-" +
    Utilities.formatDate(new Date(), "GMT-3", "yyyy-MM-dd") +
    ".csv";

  var arquivo = DriveApp.createFile(nome, csv, MimeType.CSV);
  Logger.log("Pronto: " + (linhas.length - 1) + " linhas em " + nome + "\n" + arquivo.getUrl());
}

/**
 * Percorre uma pasta e tudo abaixo dela.
 *
 * `idPastaCliente` é sempre o da pasta do cliente, não o da subpasta: é ele que
 * identifica o cliente do lado de cá, e não pode mudar porque o arquivo estava
 * dois níveis abaixo. `caminho` guarda onde o arquivo estava, que é o que
 * responde "a ART está solta ou dentro do pacote assinado?".
 */
function percorrer(pasta, ano, nomeCliente, idPastaCliente, caminho, nivel, linhas) {
  if (nivel > PROFUNDIDADE_MAXIMA) return;

  var arquivos = pasta.getFiles();
  while (arquivos.hasNext()) {
    var arquivo = arquivos.next();
    linhas.push([
      ano,
      nomeCliente,
      caminho,
      arquivo.getName(),
      arquivo.getMimeType(),
      arquivo.getSize(),
      Utilities.formatDate(arquivo.getLastUpdated(), "GMT-3", "yyyy-MM-dd"),
      arquivo.getUrl(),
      idPastaCliente,
    ]);
  }

  var subpastas = pasta.getFolders();
  while (subpastas.hasNext()) {
    var sub = subpastas.next();
    percorrer(
      sub,
      ano,
      nomeCliente,
      idPastaCliente,
      caminho ? caminho + " / " + sub.getName() : sub.getName(),
      nivel + 1,
      linhas
    );
  }
}
