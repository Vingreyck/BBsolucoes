// O Next transforma o JSX sem precisar do React no escopo; o tsx (dos scripts
// de teste) usa a transformação clássica, que precisa. Importar serve aos dois.
import React from "react";

import type { DadosContrato } from "./contrato";

type ReactPdf = typeof import("@react-pdf/renderer");

/**
 * O contrato em PDF, igual ao modelo que a BB Soluções já usa: logo no topo,
 * marca-d'água no meio, endereço no rodapé, Times como no Word.
 *
 * Gerado na hora a partir de `contrato.dados` (a fotografia do dia em que foi
 * gerado), nunca guardado: o mesmo link devolve sempre o mesmo contrato.
 *
 * O texto das cláusulas é o do modelo, palavra por palavra — inclusive a
 * numeração, em que o 3 aparece duas vezes. Só o que é de cada cliente muda:
 * quem contrata, o kit, o valor, a forma de pagamento e quem assina pela empresa.
 */

const COR = { tinta: "#111111", fraca: "#444444" };

function montar(R: ReactPdf) {
  const { Document, Font, Image, Page, StyleSheet, Text, View } = R;

  // Sem hifenização, como no Word do modelo: o hifenizador da biblioteca é
  // inglês e partia e-mail e nome ("conta-to@…").
  Font.registerHyphenationCallback((palavra) => [palavra]);

  const s = StyleSheet.create({
    pagina: {
      paddingTop: 112,
      paddingBottom: 60,
      paddingHorizontal: 72,
      fontFamily: "Times-Roman",
      fontSize: 11.5,
      color: COR.tinta,
    },
    topo: { position: "absolute", top: 34, left: 0, right: 0, alignItems: "center" },
    logo: { width: 170, height: 70, objectFit: "contain" },
    nomeTopo: { fontFamily: "Times-Bold", fontSize: 16, marginTop: 30 },
    marca: { position: "absolute", top: 300, left: 110, width: 380, height: 220, objectFit: "contain", opacity: 0.07 },
    rodape: {
      position: "absolute",
      bottom: 28,
      left: 72,
      right: 72,
      textAlign: "center",
      fontSize: 10,
      color: COR.fraca,
    },
    titulo: { textAlign: "center", fontSize: 12, marginBottom: 14 },
    secao: { fontFamily: "Times-Bold", marginTop: 6, marginBottom: 4 },
    par: { textAlign: "justify", lineHeight: 1.12, marginBottom: 5 },
    item: { flexDirection: "row", marginBottom: 4, paddingLeft: 14 },
    itemNum: { width: 18 },
    itemTexto: { flex: 1, textAlign: "justify", lineHeight: 1.12 },
    negrito: { fontFamily: "Times-Bold" },
    assinaturas: { marginTop: 12 },
    assinaturaBloco: { marginBottom: 8 },
    rotuloAssinatura: { fontSize: 10.5, marginBottom: 24 },
    linha: { width: 200, borderBottomWidth: 0.8, borderBottomColor: COR.tinta, marginBottom: 6 },
    assinaturaTexto: { marginBottom: 2 },
  });

  const Par = ({ children }: { children: React.ReactNode }) => <Text style={s.par}>{children}</Text>;
  const Item = ({ n, children }: { n: string; children: React.ReactNode }) => (
    <View style={s.item} wrap={false}>
      <Text style={s.itemNum}>{n}</Text>
      <Text style={s.itemTexto}>{children}</Text>
    </View>
  );

  function Contrato({ d, logo }: { d: DadosContrato; logo: string | null }) {
    const c = d.contratante;
    const e = d.contratado;
    return (
      <Document title={`Contrato - ${c.nome}`} author={e.razaoSocial} creator="Selebi" producer="Selebi">
        <Page size="A4" style={s.pagina}>
          <View style={s.topo} fixed>
            {logo ? <Image src={logo} style={s.logo} /> : <Text style={s.nomeTopo}>{e.nomeFantasia.toUpperCase()}</Text>}
          </View>
          {logo && <Image src={logo} style={s.marca} fixed />}
          <Text style={s.rodape} fixed>
            {`${e.nomeFantasia}, ${e.endereco}`}
          </Text>

          <Text style={s.titulo}>CONTRATO DE PRESTAÇÃO DE SERVIÇOS</Text>

          <Text style={s.secao} minPresenceAhead={60}>CONTRATANTE:</Text>
          <Par>{`${c.nome}, ${c.qualificacao}, situada na ${c.endereco}.`}</Par>

          <Text style={s.secao} minPresenceAhead={60}>CONTRATADO(A):</Text>
          {/* Um texto só, e não pedaços: a biblioteca trata a emenda entre dois
              pedaços como quebra de palavra e punha hífen no fim do CNPJ. */}
          <Par>
            {`${e.razaoSocial}, sociedade empresária inscrita no CNPJ sob o n° ${e.cnpj}, com sede na ${e.endereco}, ` +
              `e endereço eletrônico ${e.email}, neste ato representada por ${e.representante}` +
              `${e.representanteCpf ? `, inscrito(a) no CPF sob o nº ${e.representanteCpf}` : ""}.`}
          </Par>

          <Par>CONTRATANTE e CONTRATADO(A) em conjunto como (Partes) e, individualmente, como (Parte).</Par>
          <Par>
            Pelo presente Contrato de Prestação de Serviços (Contrato), as Partes têm entre si, justo e acertado este
            Contrato que será regulado pelas cláusulas e condições abaixo estabelecidas:
          </Par>

          <Text style={s.secao} minPresenceAhead={60}>Objetos</Text>
          <Item n="1.">
            O presente Contrato tem como objeto a prestação de serviços de instalação fotovoltaica mediante a
            contraprestação convencionada pelas Partes.
          </Item>
          <Item n="2.">{`${d.equipamentos}.`}</Item>
          <Item n="3.">
            Os serviços acima mencionados serão executados pelo(a) CONTRATADO(A), que declara ser devidamente
            habilitado(a) para realização de todas as atividades decorrentes desta atribuição.
          </Item>

          <Text style={s.secao} minPresenceAhead={60}>Forma de Execução dos Serviços e Pagamento</Text>
          <Par>
            3. Os serviços serão prestados pelo(a) CONTRATADO(A) durante o período de 45 (quarenta e cinco dias) sendo em
            dias úteis e convencionais, a partir da assinatura do presente Contrato, não sendo mantido qualquer vínculo
            empregatício/trabalhista ou relação, além do retratado acima.
          </Par>
          <Par>
            4. O(a) CONTRATANTE <Text style={s.negrito}>Pagamento:</Text>
          </Par>
          <Par>{d.pagamento}</Par>

          <Text style={s.secao} minPresenceAhead={60}>Obrigações e Responsabilidades do(a) CONTRATADO(A)</Text>
          <Par>5. O(A) CONTRATADO(A) compromete-se a:</Par>
          <Par>
            a. executar fielmente os serviços sempre dentro da boa técnica e dos padrões usuais, bem como respeitar as
            normas, as especificações técnicas, as condições de segurança aplicáveis em trabalhos deste gênero, toda a
            legislação aplicável à espécie, seja federal, estadual ou municipal, bem como todas as determinações e
            resoluções dos órgãos competentes da Administração Pública e demais entidades de fiscalização.
          </Par>
          <Par>
            b. as atividades serão realizadas pelo(a) CONTRATADO(A) de forma autônoma, responsabilizando-se, desde já,
            por eventuais processos judiciais ou administrativos propostos e relacionados ao Contrato, assumindo
            expressamente em juízo esta condição, sendo passível de indenização o(a) CONTRATANTE por eventuais ônus,
            despesas, honorários, condenações e/ou penalidades advindas da inobservância deste Contrato pelo(a)
            CONTRATADO(A), acompanhada da apuração dos danos diretos e/ou indiretos.
          </Par>
          <Par>
            c. responsabilizar-se pelo competente e pontual recolhimento de todas as contribuições, demais tributos
            incidentes e a regularidade fiscal sobre a presente atividade.
          </Par>
          <Par>d. fornecer as notas fiscais/recibos referentes aos pagamentos efetuados pelo(a) CONTRATANTE;</Par>

          <Text style={s.secao} minPresenceAhead={60}>Obrigações e Responsabilidades do(a) CONTRATANTE</Text>
          <Par>6. O(A) CONTRATANTE compromete-se a:</Par>
          <Par>
            a. prestar ao(à) CONTRATADO(A), com clareza e precisão, as informações porventura solicitadas e inerentes ao
            cumprimento do objeto do Contrato.
          </Par>
          <Par>
            b. comunicar ao(à) CONTRATADO(A), por escrito, a ocorrência de qualquer falha ou mau funcionamento,
            especificando o tipo de defeito, fornecendo todos os dados e informações necessárias ao seu saneamento,
            devendo o(à) CONTRATADO(A) promover a correção no prazo máximo de 3 (três) dias úteis.
          </Par>
          <Par>c. efetuar os pagamentos devidos ao(à) CONTRATADO(A) na forma e nas datas ajustadas.</Par>

          <Text style={s.secao} minPresenceAhead={60}>Vigência</Text>
          <Par>
            7. A vigência do Contrato é firmada por período determinado em que sua vigência findará em 45 a 60 dias,
            podendo ser renovado por igual prazo desde que exista concordância expressa por ambas as Partes e ou por
            motivo de força maior.
          </Par>

          <Text style={s.secao} minPresenceAhead={60}>Disposições Gerais</Text>
          <Par>
            8. Não se estabelece entre as Partes, por força deste Contrato, qualquer forma de sociedade, associação,
            mandato, representação, agência, consórcio ou responsabilidade solidária para quaisquer fins.
          </Par>
          <Par>
            9 O(A) CONTRATADO(A) assumirá integral responsabilidade pela perfeição na execução dos serviços
            contratados, bem como responderá perante o(a) CONTRATANTE e a terceiros, por eventuais perdas e danos a que
            der causa em razão da qualidade dos serviços e dos atos praticados na sua execução, quer por si, quer por sua
            equipe de profissionais disponibilizada, direta ou indiretamente nesta execução.
          </Par>
          <Par>
            10. Este Contrato contém todo o entendimento entre as Partes referente à matéria aqui estabelecida, tornando
            sem efeito, de forma irrevogável, quaisquer outros entendimentos anteriormente havidos entre elas. Ademais,
            este Contrato poderá ser modificado a qualquer tempo, por mútuo e comum acordo.
          </Par>
          <Par>11. Pelo fiel cumprimento do presente Contrato, obrigam-se as Partes e seus sucessores.</Par>
          <Par>
            12. A Lei Geral de Proteção de Dados (&quot;LGPD&quot;) dispõe ainda que quaisquer dados de terceiros e/ou
            informações pessoais que possam ser obtidas ou utilizadas por qualquer das partes em decorrência do presente
            Contrato (&quot;Dados&quot;) serão recolhidos, utilizados, armazenados e mantidos de acordo com os padrões
            geralmente aceitos para coleta de dados, pela legislação aplicável, qual seja a Lei 13.709/2018.
          </Par>
          <Par>
            E assim, estando as Partes de comum acordo quanto ao contratado, dando-o por justo e acertado, assinam o
            presente Contrato, a fim de se produzir todos os efeitos de direito.
          </Par>

          <View style={s.assinaturas} wrap={false}>
            <View style={s.assinaturaBloco}>
              <Text style={s.rotuloAssinatura}>CONTRATANTE:</Text>
              <View style={s.linha} />
              <Text style={s.assinaturaTexto}>{c.nome}</Text>
              <Text style={s.assinaturaTexto}>{c.documento}</Text>
            </View>
            <View style={s.assinaturaBloco}>
              <Text style={s.rotuloAssinatura}>CONTRATADO:</Text>
              <View style={s.linha} />
              <Text style={s.assinaturaTexto}>{e.razaoSocial}</Text>
              <Text style={s.assinaturaTexto}>{e.cnpj}</Text>
              <Text style={s.assinaturaTexto}>{`Representante: ${e.representante}`}</Text>
            </View>
          </View>
        </Page>
      </Document>
    );
  }

  return { Contrato, renderToBuffer: R.renderToBuffer };
}

let montado: ReturnType<typeof montar> | null = null;

async function biblioteca() {
  montado ??= montar(await import("@react-pdf/renderer"));
  return montado;
}

export async function gerarContratoPdf(dados: DadosContrato, logo: string | null): Promise<Buffer> {
  const { Contrato, renderToBuffer } = await biblioteca();
  return renderToBuffer(<Contrato d={dados} logo={logo} />);
}

/** "Contrato - David Bruno Nunes Santos.pdf", sem caractere que quebre o cabeçalho. */
export function nomeDoContrato(dados: DadosContrato): string {
  const nome = dados.contratante.nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w .-]/g, "");
  return `Contrato - ${nome}.pdf`;
}
