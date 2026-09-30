import "dotenv/config";

import { eq, inArray } from "drizzle-orm";

import { db, schema } from "@/db";
import type { Ator } from "@/os/acesso";
import { criarOs, executarAcao } from "@/os/fluxo";

import { emCampo, inicioDoMes, produtividade, trilhaDaOs } from "./acompanhamento";
import { assinar, type EventoCampo } from "./hub";
import { normalizarPonto, registrarPosicoes, type PontoRecebido } from "./posicoes";
import { amostrar, casarNasRuas, dividirEmLotes } from "./ruas";
import { deveGravar, distanciaMetros, frescorDa, limparTrilha, type Ponto } from "./trilha";

/**
 * Confere o rastreamento: as regras da trilha (os casos que deram queixa no
 * SeeNet), a gravação no banco, a permissão e o aviso ao vivo.
 *
 *   npm run testar:rastreamento
 *   npm run testar:rastreamento -- --osrm     (também cola uma rota de verdade no OSRM público)
 *
 * Cria um cliente, uma usina e dois técnicos de teste e apaga tudo no fim.
 */

let falhas = 0;
let total = 0;
function confere(condicao: unknown, descricao: string, detalhe?: unknown) {
  total++;
  if (condicao) console.log(`  ok  ${descricao}`);
  else {
    falhas++;
    console.log(`  FALHOU  ${descricao}`, detalhe ?? "");
  }
}

// Praça Fausto Cardoso, Aracaju — e um passo de ~83 m para o norte (60 km/h em 5 s).
const ARACAJU = { lat: -10.9115, lng: -37.0514 };
const PASSO_LAT = 83 / 111_320;
const t0 = new Date("2026-09-25T13:00:00Z");
const seg = (s: number) => new Date(t0.getTime() + s * 1000);

function viagem(n: number, precisao = 8, velocidade = 16.7, inicio = 0): Ponto[] {
  return Array.from({ length: n }, (_, i) => ({
    latitude: ARACAJU.lat + i * PASSO_LAT,
    longitude: ARACAJU.lng,
    precisao,
    velocidade,
    capturadoEm: seg(inicio + i * 5),
  }));
}

