const test = require("node:test");
const assert = require("node:assert/strict");
const identity = require("../driver_identity.js");
const analytics = require("../kart_analytics.js");
const integrity = require("../firestore_integrity.js");

test("interrompe ID vazio antes de construir referencia Firestore", () => {
    assert.throws(() => integrity.requireFirestoreId(" ", "etapaId", { etapa: "legada" }), /etapaId obrigatório ausente/);
    assert.equal(integrity.requireFirestoreId(" etapa_3 ", "etapaId"), "etapa_3");
    assert.equal(integrity.canonicalStageNumber("Etapa 3"), 3);
});

test("classificacao filtra membros preservando a ordem da tomada", () => {
    const official = identity.getOfficialStageDriverIds(["A", "B", "C"].map(driver_id => ({ driver_id })));
    const rows = ["X", "B", "Y", "A", "C"].map((driver_id, index) => ({ driver_id, posicao_geral_arquivo: index + 1 }));
    const result = identity.filterStageQualifying(rows, official);
    assert.deepEqual(result.map(row => row.driver_id), ["B", "A", "C"]);
    assert.deepEqual(result.map(row => row.positionOverall), [2, 4, 5]);
    assert.deepEqual(result.map(row => row.positionChampionship), [1, 2, 3]);
});

test("snapshot carrega retardatarios e oficiais ainda sem passagem", () => {
    const official = ["A", "B", "C", "D"].map(driver_id => ({ driver_id, driver_name: driver_id }));
    const laps = [
        { driver_id: "A", volta: 8, volta_lider: 8, elapsed_time: 480 },
        { driver_id: "B", volta: 8, volta_lider: 8, elapsed_time: 482 },
        { driver_id: "C", volta: 7, volta_lider: 8, elapsed_time: 475 },
        { driver_id: "D", volta: 6, volta_lider: 8, elapsed_time: 470 },
        { driver_id: "X", volta: 8, volta_lider: 8, elapsed_time: 481 }
    ];
    const snapshot = analytics.gerarSnapshots(laps, official)[0];
    assert.deepEqual(analytics.filtrarSnapshot(snapshot, new Set(["A", "B", "C", "D"])).map(row => row.driver_id), ["A", "B", "C", "D"]);
    assert.deepEqual(snapshot.positions.filter(row => row.isChampionship).map(row => row.completedLaps), [8, 8, 7, 6]);
});

test("carry-forward mantem piloto e não converte delta isolado em ultrapassagem", () => {
    const official = ["A", "B", "C", "D"].map(driver_id => ({ driver_id }));
    const laps = [
        ...official.map((row, index) => ({ ...row, volta: 4, volta_lider: 4, elapsed_time: 240 + index })),
        { driver_id: "A", volta: 5, volta_lider: 5, elapsed_time: 300 },
        { driver_id: "B", volta: 5, volta_lider: 5, elapsed_time: 301 },
        { driver_id: "C", volta: 5, volta_lider: 5, elapsed_time: 302 }
    ];
    const snapshots = analytics.gerarSnapshots(laps, official);
    const d = snapshots[1].positions.find(row => row.driver_id === "D");
    assert.equal(d.completedLaps, 4);
    assert.equal(snapshots[1].positions.filter(row => row.isChampionship).length, 4);
    const synthetic = analytics.calcularUltrapassagens([
        { positions: [{ driver_id: "A", isChampionship: true, positionChampionship: 4, positionDeltaChampionship: 0 }] },
        { positions: [{ driver_id: "A", isChampionship: true, positionChampionship: 2, positionDeltaChampionship: 2 }] }
    ], true);
    assert.equal(synthetic[0].feitas, 0);
});

