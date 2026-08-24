"""Converte a exportação .xls do Growatt OSS para CSV.

O botão Export do OSS entrega um .xls de Excel 97-2003 (formato OLE2), que as
bibliotecas JavaScript de planilha não leem — elas só abrem .xlsx. Este script
faz a ponte, e depois o importador consome o CSV normalmente.

    pip install xlrd
    python scripts/xls-para-csv.py "Plantlistdata.xls"
    npm run import:growatt -- "Plantlistdata.csv"

O CSV gerado tem nome e cidade dos clientes. Ele fica coberto pelo .gitignore —
confira antes de commitar qualquer coisa, porque o repositório é público.
"""

import csv
import sys
from pathlib import Path

try:
    import xlrd
except ImportError:
    sys.exit("Falta a biblioteca xlrd. Rode: pip install xlrd")


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit('Uso: python scripts/xls-para-csv.py "caminho/arquivo.xls"')

    origem = Path(sys.argv[1])
    if not origem.exists():
        sys.exit(f"Arquivo não encontrado: {origem}")

    destino = origem.with_suffix(".csv")

    livro = xlrd.open_workbook(origem)
    aba = livro.sheet_by_index(0)

    with destino.open("w", newline="", encoding="utf-8") as arquivo:
        escritor = csv.writer(arquivo)
        for indice in range(aba.nrows):
            escritor.writerow([celula.value for celula in aba.row(indice)])

    print(f"{aba.nrows} linhas escritas em {destino}")


if __name__ == "__main__":
    main()