function regras() {
  console.log("\nGravação (o que entra na trilha)");
  const p = (s: number, extra: Partial<Ponto> = {}): Ponto => ({
    latitude: ARACAJU.lat,
    longitude: ARACAJU.lng,
    precisao: 8,
    velocidade: 10,
    capturadoEm: seg(s),
    ...extra,
  });
  confere(deveGravar(null, p(0)), "primeiro ponto entra");
  confere(!deveGravar(null, p(0, { precisao: 65 })), "precisão de 65 m (antena/Wi-Fi) não entra");
  confere(!deveGravar(null, p(0, { velocidade: 0.3 })), "parado de verdade (0,3 m/s informado) não entra");
  confere(deveGravar({ capturadoEm: seg(0) }, p(5)), "andando: entra de 5 em 5 s");
  confere(!deveGravar({ capturadoEm: seg(0) }, p(3)), "andando: 3 s depois ainda não");
  confere(!deveGravar({ capturadoEm: seg(0) }, p(30, { velocidade: null })), "sem velocidade informada: ritmo de parado (30 s não)");
  confere(deveGravar({ capturadoEm: seg(0) }, p(61, { velocidade: null })), "sem velocidade informada: entra depois de 1 min");
  confere(!deveGravar(null, p(0, { latitude: 0, longitude: 0 })), "a ilha nula (0,0) não entra");

  console.log("\nLeitura (a limpeza e os trechos)");
  const carro = limparTrilha(viagem(25));
  confere(carro.trechos.length === 1 && carro.trechos[0].length === 25, "viagem de carro passa inteira, num trecho só", carro.trechos.map((t) => t.length));

  const comSalto = viagem(10);
  comSalto[5] = { ...comSalto[5], latitude: ARACAJU.lat + 1 }; // ~110 km em 5 s
  const salto = limparTrilha(comSalto);
  confere(salto.descartados === 1 && salto.trechos[0].length === 9, "salto de 80.000 km/h é descartado", salto);

  const rabisco: Ponto[] = Array.from({ length: 20 }, (_, i) => ({
    latitude: ARACAJU.lat + Math.sin(i * 2.1) * (35 / 111_320),
    longitude: ARACAJU.lng + Math.cos(i * 1.3) * (35 / 111_320),
    precisao: 45,
    velocidade: null,
    capturadoEm: seg(i * 60),
  }));
  const estrela = limparTrilha(rabisco);
  confere(estrela.trechos.length === 0, "técnico parado com leitura de 45 m: nenhuma linha (a 'estrela' em cima da casa)", estrela.trechos.length);

  const duasVisitas = limparTrilha([...viagem(8), ...viagem(8, 8, 16.7, 2 * 3600)]);
  confere(duasVisitas.trechos.length === 2, "duas visitas com 2 h de intervalo viram dois trechos, sem reta ligando", duasVisitas.trechos.length);

  const semPrecisao = limparTrilha(viagem(6).map((x) => ({ ...x, precisao: null })));
  confere(semPrecisao.trechos[0]?.length === 6, "ponto sem precisão gravada continua valendo");

  const passo30 = (precisao: number): Ponto[] => [
    { latitude: ARACAJU.lat, longitude: ARACAJU.lng, precisao, velocidade: 2, capturadoEm: seg(0) },
    { latitude: ARACAJU.lat + 30 / 111_320, longitude: ARACAJU.lng, precisao, velocidade: 2, capturadoEm: seg(20) },
  ];
  confere(limparTrilha(passo30(8)).trechos.length === 1, "passo de 30 m conta com leitura de 8 m");
  confere(limparTrilha(passo30(45)).trechos.length === 0, "o mesmo passo não conta com leitura de 45 m");
  confere(limparTrilha([]).trechos.length === 0, "lista vazia não quebra");
  const km = distanciaMetros(-10.9115, -37.0514, -10.6833, -37.4253) / 1000;
  confere(km > 45 && km < 50, `Aracaju → Itabaiana ≈ ${km.toFixed(1)} km em linha reta`);

  console.log("\nFrescor (verde, amarelo, vermelho)");
  const agora = seg(1000);
  confere(frescorDa(seg(980), "deslocamento", agora) === "ao_vivo", "a caminho, 20 s: ao vivo");
  confere(frescorDa(seg(940), "deslocamento", agora) === "atrasado", "a caminho, 60 s: atrasado");
  confere(frescorDa(seg(800), "deslocamento", agora) === "sem_sinal", "a caminho, 200 s: sem sinal");
  confere(frescorDa(seg(940), "eco", agora) === "ao_vivo", "no local (modo econômico), 60 s: ainda ao vivo");
  confere(frescorDa(seg(800), "eco", agora) === "atrasado", "no local, 200 s: atrasado");
  confere(frescorDa(seg(500), "eco", agora) === "sem_sinal", "no local, 500 s: sem sinal");

  console.log("\nLotes do OSRM");
  const lotes = dividirEmLotes(Array.from({ length: 200 }, (_, i) => i));
  confere(
    lotes.length === 3 && lotes[1][0] === 89 && lotes.at(-1)!.at(-1) === 199 && lotes.every((l) => l.length <= 90),
    "200 pontos viram lotes de até 90, emendados, sem perder o último",
    lotes.map((l) => [l[0], l.at(-1)]),
  );
  const amostra = amostrar(Array.from({ length: 240 }, (_, i) => i), 37);
  confere(
    amostra.length === 37 && amostra[0] === 0 && amostra.at(-1) === 239,
    "trilha longa é amostrada do começo ao fim (o fim não some)",
    [amostra.length, amostra[0], amostra.at(-1)],
  );
  const publico = dividirEmLotes(amostra, 10);
  confere(publico.length === 4 && publico.every((l) => l.length <= 10), "no OSRM público: lotes de até 10 pontos, no máximo 4 chamadas", publico.map((l) => l.length));

  console.log("\nO que chega do celular");
  const base = { ordemId: "0b6a1b1e-6f5d-4a52-9b8a-2f7d7d1c0c01", latitude: -10.9, longitude: -37.05, capturadoEm: seg(0).toISOString() };
  confere(normalizarPonto(base, seg(10))?.modo === "deslocamento", "ponto bom passa, com o modo padrão");
  confere(normalizarPonto({ ...base, ordemId: "x" }, seg(10)) === null, "OS que não é UUID é descartada");
  confere(normalizarPonto({ ...base, latitude: 0, longitude: 0 }, seg(10)) === null, "coordenada zerada é descartada");
  confere(
    normalizarPonto({ ...base, capturadoEm: seg(3600).toISOString() }, seg(0))?.capturadoEm.getTime() === seg(0).getTime(),
    "relógio do celular adiantado vira a hora do servidor",
  );
  confere(normalizarPonto(base, seg(8 * 86_400)) === null, "ponto de mais de 7 dias é descartado");
  confere(normalizarPonto({ ...base, bateria: 150 }, seg(10))?.bateria === null, "bateria absurda vira nula");
}

