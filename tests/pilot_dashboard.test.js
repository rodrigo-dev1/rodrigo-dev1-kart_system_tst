const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = {
    window: {},
    formatarDataBR: value => value,
    DriverIdentity: {
        getDriverId: () => "driver",
        getPilotUid: () => "pilot",
        getDriverDisplayName: () => "Piloto"
    },
    KartAnalytics: require("../kart_analytics.js")
};
vm.runInNewContext(fs.readFileSync("pilot_dashboard.js", "utf8"), context);

function analytics(overrides = {}) {
    return {
        etapa: 2,
        dataCorrida: "2026-07-08",
        qualifying: { positionOverall: 8, positionChampionship: 3 },
        result: { positionOverall: 4, positionChampionship: 2, points: 99 },
        finish: { deltaOverall: 4, deltaChampionship: 1 },
        start: { gridPositionOverall: 8, firstLapPositionOverall: 4, deltaOverall: 4 },
        scoring: { total: 11 },
        race: { bestLap: 62.351, bestLapRankOverall: 3 },
        pace: { pace: 63.574, regularity: 0.937 },
        overtakes: { madeOverall: 6, takenOverall: 2, balanceOverall: 4 },
        ...overrides
    };
}

test("resumo usa analytics persistidos para ganho de posições e métricas", () => {
    const html = context.window.renderPilotStageSummary(analytics());
    assert.match(html, /P8[\s\S]*P4[\s\S]*▲ \+4 posições/);
    assert.match(html, /P3[\s\S]*P2[\s\S]*▲ \+1 posição/);
    assert.match(html, /11 pts/);
    assert.match(html, /1:02\.351/);
    assert.match(html, /P3 geral/);
    assert.match(html, /±0\.937s/);
    assert.match(html, /\+6 \/ -2/);
});

test("resumo diferencia perda, posição mantida e ausência de dados", () => {
    const html = context.window.renderPilotStageSummary(analytics({
        qualifying: { positionOverall: 2, positionChampionship: 4 },
        result: { positionOverall: 5, positionChampionship: 4 },
        finish: { deltaOverall: -3, deltaChampionship: 0 },
        start: {}, scoring: {}, race: {}, pace: {}, overtakes: {}
    }));
    assert.match(html, /▼ -3 posições/);
    assert.match(html, /= 0 posições/);
    assert.doesNotMatch(html, /undefined|NaN|P0/);
});