test("processamento e idempotente para a mesma entrada", () => {
    const official = ["A", "B"].map(driver_id => ({ driver_id }));
    const laps = official.map((row, index) => ({ ...row, volta: 1, volta_lider: 1, elapsed_time: index + 1, tempo_volta_segundos: 60 }));
    assert.deepEqual(analytics.processarVoltasEtapa(laps, official), analytics.processarVoltasEtapa(laps, official));
});

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
    assert.deepEqual(result.snapshots[0].positions.map(p => p.positionOverall), [1, 2, 3]);
    assert.equal(result.snapshots[0].positions.find(p => p.driver_id === "2").stateSource, "awaiting_first_passage");
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
    assert.deepEqual(filtrados.map(row => identity.getDriverId(row) || identity.normalizeDriverName(identity.getDriverName(row))), ["41938", "rodrigo cruz"]);
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
        { campeonato_id: "camp-a", etapa_id: "e1", result: { positionOverall: 4, positionChampionship: 1, points: 20 }, qualifying: { positionOverall: 3, positionChampionship: 1 } },
        { campeonato_id: "camp-a", etapa_id: "e2", result: { positionOverall: 2, positionChampionship: 2, points: 15 }, qualifying: { positionOverall: 4, positionChampionship: 2 } },
        { campeonato_id: "camp-b", etapa_id: "e1", result: { positionOverall: 1, positionChampionship: 1, points: 10 }, qualifying: { positionOverall: 1, positionChampionship: 1 } }
    ];
    const all = analytics.consolidarPilotAnalytics(rows, { campeonatoId: "camp-a", etapaId: "all" });
    assert.deepEqual(all.kpis.wins, { overall: 0, championship: 1 });
    assert.deepEqual(all.kpis.podiums, { overall: 1, championship: 2 });
    assert.deepEqual(all.kpis.poles, { overall: 0, championship: 1 });
    assert.deepEqual(all.kpis.bestPosition, { overall: 2, championship: 1 });
    assert.equal(all.kpis.races, 2);
    assert.equal(all.kpis.points, 35);
    const stage = analytics.consolidarPilotAnalytics(rows, { campeonatoId: "camp-a", etapaId: "e2" });
    assert.equal(stage.stages.length, 1);
    assert.equal(stage.kpis.points, 15);
    assert.deepEqual(stage.kpis.bestPosition, { overall: 2, championship: 2 });
});

test("posicao zero nunca conta em KPIs nem como melhor colocacao", () => {
    const result = analytics.consolidarPilotAnalytics([
        { result: { positionOverall: 0, positionChampionship: 0 }, qualifying: { positionOverall: 0, positionChampionship: 0 } }
    ]).kpis;
    assert.deepEqual(result.wins, { overall: 0, championship: 0 });
    assert.deepEqual(result.podiums, { overall: 0, championship: 0 });
    assert.deepEqual(result.poles, { overall: 0, championship: 0 });
    assert.deepEqual(result.bestPosition, { overall: null, championship: null });
});

test("pilot_uid independe de kart e RENTAL", () => {
    const names = ["041 - BRENO MANTOVANI - RENTAL", "029 - Breno Mantovani - Rental", "055 - BRENO MANTOVANI"];
    const uids = names.map(driver_name => identity.resolvePilotIdentity({ driver_name }, []).identity.pilot_uid);
    assert.equal(new Set(uids).size, 1);
    assert.equal(identity.normalizeDriverName("041 - [99999] BRENO MANTOVANI - RENTAL"), "breno mantovani");
});

test("driver_id futuro enriquece a identidade sem alterar pilot_uid", () => {
    const first = identity.resolvePilotIdentity({ driver_name: "041 - BRENO MANTOVANI - RENTAL" }, []);
    const later = identity.resolvePilotIdentity({ driver_id: "98765", driver_name: "[98765] BRENO MANTOVANI" }, [first.identity]);
    assert.equal(later.identity.pilot_uid, first.identity.pilot_uid);
    assert.equal(later.identity.driver_id, "98765");
    assert.deepEqual(later.identity.external_ids, ["98765"]);
});

test("mesmo driver_id converge resultado classificacao e volta a volta", () => {
    let registry = [];
    const uids = ["resultado", "classificacao", "volta"].map(source => {
        const resolved = identity.resolvePilotIdentity({ driver_id: "231138", driver_name: source === "volta" ? "050 - [231138] RODRIGO CRUZ - RENTAL" : "RODRIGO CRUZ" }, registry);
        registry = [resolved.identity];
        return resolved.identity.pilot_uid;
    });
    assert.equal(new Set(uids).size, 1);
});

test("nome ambiguo gera warning e nao faz merge automatico", () => {
    const identities = [
        { pilot_uid: "p_one", normalized_name: "joao silva", driver_name_display: "João Silva" },
        { pilot_uid: "p_two", normalized_name: "joao silva", driver_name_display: "João Silva" }
    ];
    const warnings = [];
    const resolved = identity.resolvePilotIdentity({ driver_name: "JOAO SILVA" }, identities, { disambiguator: "stage:row", onWarning: warning => warnings.push(warning) });
    assert.equal(warnings[0].message, "Identidade ambígua");
    assert.notEqual(resolved.identity.pilot_uid, "p_one");
    assert.notEqual(resolved.identity.pilot_uid, "p_two");
});