async function banco() {
  const empresa = await db.query.empresa.findFirst({ columns: { id: true, nome: true } });
  if (!empresa) throw new Error("Nenhuma empresa no banco.");
  const marca = `teste-rastreio-${Date.now()}`;
  const criados = { usuarios: [] as string[], cliente: "", usina: "", os: [] as string[] };
  const ouvidos: EventoCampo[] = [];
  const parar = assinar(empresa.id, (e) => ouvidos.push(e));
  const antesDoOsrm = process.env.OSRM_ATIVO;
  process.env.OSRM_ATIVO = "false"; // a trilha do teste não depende da internet

  try {
    const [adm, tecnico, outro] = await db
      .insert(schema.usuario)
      .values(
        ["adm", "tecnico", "tecnico"].map((papel, i) => ({
          empresaId: empresa.id,
          nome: `Teste Rastreio ${papel} ${i} (pode apagar)`,
          email: `${marca}-${i}@teste.invalid`,
          senhaHash: "x",
          papel: papel as "adm" | "tecnico",
          ativo: true,
          aprovadoEm: new Date(),
        })),
      )
      .returning({ id: schema.usuario.id, nome: schema.usuario.nome });
    criados.usuarios.push(adm.id, tecnico.id, outro.id);
    const gestao: Ator = { id: adm.id, nome: adm.nome, empresaId: empresa.id, papel: "adm", origem: "web", gestao: true };
    const tec: Ator = { id: tecnico.id, nome: tecnico.nome, empresaId: empresa.id, papel: "tecnico", origem: "app", gestao: false };
    const intruso: Ator = { ...tec, id: outro.id, nome: outro.nome };

    const [cliente] = await db
      .insert(schema.cliente)
      .values({ empresaId: empresa.id, tipo: "pf", nome: "Cliente Teste Rastreio (pode apagar)", cidade: "Aracaju", uf: "SE" })
      .returning({ id: schema.cliente.id });
    criados.cliente = cliente.id;
    // A usina fica ~2 km ao norte da praça: é o "destino" do mapa.
    const [usina] = await db
      .insert(schema.usina)
      .values({
        empresaId: empresa.id,
        clienteId: cliente.id,
        nome: `Usina teste rastreio ${marca}`,
        latitude: (ARACAJU.lat + 2000 / 111_320).toFixed(7),
        longitude: ARACAJU.lng.toFixed(7),
      })
      .returning({ id: schema.usina.id });
    criados.usina = usina.id;

    const os = await criarOs(gestao, {
      clienteId: cliente.id,
      usinaId: usina.id,
      tipo: "corretiva",
      prioridade: "normal",
      descricao: "Teste do rastreamento.",
      responsavelId: tecnico.id,
    });
    criados.os.push(os.id);

    console.log("\nRegistrar posições");
    await executarAcao(tec, os.id, { tipo: "deslocamento" }, { latitude: ARACAJU.lat, longitude: ARACAJU.lng, precisao: 9 });
    confere(ouvidos.some((e) => e.tipo === "os" && e.ordemId === os.id), "o mapa aberto fica sabendo que a OS mudou (saiu para o local)");

    const agora = new Date();
    const pontos = (inicioSeg: number, n: number): PontoRecebido[] =>
      viagem(n, 8, 16.7, 0).map((p, i) => ({
        ...p,
        ordemId: os.id,
        precisao: 8,
        velocidade: 16.7,
        bateria: 64,
        modo: "deslocamento" as const,
        capturadoEm: new Date(agora.getTime() - (600 - inicioSeg - i * 5) * 1000),
      }));

    const r1 = await registrarPosicoes(tec, pontos(0, 12), agora);
    confere(r1.aceitos === 12 && r1.naTrilha === 12 && r1.atualizou, "lote de 12 pontos andando: todos na trilha e posição atual", r1);
    const ultimoEvento = ouvidos.filter((e) => e.tipo === "posicao").at(-1);
    confere(ultimoEvento?.tipo === "posicao" && ultimoEvento.bateria === 64, "o mapa recebe a posição ao vivo, com a bateria");

    const r2 = await registrarPosicoes(tec, pontos(0, 12), agora);
    confere(r2.naTrilha === 0, "o mesmo lote reenviado (fila offline) não duplica a trilha", r2);

    const atrasado = pontos(-300, 3).map((p) => ({ ...p, latitude: p.latitude - 0.05 }));
    const r3 = await registrarPosicoes(tec, atrasado, agora);
    const atual = await db.query.posicaoAtual.findFirst({ where: eq(schema.posicaoAtual.usuarioId, tecnico.id) });
    confere(!r3.atualizou && Number(atual?.latitude) > ARACAJU.lat, "lote atrasado não volta o técnico no mapa", atual?.latitude);

    const r4 = await registrarPosicoes(intruso, pontos(100, 3), agora);
    confere(r4.recusados === 3 && r4.aceitos === 0, "outro técnico não manda posição na OS dos outros", r4);

    console.log("\nO que o escritório vê");
    const lista = await emCampo(empresa.id);
    const naLista = lista.find((l) => l.ordemId === os.id);
    confere(naLista?.status === "em_deslocamento" && naLista.posicao?.bateria === 64, "a OS aparece em campo, com a posição e a bateria");
    confere(naLista?.tecnico?.id === tecnico.id && naLista.desde !== null, "com o técnico e desde quando saiu");
    confere(
      naLista?.distanciaDestinoM !== null && naLista!.distanciaDestinoM! > 900 && naLista!.distanciaDestinoM! < 1300,
      `distância até a usina do cliente (${naLista?.distanciaDestinoM} m)`,
    );

    await executarAcao(tec, os.id, { tipo: "iniciar" }, { latitude: ARACAJU.lat + 2000 / 111_320, longitude: ARACAJU.lng, precisao: 12 });
    const eco = pontos(200, 2).map((p) => ({ ...p, modo: "eco" as const, velocidade: 0, precisao: 80 }));
    const r5 = await registrarPosicoes(tec, eco, agora);
    confere(r5.naTrilha === 0 && r5.atualizou, "no local (eco, parado, 80 m): atualiza a posição, não risca a trilha", r5);

    const trilha = await trilhaDaOs(empresa.id, os.id);
    confere(trilha?.trechos.length === 1 && trilha.trechos[0].length === 12, "trilha da OS: um trecho com os 12 pontos", trilha?.trechos.map((t) => t.length));
    confere(trilha?.marcos.map((m) => m.tipo).join(",") === "deslocamento,iniciada", "marcos: onde saiu e onde chegou", trilha?.marcos.map((m) => m.tipo));
    confere(trilha?.destino !== null && trilha?.posicao?.modo === "eco", "com o destino e a posição de agora (modo econômico)");

    await executarAcao(tec, os.id, { tipo: "pausar", motivo: "Aguardando peça" });
    confere(!(await emCampo(empresa.id)).some((l) => l.ordemId === os.id), "pausada, sai da lista de quem está em campo");

    console.log("\nProdutividade do mês");
    await executarAcao(tec, os.id, { tipo: "retomar" });
    const itens = await db.query.osChecklistItem.findMany({ where: eq(schema.osChecklistItem.ordemServicoId, os.id) });
    if (itens.length) {
      await db
        .update(schema.osChecklistItem)
        .set({ concluido: true })
        .where(inArray(schema.osChecklistItem.id, itens.map((i) => i.id)));
    }
    await executarAcao(tec, os.id, { tipo: "concluir", resultado: "resolvido", laudo: "Teste." });
    const prod = await produtividade(empresa.id);
    const dele = prod.find((p) => p.tecnico.id === tecnico.id);
    confere(dele?.concluidas === 1 && dele.osPorDia >= 0, "a OS concluída conta para o técnico no mês", dele);
    confere(dele?.mediaExecucaoMin !== undefined, "com a média de tempo em atendimento");
    const inicio = inicioDoMes(new Date("2026-10-01T02:30:00Z"));
    confere(inicio.toISOString() === "2026-09-01T03:00:00.000Z", "às 23h30 de 30/09 em Sergipe o mês ainda é setembro", inicio.toISOString());
  } finally {
    parar();
    if (antesDoOsrm === undefined) delete process.env.OSRM_ATIVO;
    else process.env.OSRM_ATIVO = antesDoOsrm;
    if (criados.os.length) await db.delete(schema.ordemServico).where(inArray(schema.ordemServico.id, criados.os));
    if (criados.usina) await db.delete(schema.usina).where(eq(schema.usina.id, criados.usina));
    if (criados.cliente) await db.delete(schema.cliente).where(eq(schema.cliente.id, criados.cliente));
    if (criados.usuarios.length) await db.delete(schema.usuario).where(inArray(schema.usuario.id, criados.usuarios));
    console.log("\n(dados de teste apagados)");
  }
}

