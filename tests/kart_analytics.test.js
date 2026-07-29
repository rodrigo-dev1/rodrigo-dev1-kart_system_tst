const assert = require("node:assert/strict");
global.DriverIdentity = require("../driver_identity.js");
const analytics = require("../kart_analytics.js");

{
    assert.deepEqual(analytics.getPilotStageOvertakes({
        ultrapassagensFeitas: 9, ultrapassagensTomadas: 2, saldoUltrapassagens: 99,
        firstLapOvertakes: { madeOverall: 4 }, start: { deltaOverall: 7 }
    }, { warn: false }), { made: 9, taken: 2, balance: 7 });
    assert.deepEqual(analytics.getPilotStageOvertakes({ start: { deltaOverall: 7 } }, { warn: false }), {
        made: null, taken: null, balance: null
    });
}

{
    const order = ids => ids.map((pilot_uid, index) => ({ pilot_uid, driver_name: pilot_uid, positionOverall: index + 1, isChampionship: !pilot_uid.startsWith("X") }));
    let changes = analytics.calculatePositionChangesBetweenSnapshots(order(["A", "R", "B", "C"]), order(["B", "R", "A", "C"]));
    const mixed = changes.find(x => x.pilot_uid === "R");
    assert.deepEqual({ madeOverall: mixed.madeOverall, takenOverall: mixed.takenOverall, balanceOverall: mixed.balanceOverall }, { madeOverall: 1, takenOverall: 1, balanceOverall: 0 });
    changes = analytics.calculatePositionChangesBetweenSnapshots(order(["X1", "X2", "R", "L"]), order(["R", "X1", "X2", "L"]));
    const rodrigo = changes.find(x => x.pilot_uid === "R");
    assert.deepEqual({ madeOverall: rodrigo.madeOverall, takenOverall: rodrigo.takenOverall, balanceOverall: rodrigo.balanceOverall }, { madeOverall: 2, takenOverall: 0, balanceOverall: 2 });
}

const official = new Set(["A", "B", "C"]);
const pilot = (uid, values) => ({ pilot_uid: uid, driver_name_display: uid, ...values });
const rows = [
    pilot("X", { overtakes:{madeOverall:12}, start:{deltaOverall:7}, bestLap:{time:59,rankOverall:1}, leadership:{lapsLedOverall:12}, pace:{regularity:.1,status:"ok",cleanLaps:10}, qualifying:{positionOverall:1}, result:{positionOverall:1} }),
    pilot("A", { overtakes:{madeOverall:8}, start:{gridPositionOverall:10,firstLapPositionOverall:5,deltaOverall:5}, bestLap:{time:59.5,rankOverall:2}, leadership:{lapsLedOverall:0}, pace:{regularity:.2,status:"ok",cleanLaps:5}, qualifying:{positionOverall:3}, result:{positionOverall:4} }),
    pilot("B", { overtakes:{madeOverall:5}, start:{deltaOverall:1}, bestLap:{time:60,rankOverall:3}, leadership:{lapsLedOverall:0}, pace:{regularity:.3,status:"ok",cleanLaps:5}, qualifying:{positionOverall:4}, result:{positionOverall:5} }),
    pilot("C", { overtakes:{madeOverall:2}, start:{deltaOverall:0}, bestLap:{time:61,rankOverall:4}, leadership:{lapsLedOverall:0}, pace:{regularity:.4,status:"ok",cleanLaps:5}, qualifying:{positionOverall:5}, result:{positionOverall:6} })
];
const highlights = analytics.buildStageHighlights(rows, official);
assert.equal(highlights.overtakes.pilot_uid, "A");
assert.equal(highlights.overtakes.overtakes.madeOverall, 8);
assert.equal(highlights.start.start.deltaOverall, 5);
assert.equal(highlights.bestLap.pilot_uid, "A");
assert.equal(highlights.bestLap.bestLap.rankOverall, 2);
assert.equal(highlights.leadership, null);
assert.equal(highlights.regularity.pilot_uid, "A");
assert.equal(highlights.hatTrick, null);

