const test = require("node:test");
const assert = require("node:assert/strict");
const StageImportV2 = require("../stage_import_v2.js");

const qualifying = [
    [6, "233543", "TALES MOLINA", "029", "1:02.961"],
    [7, "41938", "LEONARDO LEMES", "037", "1:03.329"],
    [8, "231138", "RODRIGO CRUZ", "052", "1:03.662"],
    [9, "3306", "CARLOS DA SILVA", "050", "1:03.670"],
    [10, "51107", "DANILO OLIVEIRA", "002", "1:03.866"]
].map(([positionOverall, driver_id, driver_name, kart_numero, melhor_tempo]) => ({ positionOverall, driver_id, driver_name, kart_numero, melhor_tempo }));

const result = [
    [3, "41938", "LEONARDO LEMES", "037", "1:00.881"],
    [6, "231138", "RODRIGO CRUZ", "052", "1:02.031"],
    [7, "3306", "CARLOS DA SILVA", "050", "1:02.196"],
    [8, "233543", "TALES MOLINA", "029", "1:01.444"],
    [13, "51107", "DANILO OLIVEIRA", "002", "1:02.606"]
].map(([positionOverall, driver_id, driver_name, kart_numero, melhor_tempo]) => ({ positionOverall, driver_id, driver_name, kart_numero, melhor_tempo }));

const laps = result.map(row => ({ driver_name: `${row.kart_numero} - ${row.driver_name} - RENTAL`, kart_numero: row.kart_numero, volta: 1 }));
const built = StageImportV2.buildStageParticipants({ qualifying, result, laps });
const officialPilotUids = built.participants.map(p => p.pilot_uid);
const process = () => StageImportV2.processStage({ qualifying, result, laps, officialPilotUids, scoring: { 1: 20, 2: 17, 3: 15, 4: 13, 5: 11 } });

test("reconcilia Tales nas três fontes em exatamente um pilot_uid", () => {
    const tales = built.participants.filter(p => p.driver_id === "233543");
    assert.equal(tales.length, 1);
    assert.deepEqual(tales[0].sources, { qualifying: true, result: true, laps: true });
    assert.equal(tales[0].pilot_uid, "p_7b1d5dcd99841b81");
});

test("pole usa exclusivamente tomada e melhor volta usa corrida", () => {
    const stage = process();
    const tales = stage.analytics.find(p => p.driver_id === "233543");
    const leonardo = stage.analytics.find(p => p.driver_id === "41938");
    assert.deepEqual(stage.qualifying.map(p => p.driver_id), ["233543", "41938", "231138", "3306", "51107"]);
    assert.deepEqual(stage.result.map(p => p.driver_id), ["41938", "231138", "3306", "233543", "51107"]);
    assert.deepEqual(tales.qualifying, { positionOverall: 6, positionChampionship: 1, bestLap: 62.961, bestLapFormatted: "1:02.961", sourceType: "classificacao", sourceFile: "" });
    assert.deepEqual(tales.race, { positionOverall: 8, positionChampionship: 4, bestLap: 61.444, bestLapFormatted: "1:01.444", sourceType: "resultado_final", sourceFile: "" });
    assert.equal(stage.highlights.pole.driver_id, "233543");
    assert.equal(stage.highlights.pole.qualifying.bestLap, 62.961);
    assert.equal(stage.highlights.bestLap.driver_id, "41938");
    assert.equal(stage.highlights.bestLap.race.bestLap, 60.881);
    assert.notEqual(stage.highlights.pole.qualifying.bestLap, leonardo.race.bestLap);
    assert.deepEqual(tales.scoring, { base: 13, bonusGrid: 1, bonusBestLap: 0, total: 14 });
    assert.deepEqual(leonardo.scoring, { base: 20, bonusGrid: 0, bonusBestLap: 1, total: 21 });
});

test("seleção única é aplicada às três fontes e processamento é idempotente", () => {
    const first = process(), second = process();
    assert.deepEqual(first, second);
    const tales = first.analytics.find(p => p.driver_id === "233543");
    assert.equal(tales.isChampionship, true);
    assert.ok(tales.qualifying && tales.race);
    assert.ok(first.participants.find(p => p.pilot_uid === tales.pilot_uid).sources.laps);
});

test("validação contabiliza pilotos e registros de volta sem confundir as grandezas", () => {
    const validation = StageImportV2.validateStageFiles({ qualifying, result, laps });
    assert.deepEqual({
        compatible: validation.compatible,
        qualifyingDrivers: validation.qualifyingDrivers,
        resultDrivers: validation.resultDrivers,
        lapDrivers: validation.lapDrivers,
        lapRecords: validation.lapRecords,
        conflicts: validation.conflicts
    }, {
        compatible: true,
        qualifyingDrivers: 5,
        resultDrivers: 5,
        lapDrivers: 5,
        lapRecords: 5,
        conflicts: []
    });
    for (const id of ["233543", "41938"]) {
        assert.deepEqual(built.participants.find(p => p.driver_id === id).sources, { qualifying: true, result: true, laps: true });
    }
});

test("participante ausente em qualquer fonte torna o conjunto incompatível", () => {
    const validation = StageImportV2.validateStageFiles({ qualifying, result, laps: laps.slice(1) });
    assert.equal(validation.compatible, false);
    assert.ok(validation.conflicts.some(error => error.code === "PARTICIPANT_SOURCE_MISMATCH"));
});

test("conflito de driver_id bloqueia a etapa", () => {
    const invalidResult = result.map(row => row.driver_id === "233543" ? { ...row, driver_id: "999999" } : row);
    const validation = StageImportV2.validateStageFiles({ qualifying, result: invalidResult, laps });
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some(error => error.code === "DRIVER_ID_CONFLICT"));
});