/**
 * Contra o OSRM público de verdade: gera uma rota pelas ruas de Aracaju, joga
 * ruído de GPS e confere que volta colada na rua — e em Sergipe. O teste de
 * "caiu em Sergipe" é o que pega a troca de lat/lon, que não dá erro nenhum.
 */
async function osrmDeVerdade() {
  console.log("\nOSRM público (--osrm)");
  const base = (process.env.OSRM_URL || "https://router.project-osrm.org").replace(/\/$/, "");
  const rota = await fetch(
    `${base}/route/v1/driving/-37.0514,-10.9115;-37.0640,-10.9460?overview=full&geometries=geojson`,
    { headers: { "user-agent": "Selebi/1.0 (teste)" } },
  ).then((r) => r.json() as Promise<{ routes?: { geometry: { coordinates: [number, number][] } }[] }>);
  const linha = rota.routes?.[0]?.geometry.coordinates ?? [];
  confere(linha.length > 10, `rota de referência pelas ruas (${linha.length} pontos)`);
  const passo = Math.max(1, Math.floor(linha.length / 12));
  const amostra = linha.filter((_, i) => i % passo === 0).map(([lon, lat], i) => ({
    latitude: lat + ((i % 3) - 1) * (20 / 111_320),
    longitude: lon + (((i + 1) % 3) - 1) * (20 / 111_320),
    precisao: 15,
    capturadoEm: seg(i * 5),
  }));
  const colado = await casarNasRuas(amostra);
  const pontos = colado?.flat() ?? [];
  confere(pontos.length > amostra.length, `${amostra.length} leituras com ruído viraram ${pontos.length} pontos seguindo a rua`);
  confere(
    pontos.length > 0 && pontos.every((p) => p.latitude > -12 && p.latitude < -9 && p.longitude > -38.5 && p.longitude < -36),
    "o trajeto colado caiu em Sergipe (e não no oceano)",
  );
  // Uma viagem longa (240 leituras): cabe no teto de chamadas e chega ao fim.
  const longa = linha.map(([lon, lat], i) => ({ latitude: lat, longitude: lon, precisao: 10, capturadoEm: seg(i * 5) }));
  const coladaLonga = (await casarNasRuas(longa))?.flat() ?? [];
  const fim = longa.at(-1)!;
  const ultimo = coladaLonga.at(-1);
  confere(
    ultimo !== undefined && distanciaMetros(ultimo.latitude, ultimo.longitude, fim.latitude, fim.longitude) < 300,
    `viagem de ${longa.length} leituras colada até o fim (termina a ${ultimo ? Math.round(distanciaMetros(ultimo.latitude, ultimo.longitude, fim.latitude, fim.longitude)) : "?"} m do destino)`,
  );
}

async function main() {
  regras();
  await banco();
  if (process.argv.includes("--osrm")) await osrmDeVerdade();
  console.log(`\n${total - falhas} de ${total} conferências passaram.`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error("Falhou:", e);
  process.exit(1);
});
