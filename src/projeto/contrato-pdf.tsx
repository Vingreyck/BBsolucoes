// O Next transforma o JSX sem precisar do React no escopo; o tsx (dos scripts
// de teste) usa a transformação clássica, que precisa. Importar serve aos dois.
import React from "react";

import { GARANTIAS_DO_MODELO, type DadosContrato } from "./contrato";

type ReactPdf = typeof import("@react-pdf/renderer");

/**
 * O contrato em PDF, igual ao "CONTRATO MODELO (CONTRATADO)" da BB Soluções
 * (21/11): logo no topo, marca-d'água no meio, endereço no rodapé, Times 12,
 * margens do Word, títulos em negrito e maiúsculas, cláusulas numeradas de
 * 1 a 15 sem recomeçar a cada seção e os itens das obrigações em letras.
 *
 * Gerado na hora a partir de `contrato.dados` (a fotografia do dia em que foi
 * gerado), nunca guardado: o mesmo link devolve sempre o mesmo contrato. Os
 * contratos de antes de 21/11 também saem neste formato, com os dados deles.
 *
 * O texto é o do modelo, com os erros de digitação acertados ("R$ R$",
 * "fornece", "1º(primeira)", "45 (quarenta e cinco) sendo em dias úteis").
 * Só muda o que é de cada cliente: quem contrata, o kit, o pagamento e as
 * garantias.
 */

const COR = { tinta: "#111111", fraca: "#444444" };

/** Margens do modelo no Word (em pontos): 2460/1559/1240/1700 twips. */
const MARGEM = { topo: 123, direita: 78, baixo: 66, esquerda: 85 };

function anos(n: number): string {
  return `${n} ${n === 1 ? "ano" : "anos"}`;
}

