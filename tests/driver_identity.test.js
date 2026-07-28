const test = require("node:test");
const assert = require("node:assert/strict");
const identity = require("../driver_identity.js");
const analytics = require("../kart_analytics.js");

test("normaliza formatos equivalentes de driver_id", () => {
    for (const value of [41938, "41938", "[41938]", " 41938 "]) {
        assert.equal(identity.normalizeDriverId(value), "41938");
    }
});

test("le campos reais de identidade sem confundir kart_numero", () => {
    assert.equal(identity.getDriverId({ driver_id: "[41938]" }), "41938");
    assert.equal(identity.getDriverId({ driverId: 41938 }), "41938");
    assert.equal(identity.getDriverId({ id_piloto: "41938" }), "41938");
    assert.equal(identity.getDriverId({ idPiloto: " 41938 " }), "41938");
    assert.equal(identity.getDriverId({ kart_numero: "034" }), "");
});

test("resultado da etapa define a intersecao oficial dos snapshots", () => {
    const resultado = [{ id_piloto: "41938", driver_name: "LEONARDO LEMES" }, { driver_id: "[123]", driver_name: "BRENO" }];
    const oficiais = identity.getStageChampionshipDrivers(resultado);
    const voltas = [
        { driver_id: 41938, driver_name: "LEONARDO LEMES", volta: 1, volta_lider: 1, elapsed_time: 1, tempo_volta_segundos: 60 },
        { driverId: "123", driver_name: "BRENO", volta: 1, volta_lider: 1, elapsed_time: 2, tempo_volta_segundos: 60 },
        { driver_id: "999", driver_name: "EXTERNO", volta: 1, volta_lider: 1, elapsed_time: 3, tempo_volta_segundos: 60 }
    ];
    const snapshot = analytics.gerarSnapshots(voltas, [...oficiais.ids])[0].positions;
    assert.deepEqual(snapshot.filter(p => p.isChampionship).map(p => p.driver_id), ["41938", "123"]);
    assert.equal(snapshot.find(p => p.driver_id === "999").positionOverall, 3);
    assert.deepEqual(identity.compareStageDriverIds(resultado, snapshot, snapshot.filter(p => p.isChampionship)), {
        expectedCount: 2, lapCount: 3, expectedInLapCount: 2, actualCount: 2,
        expected: ["41938", "123"], missing: [], unexpected: []
    });
});

test("usa exatamente o resultado exibido quando a subcollection antiga esta parcial", () => {
    const exibidos = Array.from({ length: 11 }, (_, index) => ({ driver_id: String(index + 1), driver_name: `P${index + 1}` }));
    const subcollectionParcial = exibidos.slice(0, 6);
    const rows = identity.getStageReferenceRows({ dashboardResumo: { corrida: exibidos } }, subcollectionParcial, []);
    assert.equal(rows.length, 11);
    assert.deepEqual([...identity.getStageChampionshipDrivers(rows).ids], exibidos.map(identity.getDriverId));
});

test("ultrapassagens mantem participantes oficiais com zero", () => {
    const snapshots = [{ positions: [{ driver_id: "1", driver_name: "A", isChampionship: true, positionDeltaChampionship: 0, positionDeltaOverall: 0 }] }];
    assert.deepEqual(analytics.calcularUltrapassagens(snapshots, true), [{ driver_id: "1", driver_name: "A", isChampionship: true, feitas: 0, tomadas: 0, saldo: 0 }]);
});

test("canonicaliza cabecalho sem driver_id pelo resultado final", () => {
    const result = [{ driver_id: "XYZ", driver_name: "BRENO MANTOVANI", kart_numero: "041" }];
    const map = identity.createStageDriverMap(result);
    const resolution = identity.resolveStageLapParticipant({ driver_name: "BRENO MANTOVANI", kart_numero: 41 }, map);
    assert.equal(resolution.resolved.driverId, "XYZ");
    assert.equal(resolution.resolution, "unique_stage_name");
});

test("analytics preserva corrida completa e oficiais sem metrica ou ultrapassagem", () => {
    const official = [{ driver_id: "1", driver_name: "OFICIAL COM VOLTA", isChampionship: true }, { driver_id: "2", driver_name: "OFICIAL SEM VOLTA", isChampionship: true }];
    const laps = [{ driver_id: "1", driver_name: "OFICIAL COM VOLTA", isChampionship: true, volta: 1, volta_lider: 1, elapsed_time: 2, tempo_volta_segundos: 60 }, { driver_id: "9", driver_name: "EXTERNO", isChampionship: false, volta: 1, volta_lider: 1, elapsed_time: 1, tempo_volta_segundos: 59 }];
    const result = analytics.processarVoltasEtapa(laps, official);
    assert.deepEqual(result.snapshots[0].positions.map(p => p.positionOverall), [1, 2]);
    assert.equal(result.regularidade.find(p => p.driver_id === "2").status, "voltas_insuficientes");
    assert.deepEqual(result.ultrapassagensCampeonato.map(p => p.driver_id).sort(), ["1", "2"]);
});

