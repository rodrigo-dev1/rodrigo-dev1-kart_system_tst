const assert = require("node:assert/strict");
global.DriverIdentity = require("../driver_identity.js");
const analytics = require("../kart_analytics.js");

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
const pilot = (uid, values) => ({ pilot_uid: uid, ...values });
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
assert.equal(championship.start.pilot_uid, "A");
assert.equal(championship.start.start.deltaOverall, 4);
assert.equal(championship.leadership, null);
assert.equal(championship.regularity.pace.regularity, .5);

console.log("kart analytics: highlights/evolution passed; pilot index candidate count = 6");