{
    const snapshot = ids => ids.map((pilot_uid, index) => ({ pilot_uid, positionOverall: index + 1, isChampionship: !pilot_uid.startsWith("X") }));
    const grid = snapshot(["X1", "X2", "X3", "X4", "X5", "X6", "X7", "RODRIGO", "B"]);
    const lap1 = snapshot(["X1", "X2", "X3", "RODRIGO", "X4", "X5", "X6", "X7", "B"]);
    const starts = analytics.calculateStartAnalytics({ gridSnapshot: grid, firstLapSnapshot: lap1, drivers: grid });
    assert.deepEqual(starts.get("RODRIGO"), {
        gridPositionOverall: 8, firstLapPositionOverall: 4, deltaOverall: 4,
        gridPositionChampionship: 1, firstLapPositionChampionship: 1, deltaChampionship: 0,
        gridSource: null
    });
    assert.equal(starts.get("X4").deltaOverall, -1, "externos permanecem no cálculo geral");
    assert.equal(analytics.calculateStartAnalytics({ gridSnapshot: grid, firstLapSnapshot: [], drivers: grid }).get("RODRIGO").deltaOverall, null, "ausência não vira zero");
}

{
    // Regressão do caso real: a ordem documental (Léo em 7º no array) jamais
    // pode sobrescrever a posição oficial P3 gravada pela classificação.
    const classification = [
        { pilot_uid: "X1", posicao_final: 1 }, { pilot_uid: "X2", posicao_final: 2 },
        { pilot_uid: "R", posicao_final: 8 }, { pilot_uid: "X3", posicao_final: 5 },
        { pilot_uid: "X4", posicao_final: 6 }, { pilot_uid: "X5", posicao_final: 7 },
        { pilot_uid: "LEO", posicao_final: 3 }, { pilot_uid: "X6", posicao_final: 4 }
    ];
    const officialDrivers = [{ pilot_uid: "LEO" }, { pilot_uid: "R" }];
    const lap = (pilot_uid, elapsed_time) => ({ pilot_uid, driver_name: pilot_uid, volta: 1, volta_lider: 1, elapsed_time, tempo_volta_segundos: elapsed_time });
    const processed = analytics.processarVoltasEtapa([
        lap("X1", 1), lap("X2", 2), lap("LEO", 4), lap("R", 3),
        lap("X6", 5), lap("X3", 6), lap("X4", 7), lap("X5", 8)
    ], officialDrivers, classification);
    assert.equal(processed.snapshots[0].snapshotType, "grid");
    assert.equal(processed.snapshots[0].label, "LARGADA");
    assert.equal(processed.gridSnapshot.positions.find(row => row.pilot_uid === "LEO").positionOverall, 3);
    assert.deepEqual(processed.startAnalytics.get("LEO"), {
        gridPositionOverall: 3, firstLapPositionOverall: 4, deltaOverall: -1,
        gridPositionChampionship: 1, firstLapPositionChampionship: 2, deltaChampionship: -1,
        gridSource: "classificacao"
    });
    assert.deepEqual(processed.startAnalytics.get("R"), {
        gridPositionOverall: 8, firstLapPositionOverall: 3, deltaOverall: 5,
        gridPositionChampionship: 2, firstLapPositionChampionship: 1, deltaChampionship: 1,
        gridSource: "classificacao"
    });
}

{
    const tied = analytics.buildStageHighlights([
        pilot("B", { result: { positionOverall: 2 }, start: { gridPositionOverall: 8, firstLapPositionOverall: 4, deltaOverall: 4 } }),
        pilot("A", { result: { positionOverall: 1 }, start: { gridPositionOverall: 6, firstLapPositionOverall: 2, deltaOverall: 4 } }),
        pilot("X", { result: { positionOverall: 1 }, start: { gridPositionOverall: 10, firstLapPositionOverall: 1, deltaOverall: 9 } })
    ], new Set(["A", "B"]));
    assert.equal(tied.start.pilot_uid, "A", "desempata pela melhor posição ao final da primeira volta");
}

const lap4ExternalPass = analytics.championshipSnapshotRows({ positions: [
    pilot("A", { positionOverall:4, positionChampionship:1, positionDeltaOverall:0 }),
    pilot("B", { positionOverall:6, positionChampionship:2, positionDeltaOverall:1 }),
    pilot("X", { positionOverall:7, positionChampionship:null, positionDeltaOverall:-1 }),
    pilot("C", { positionOverall:10, positionChampionship:3, positionDeltaOverall:0 })
] }, official);
assert.deepEqual(lap4ExternalPass.map(x => x.pilot_uid), ["A", "B", "C"]);
assert.equal(lap4ExternalPass[1].displayPosition, 6);
assert.equal(lap4ExternalPass[1].displayDelta, 1);