function montar(R: ReactPdf) {
  const { Document, Font, Image, Page, StyleSheet, Text, View } = R;

  // Sem hifenização, como no Word do modelo: o hifenizador da biblioteca é
  // inglês e partia e-mail e nome ("conta-to@…").
  Font.registerHyphenationCallback((palavra) => [palavra]);

  const s = StyleSheet.create({
    pagina: {
      paddingTop: MARGEM.topo,
      paddingBottom: MARGEM.baixo,
      paddingLeft: MARGEM.esquerda,
      paddingRight: MARGEM.direita,
      fontFamily: "Times-Roman",
      fontSize: 12,
      lineHeight: 1.15,
      color: COR.tinta,
    },
    // Logo de 182 × 60 pt no cabeçalho, centralizado como no modelo.
    topo: { position: "absolute", top: 40, left: 0, right: 0, alignItems: "center" },
    logo: { width: 182, height: 60, objectFit: "contain" },
    nomeTopo: { fontFamily: "Times-Bold", fontSize: 16, marginTop: 24 },
    marca: { position: "absolute", top: 330, left: 117, width: 360, height: 180, objectFit: "contain", opacity: 0.07 },
    rodape: {
      position: "absolute",
      bottom: 26,
      left: MARGEM.esquerda,
      right: MARGEM.direita,
      textAlign: "center",
      fontSize: 9.5,
      lineHeight: 1.2,
      color: COR.fraca,
    },
    titulo: { textAlign: "center", marginBottom: 10 },
    secao: { fontFamily: "Times-Bold", marginTop: 8, marginBottom: 4 },
    par: { textAlign: "justify", marginBottom: 6 },
    clausula: { flexDirection: "row", marginBottom: 6, paddingLeft: 18 },
    clausulaNum: { width: 22 },
    letra: { flexDirection: "row", marginBottom: 5, paddingLeft: 40 },
    letraNum: { width: 18 },
    texto: { flex: 1, textAlign: "justify" },
    garantia: { paddingLeft: 58, marginBottom: 2 },
    assinaturas: { marginTop: 18 },
    assinaturaBloco: { marginBottom: 20 },
    rotuloAssinatura: { fontFamily: "Times-Bold", marginBottom: 30 },
    linha: { width: 230, borderBottomWidth: 0.8, borderBottomColor: COR.tinta, marginBottom: 5 },
  });

  const Par = ({ children }: { children: React.ReactNode }) => <Text style={s.par}>{children}</Text>;
  const Secao = ({ children }: { children: React.ReactNode }) => (
    <Text style={s.secao} minPresenceAhead={60}>
      {children}
    </Text>
  );
  const Clausula = ({ n, children }: { n: number; children: React.ReactNode }) => (
    <View style={s.clausula} wrap={false}>
      <Text style={s.clausulaNum}>{`${n}.`}</Text>
      <Text style={s.texto}>{children}</Text>
    </View>
  );
  const Letra = ({ l, children }: { l: string; children: React.ReactNode }) => (
    <View style={s.letra} wrap={false}>
      <Text style={s.letraNum}>{`${l}.`}</Text>
      <Text style={s.texto}>{children}</Text>
    </View>
  );

  function Contrato({ d, logo }: { d: DadosContrato; logo: string | null }) {
    const c = d.contratante;
    const e = d.contratado;
    const g = d.garantias ?? GARANTIAS_DO_MODELO;
    // A numeração corre o contrato inteiro (1 a 15), como no Word do modelo.
    let n = 0;
    const prox = () => ++n;
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

          <Secao>CONTRATANTE:</Secao>
          <Par>{`${c.nome}, ${c.qualificacao}, situada na ${c.endereco}.`}</Par>

          <Secao>CONTRATADO(A):</Secao>
          {/* Um texto só, e não pedaços: a biblioteca trata a emenda entre dois
              pedaços como quebra de palavra e punha hífen no fim do CNPJ. */}
          <Par>
            {`${e.razaoSocial}, sociedade empresária inscrita sob o n° CNPJ: ${e.cnpj}, com sede na ${e.endereco}, ` +
              `e endereço eletrônico ${e.email}.`}
          </Par>

          <Par>CONTRATANTE e CONTRATADO(A) em conjunto como (Partes) e, individualmente, como (Parte).</Par>
          <Par>
            Pelo presente Contrato de Prestação de Serviços (Contrato), as Partes têm entre si, justo e acertado este
            Contrato que será regulado pelas cláusulas e condições abaixo estabelecidas:
          </Par>

          <Secao>DO OBJETO</Secao>
          <Clausula n={prox()}>
            O presente Contrato tem como objeto a prestação de serviços de instalação fotovoltaica mediante a
            contraprestação convencionada pelas Partes.
          </Clausula>
          <Clausula n={prox()}>{`${d.equipamentos}.`}</Clausula>
          <Clausula n={prox()}>
            O valor contratado contempla o fornecimento de todos os equipamentos e materiais necessários à execução do
            projeto, incluindo módulos fotovoltaicos, microinversores e ou inversores, estruturas, cabeamento, projeto
            técnico, emissão de ART, homologação junto à concessionária de energia.
          </Clausula>
          <Clausula n={prox()}>
            A geração mensal de energia constitui estimativa baseada em referência de estudo de solarimetria, podendo
            sofrer variações em razão de fatores climáticos e ambientais.
          </Clausula>
          <Clausula n={prox()}>
            Os serviços acima mencionados serão executados pelo(a) CONTRATADO(A), que declara ser devidamente
            habilitado(a) para realização de todas as atividades decorrentes desta atribuição.
          </Clausula>

          <Secao>DA EXECUÇÃO DOS SERVIÇOS E DO PAGAMENTO</Secao>
          <Clausula n={prox()}>
            Os serviços serão prestados pelo(a) CONTRATADO(A) durante o período de 45 (quarenta e cinco) dias úteis, a
            partir da assinatura do presente Contrato, não sendo mantido qualquer vínculo empregatício/trabalhista ou
            relação, além do retratado acima.
          </Clausula>

          <Secao>DO PAGAMENTO</Secao>
          <Clausula n={prox()}>{d.pagamento}</Clausula>

          <Secao>DAS OBRIGAÇÕES E RESPONSABILIDADES DA CONTRATADA</Secao>
          <Clausula n={prox()}>O(A) CONTRATADO(A) compromete-se a:</Clausula>
          <Letra l="a">
            executar fielmente os serviços sempre dentro da boa técnica e dos padrões usuais, bem como respeitar as
            normas, as especificações técnicas, as condições de segurança aplicáveis em trabalhos deste gênero, toda a
            legislação aplicável à espécie, seja federal, estadual ou municipal, bem como todas as determinações e
            resoluções dos órgãos competentes da Administração Pública e demais entidades de fiscalização.
          </Letra>
          <Letra l="b">
            as atividades serão realizadas pelo(a) CONTRATADO(A) de forma autônoma, responsabilizando-se, desde já, por
            eventuais processos judiciais ou administrativos propostos e relacionados ao Contrato, assumindo
            expressamente em juízo esta condição, sendo passível de indenização o(a) CONTRATANTE por eventuais ônus,
            despesas, honorários, condenações e/ou penalidades advindas da inobservância deste Contrato pelo(a)
            CONTRATADO(A), acompanhada da apuração dos danos diretos e/ou indiretos.
          </Letra>
          <Letra l="c">
            responsabilizar-se pelo competente e pontual recolhimento de todas as contribuições, demais tributos
            incidentes e a regularidade fiscal sobre a presente atividade.
          </Letra>
          <Letra l="d">fornecer as notas fiscais/recibos referentes aos pagamentos efetuados pelo(a) CONTRATANTE;</Letra>
          <Letra l="e">
            fica garantida a 1ª (primeira) manutenção do sistema pelo(a) CONTRATADO(A) no período de 12 (doze) meses
            após a instalação, sendo ela por causas naturais.
          </Letra>
          <View wrap={false}>
            <Letra l="f">Das garantias dos equipamentos:</Letra>
            <Text style={s.garantia}>{`INVERSOR - ${anos(g.inversor)} pelo fabricante`}</Text>
            <Text style={s.garantia}>{`PLACAS - ${anos(g.placas)}`}</Text>
            <Text style={s.garantia}>{`ESTRUTURA - ${anos(g.estrutura)}`}</Text>
            <Text style={[s.garantia, { marginBottom: 6 }]}>
              {`GARANTIA DE EFICIÊNCIA DO SISTEMA - ${anos(g.eficiencia)}`}
            </Text>
          </View>
          <Letra l="g">
            Os modelos dos equipamentos fornecidos serão identificados nas respectivas notas fiscais, admitindo-se
            eventual substituição por modelos equivalentes, desde que mantidas a compatibilidade técnica e as
            características essenciais do projeto, mediante prévia comunicação ao CONTRATANTE.
          </Letra>
          <Letra l="h">
            Antes do início da instalação, será realizada avaliação das condições de estrutura física do local. Caso
            sejam identificadas necessidades de reparos ou adequações, estas serão comunicadas previamente ao
            CONTRATANTE, cabendo-lhe providenciar as intervenções necessárias.
          </Letra>
          <Letra l="i">
            em caso de reprovação na vistoria, caberá à CONTRATADA solicitar nova vistoria e adotar as providências
            necessárias à regularização das pendências relacionadas aos serviços sob sua responsabilidade.
          </Letra>

          <Secao>DAS OBRIGAÇÕES E RESPONSABILIDADES DO(A) CONTRATANTE</Secao>
          <Clausula n={prox()}>O(A) CONTRATANTE compromete-se a:</Clausula>
          <Letra l="a">
            prestar ao(à) CONTRATADO(A), com clareza e precisão, as informações porventura solicitadas e inerentes ao
            cumprimento do objeto do Contrato.
          </Letra>
          <Letra l="b">
            comunicar ao(à) CONTRATADO(A), por escrito, a ocorrência de qualquer falha ou mau funcionamento,
            especificando o tipo de defeito, fornecendo todos os dados e informações necessárias ao seu saneamento,
            devendo o(à) CONTRATADO(A) promover a correção no prazo máximo de 3 (três) dias úteis.
          </Letra>
          <Letra l="c">efetuar os pagamentos devidos ao(à) CONTRATADO(A) na forma e nas datas ajustadas.</Letra>
          <Letra l="d">
            disponibilizar responsável para acompanhar e receber a equipe da concessionária de energia no imóvel,
            quando necessário à realização de vistoria.
          </Letra>
          <Letra l="e">
            arcar com eventuais cobranças de RED decorrentes de alteração de titularidade da unidade consumidora, quando
            aplicáveis, não estando tais valores incluídos no preço contratado.
          </Letra>

          <Secao>DA VIGÊNCIA</Secao>
          <Clausula n={prox()}>
            A vigência do Contrato é firmada por período determinado em que sua vigência findará em 45 a 60 dias,
            podendo ser renovado por igual prazo desde que exista concordância expressa por ambas as Partes e ou por
            motivo de força maior.
          </Clausula>

          <Secao>DAS DISPOSIÇÕES GERAIS</Secao>
          <Clausula n={prox()}>
            Não se estabelece entre as Partes, por força deste Contrato, qualquer forma de sociedade, associação,
            mandato, representação, agência, consórcio ou responsabilidade solidária para quaisquer fins.
          </Clausula>
          <Clausula n={prox()}>
            O(A) CONTRATADO(A) assumirá integral responsabilidade pela perfeição na execução dos serviços contratados,
            bem como responderá perante o(a) CONTRATANTE e a terceiros, por eventuais perdas e danos a que der causa em
            razão da qualidade dos serviços e dos atos praticados na sua execução, quer por si, quer por sua equipe de
            profissionais disponibilizada, direta ou indiretamente nesta execução.
          </Clausula>
          <Clausula n={prox()}>
            Este Contrato contém todo o entendimento entre as Partes referente à matéria aqui estabelecida, tornando sem
            efeito, de forma irrevogável, quaisquer outros entendimentos anteriormente havidos entre elas. Ademais, este
            Contrato poderá ser modificado a qualquer tempo, por mútuo e comum acordo.
          </Clausula>
          <Clausula n={prox()}>Pelo fiel cumprimento do presente Contrato, obrigam-se as Partes e seus sucessores.</Clausula>
          <Clausula n={prox()}>
            A Lei Geral de Proteção de Dados (&quot;LGPD&quot;) dispõe ainda que quaisquer dados de terceiros e/ou
            informações pessoais que possam ser obtidas ou utilizadas por qualquer das partes em decorrência do presente
            Contrato (&quot;Dados&quot;) serão recolhidos, utilizados, armazenados e mantidos de acordo com os padrões
            geralmente aceitos para coleta de dados, pela legislação aplicável, qual seja a Lei 13.709/2018.
          </Clausula>
          <Par>
            E assim, estando as Partes de comum acordo quanto ao contratado, dando-o por justo e acertado, assinam o
            presente Contrato, a fim de se produzir todos os efeitos de direito.
          </Par>

          <View style={s.assinaturas} wrap={false}>
            <View style={s.assinaturaBloco}>
              <Text style={s.rotuloAssinatura}>CONTRATANTE:</Text>
              <View style={s.linha} />
              <Text>{c.nome}</Text>
              <Text>{c.documento}</Text>
            </View>
            <View style={s.assinaturaBloco}>
              <Text style={s.rotuloAssinatura}>CONTRATADO (A):</Text>
              <View style={s.linha} />
              <Text>{e.razaoSocial}</Text>
              <Text>{e.cnpj}</Text>
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

/** "Contrato - Ana Maria Lima.pdf", sem caractere que quebre o cabeçalho. */
export function nomeDoContrato(dados: DadosContrato): string {
  const nome = dados.contratante.nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w .-]/g, "");
  return `Contrato - ${nome}.pdf`;
}
