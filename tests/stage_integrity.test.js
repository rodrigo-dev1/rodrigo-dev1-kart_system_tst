const test = require("node:test");
const assert = require("node:assert/strict");
const StageIntegrity = require("../stage_integrity.js");

const scoring = { "1": 20, 2: 17, "3": 15, 4: 13, "5": 11 };

test("stageKey isola fontes e rejeita contaminação", () => {
    const stage = { campeonatoId: "kart_dos_amigos", etapa: 2, dataCorrida: "2026-07-08" };
    const source = tipo => ({ campeonato_id: "kart_dos_amigos", etapa: 2, dataCorrida: "2026-07-08", idImportacao: tipo, nomeArquivo: `${tipo}.html` });
    assert.equal(StageIntegrity.validateStageSources(stage, { resultadoFinal: source("resultado"), classificacao: source("classificacao"), voltaAVolta: source("voltas") }, { requireAll: true }), "kart_dos_amigos|2|2026-07-08");
    assert.throws(() => StageIntegrity.validateStageSources(stage, { resultadoFinal: source("resultado"), classificacao: { ...source("classificacao"), etapa: 1 }, voltaAVolta: source("voltas") }, { requireAll: true }), /outra etapa/);
});

test("etapas mantêm ordem e pontuação independentes", () => {
    const official = new Set(["A", "B", "C"]);
    const process = order => StageIntegrity.applyChampionshipScoring(StageIntegrity.buildChampionshipResult(order.map((pilot_uid, index) => ({ pilot_uid, positionOverall: index + 1 })), official), scoring);
    assert.deepEqual(process(["A", "B", "C"]).map(x => [x.pilot_uid, x.positionChampionship, x.pontos]), [["A", 1, 20], ["B", 2, 17], ["C", 3, 15]]);
    assert.deepEqual(process(["C", "A", "B"]).map(x => [x.pilot_uid, x.positionChampionship, x.pontos]), [["C", 1, 20], ["A", 2, 17], ["B", 3, 15]]);
    const five = StageIntegrity.buildChampionshipResult(["A", "B", "C", "D", "E"].map((pilot_uid, index) => ({ pilot_uid, positionOverall: index + 1 })), new Set(["A", "B", "C", "D", "E"]));
    assert.deepEqual(StageIntegrity.applyChampionshipScoring(five, scoring).map(x => x.pontos), [20, 17, 15, 13, 11]);
});