const lap5OfficialPass = analytics.championshipSnapshotRows({ positions: [
    pilot("B", { positionOverall:4, positionChampionship:1, positionDeltaOverall:1 }),
    pilot("A", { positionOverall:5, positionChampionship:2, positionDeltaOverall:-1 }),
    pilot("C", { positionOverall:10, positionChampionship:3, positionDeltaOverall:0 })
] }, official);
assert.deepEqual(lap5OfficialPass.map(x => x.pilot_uid), ["B", "A", "C"]);

const sixOfficial = new Set(["A", "B", "C", "D", "E", "F"]);
assert.equal(analytics.getOfficialMetricCandidates([...rows, pilot("D", {}), pilot("E", {}), pilot("F", {})], sixOfficial).length, 6);

const noMetric = analytics.buildStageHighlights([
    pilot("X", { leadership:{lapsLedOverall:17}, start:{deltaOverall:9}, pace:{regularity:.1,status:"ok",cleanLaps:8} }),
    pilot("A", { leadership:{lapsLedOverall:0}, start:{deltaOverall:0}, pace:{regularity:null,status:"voltas_insuficientes",cleanLaps:0} }),
    pilot("B", { leadership:{lapsLedOverall:0}, start:{deltaOverall:-1}, pace:{regularity:0,status:"voltas_insuficientes",cleanLaps:1} })
], new Set(["A", "B"]));
assert.equal(noMetric.leadership, null);
assert.equal(noMetric.start, null);
assert.equal(noMetric.regularity, null);

const championship = analytics.buildChampionshipHighlights([
    { etapa:1, analytics:[pilot("X", { overtakes:{madeOverall:20}, leadership:{lapsLedOverall:17}, start:{deltaOverall:9} }), pilot("A", { overtakes:{madeOverall:4}, leadership:{lapsLedOverall:0}, start:{deltaOverall:4}, pace:{regularity:.4,status:"ok",cleanLaps:5} })] },
    { etapa:2, analytics:[pilot("A", { overtakes:{madeOverall:3}, leadership:{lapsLedOverall:0}, start:{deltaOverall:-1}, pace:{regularity:.6,status:"ok",cleanLaps:5} }), pilot("B", { overtakes:{madeOverall:5}, leadership:{lapsLedOverall:0}, start:{deltaOverall:3} })] }
], new Set(["A", "B"]));
assert.equal(championship.overtakes.pilot_uid, "A");
assert.equal(championship.overtakes.overtakes.madeOverall, 7);
assert.equal(championship.overtakes.overtakes.takenOverall, 0);
assert.equal(championship.overtakes.overtakes.balanceOverall, 7);

{
    assert.throws(() => analytics.buildChampionshipHighlights([
        { etapa_id: "e1", analytics: [pilot("A", { overtakes: { madeOverall: 1, takenOverall: 0 } })] },
        { etapa_id: "e1", analytics: [pilot("A", { overtakes: { madeOverall: 1, takenOverall: 0 } })] }
    ], new Set(["A"])), /etapa duplicada/);
    assert.throws(() => analytics.buildChampionshipHighlights([
        { etapa_id: "e1", analytics: [pilot("A"), pilot("A")] }
    ], new Set(["A"])), /pilot analytics duplicado/);
}
assert.equal(championship.start.pilot_uid, "A");
assert.equal(championship.start.start.deltaOverall, 4);
assert.equal(championship.leadership, null);
assert.equal(championship.regularity.pace.regularity, .5);
assert.equal(championship.regularity.pilot_uid, "A");
assert.equal(championship.regularity.driver_name_display, "A");
assert.deepEqual(championship.regularity.regularities, [.4, .6]);
assert.equal(championship.regularity.stagesUsed, 2);
assert.equal(championship.regularity.metric, "averageRegularity");

{
    const order = ids => ids.map((pilot_uid, index) => ({ pilot_uid, driver_name: pilot_uid, positionOverall: index + 1, isChampionship: true }));
    const grid = { positions: order(["A", "B", "C", "D"]) };
    const lap1 = { positions: order(["C", "A", "D", "B"]) };
    const total = analytics.calcularUltrapassagens([grid, lap1], false, grid.positions);
    assert.deepEqual(total.map(row => [row.pilot_uid, row.feitas, row.tomadas]), [["A", 0, 1], ["B", 0, 2], ["C", 2, 0], ["D", 1, 0]]);
    assert.deepEqual(analytics.assertOvertakeInvariant(total, "teste múltiplo"), { made: 3, taken: 3 });
}