test("limpa kart, id e classe RENTAL apenas na apresentacao", () => {
    const casos = [
        ["034 - LEONARDO LEMES - RENTAL", "LEONARDO LEMES"],
        ["050 - [231138] RODRIGO CRUZ - RENTAL", "RODRIGO CRUZ"],
        ["[4196] JÚLIO CEZAR", "JÚLIO CEZAR"],
        ["008 - JÚLIO CEZAR - RENTAL -", "JÚLIO CEZAR"]
    ];
    for (const [entrada, esperado] of casos) {
        assert.equal(identity.cleanDriverDisplayName(entrada), esperado);
    }
});

test("nome curto usa no maximo duas palavras e aceita campos legados", () => {
    assert.equal(identity.getDriverShortDisplayName({ name: "034 - CARLOS EDUARDO DA SILVA - RENTAL" }), "CARLOS EDUARDO");
    assert.equal(identity.getDriverDisplayName({ piloto_original: "[41938] LEONARDO LEMES" }), "LEONARDO LEMES");
});

test("filtro central prioriza driver_id e usa nome apenas quando o ID esta ausente", () => {
    const oficiais = identity.getStageChampionshipDrivers([
        { driver_id: "41938", driver_name: "LEONARDO LEMES" },
        { driver_id: "231138", driver_name: "RODRIGO CRUZ" }
    ]);
    const rows = [
        { driver_id: "41938", driver_name: "NOME IRRELEVANTE" },
        { driver_id: "999", driver_name: "RODRIGO CRUZ" },
        { driver_name: "050 - [231138] RODRIGO CRUZ - RENTAL" },
        { driver_id: "888", driver_name: "EXTERNO" }
    ];
    const filtrados = identity.filterStageChampionshipDrivers(rows, oficiais);
    assert.deepEqual(filtrados.map(row => identity.getDriverId(row) || identity.normalizeDriverName(identity.getDriverName(row))), ["41938", "RODRIGO CRUZ"]);
});

test("reconciliacao mantem exatamente todos os pilotos do resultado", () => {
    const resultado = [
        { driver_id: "1", driver_name: "COM ANALYTICS" },
        { driver_id: "2", driver_name: "SEM ANALYTICS" }
    ];
    const oficiais = identity.getStageChampionshipDrivers(resultado);
    const rows = [{ driver_id: "1", regularidade: 0.1 }, { driver_id: "9", regularidade: 0.2 }];
    const reconciliados = identity.reconcileStageChampionshipDrivers(rows, oficiais, driver => ({ ...driver, status: "insufficient_data" }));
    assert.deepEqual(reconciliados.map(identity.getDriverId), ["1", "2"]);
    assert.equal(reconciliados[1].status, "insufficient_data");
    assert.deepEqual(identity.compareDriverIdSets(resultado, reconciliados), {
        expectedCount: 2, actualCount: 2, expected: ["1", "2"], actual: ["1", "2"], missing: [], extra: []
    });
});

test("filtro da evolucao remove externos e reconstroi posicoes relativas", () => {
    const snapshot = { positions: ["A", "X", "B", "Y", "C"].map((driver_id, index) => ({ driver_id, positionOverall: index + 1 })) };
    const geral = analytics.filtrarSnapshot(snapshot, new Set(["A", "B", "C"]), "geral");
    const campeonato = analytics.filtrarSnapshot(snapshot, new Set(["A", "B", "C"]), "campeonato");
    assert.deepEqual(geral.map(p => p.driver_id), ["A", "X", "B", "Y", "C"]);
    assert.deepEqual(campeonato.map(p => p.driver_id), ["A", "B", "C"]);
    assert.deepEqual(campeonato.map(p => p.positionChampionship), [1, 2, 3]);
});

test("regularidade ignora volta 1 e joker extremamente rapido", () => {
    const times = [54.930, 50.276, 50.803, 49.518, 48.976, 49.152, 31.314, 49.483];
    const result = analytics.calcularRegularidade(times.map((tempo_volta_segundos, index) => ({
        driver_id: "A", driver_name: "PILOTO A", volta: index + 1, tempo_volta_segundos
    }))).items[0];
    assert.equal(result.status, "ok");
    assert.equal(result.bestLapValid, 48.976);
    assert.equal(result.laps.find(l => l.volta === 7).classification, "joker_lap");
    assert.equal(result.laps.find(l => l.volta === 7).validForRegularity, false);
    assert.ok(result.cleanLapsCount >= 2);
    assert.ok(result.pace > 48 && result.pace < 51);
    assert.ok(result.regularidade > 0);
});

test("dashboard do piloto consolida campeonato e filtra etapa especifica", () => {
    const rows = [
        { campeonato_id: "camp-a", etapa_id: "e1", result: { points: 20 }, achievements: { win: true, podium: true, pole: true } },
        { campeonato_id: "camp-a", etapa_id: "e2", result: { points: 15 }, achievements: { podium: true } },
        { campeonato_id: "camp-b", etapa_id: "e1", result: { points: 10 }, achievements: {} }
    ];
    const all = analytics.consolidarPilotAnalytics(rows, { campeonatoId: "camp-a", etapaId: "all" });
    assert.deepEqual(all.kpis, { races: 2, wins: 1, podiums: 2, poles: 1, points: 35, titles: 0 });
    const stage = analytics.consolidarPilotAnalytics(rows, { campeonatoId: "camp-a", etapaId: "e2" });
    assert.equal(stage.stages.length, 1);
    assert.equal(stage.kpis.points, 15);
});
