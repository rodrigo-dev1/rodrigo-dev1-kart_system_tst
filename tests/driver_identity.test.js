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
    assert.equal(result.regularidade.find(p => p.driver_id === "2").status, "insufficient_data");
    assert.deepEqual(result.ultrapassagensCampeonato.map(p => p.driver_id).sort(), ["1", "2"]);
});