{
    const previous = [{ pilot_uid:"A", driver_name:"A", positionOverall:3, positionDeltaOverall:2, isChampionship:true }];
    const current = [{ pilot_uid:"A", driver_name:"A", positionOverall:1, positionDeltaOverall:2, isChampionship:true }];
    const rows = analytics.calcularUltrapassagens([{ positions:previous }, { positions:current }], false, previous);
    assert.equal(rows[0].feitas, 0, "positionDelta sem adversário comparável não é ultrapassagem");
}

const realistic = [
    pilot("A", { race:{bestLap:60.516}, qualifying:{positionOverall:4,positionChampionship:1}, start:{deltaOverall:4}, firstLapOvertakes:{madeOverall:5,takenOverall:1,balanceOverall:4}, overtakes:{madeOverall:8}, leadership:{lapsLedOverall:0}, pace:{regularity:.444,cleanLaps:12} }),
    pilot("B", { race:{bestLap:61}, qualifying:{positionChampionship:2}, start:{deltaOverall:1}, firstLapOvertakes:{madeOverall:2}, overtakes:{madeOverall:5}, leadership:{lapsLedOverall:0}, pace:{regularity:.5,cleanLaps:13,status:"ok"} }),
    pilot("C", { race:{bestLap:62}, qualifying:{positionChampionship:3}, start:{deltaOverall:0}, firstLapOvertakes:{madeOverall:0}, overtakes:{madeOverall:1}, leadership:{lapsLedOverall:0}, pace:{regularity:.65,cleanLaps:10,status:"ok"} }),
    pilot("X", { race:{bestLap:59}, qualifying:{positionChampionship:1}, start:{deltaOverall:8}, overtakes:{madeOverall:20}, pace:{regularity:.1,cleanLaps:20,status:"ok"} })
];
const realHighlights = analytics.buildStageHighlights(realistic, official);
assert.equal(realHighlights.bestLap.pilot_uid, "A");
assert.equal(realHighlights.bestLap.race.bestLap, 60.516);
assert.equal(realHighlights.pole.pilot_uid, "A");
assert.equal(realHighlights.overtakes.pilot_uid, "A");
assert.equal(realHighlights.start.pilot_uid, "A");
assert.equal(realHighlights.leadership, null);
assert.equal(realHighlights.regularity.pilot_uid, "A", "legacy regularity without status remains valid");
assert.equal(realHighlights.regularity.pace.regularity, .444);

const championshipReal = analytics.buildChampionshipHighlights([
    { etapa:1, analytics:[realistic[0], pilot("B", { race:{bestLap:60.9}, overtakes:{madeOverall:10}, start:{deltaOverall:3}, pace:{regularity:.42,cleanLaps:10} })] },
    { etapa:2, analytics:[pilot("A", { race:{bestLap:61}, overtakes:{madeOverall:3}, start:{deltaOverall:-1}, pace:{regularity:.5,cleanLaps:12} })] }
], official);
assert.deepEqual(analytics.buildChampionshipHighlights([
    { etapa:1, analytics:[realistic[0], pilot("B", { race:{bestLap:60.9}, overtakes:{madeOverall:10}, start:{deltaOverall:3}, pace:{regularity:.42,cleanLaps:10} })] },
    { etapa:2, analytics:[pilot("A", { race:{bestLap:61}, overtakes:{madeOverall:3}, start:{deltaOverall:-1}, pace:{regularity:.5,cleanLaps:12} })] }
], official), championshipReal, "same analytics produce identical highlights on a second reprocessing");
assert.equal(championshipReal.bestLap.pilot_uid, "A");
assert.equal(championshipReal.overtakes.pilot_uid, "A");
assert.equal(championshipReal.overtakes.overtakes.madeOverall, 11);
assert.equal(championshipReal.start.pilot_uid, "A");
assert.equal(championshipReal.regularity.pilot_uid, "B");
assert.equal(championshipReal.regularity.pace.regularity, .42);

assert.equal(analytics.toNullableNumber(null), null);
assert.equal(analytics.toNullableNumber(""), null);
assert.equal(analytics.toNullableNumber("0"), 0);
assert.equal(analytics.normalizePilotUid(" A "), "A");

console.log("kart analytics: highlights/evolution passed; pilot index candidate count = 6");
