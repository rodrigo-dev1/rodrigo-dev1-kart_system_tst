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

test("preserva 30 participantes mas resultado e destaques contêm somente os 5 oficiais", () => {
    const external = Array.from({ length: 25 }, (_, index) => ({
        positionOverall: index === 0 ? 1 : index + 14,
        driver_id: `ext-${index}`,
        driver_name: index === 0 ? "GABRIEL FERREIRA" : `EXTERNO ${index}`,
        kart_numero: String(100 + index),
        melhor_tempo: index === 0 ? "1:00.500" : "1:04.000"
    }));
    const allResult = [...external, ...result].sort((a, b) => a.positionOverall - b.positionOverall);
    const allQualifying = [
        { ...external[0], positionOverall: 1, melhor_tempo: "1:00.000" },
        ...external.slice(1).map((row, index) => ({ ...row, positionOverall: index + 2 })),
        ...qualifying
    ];
    const allLaps = [...allResult].map(row => ({ driver_id: row.driver_id, driver_name: row.driver_name, kart_numero: row.kart_numero, volta: 1 }));
    const allBuilt = StageImportV2.buildStageParticipants({ qualifying: allQualifying, result: allResult, laps: allLaps });
    const selected = new Set(["233543", "41938", "231138", "3306", "51107"]);
    const officialUids = allBuilt.participants.filter(p => selected.has(p.driver_id)).map(p => p.pilot_uid);
    const stage = StageImportV2.processStage({ qualifying: allQualifying, result: allResult, laps: allLaps, officialPilotUids: officialUids });

    assert.equal(stage.participants.length, 30);
    assert.equal(stage.participants.filter(p => p.isChampionship).length, 5);
    assert.equal(stage.participants.filter(p => !p.isChampionship).length, 25);
    assert.equal(stage.result.length, 5);
    assert.deepEqual(stage.result.map(p => p.driver_name), ["LEONARDO LEMES", "RODRIGO CRUZ", "CARLOS DA SILVA", "TALES MOLINA", "DANILO OLIVEIRA"]);
    assert.equal(stage.result[0].race.positionOverall, 3);
    assert.equal(stage.highlights.pole.driver_name, "TALES MOLINA");
    assert.equal(stage.highlights.bestLap.driver_name, "LEONARDO LEMES");
    assert.equal(stage.analytics.find(p => p.driver_name === "GABRIEL FERREIRA").isChampionship, false);
});

test("manifesto V2 cria três import IDs independentes e fontes recuperáveis", () => {
    const manifest = StageImportV2.createPersistenceManifest("kart__2026-08-16__etapa_3", {
        qualifying: "tomada.html", result: "resultado.html", laps: "voltas.html"
    });
    assert.equal(new Set(Object.values(manifest.sourceConfig).map(source => source.importId)).size, 3);
    assert.deepEqual(Object.values(manifest.sourceConfig).map(source => source.tipoArquivo), ["classificacao", "resultado_final", "volta_a_volta"]);
    assert.equal(manifest.stageSources.lapByLap.importId, "kart__2026-08-16__etapa_3__laps");
    assert.equal(manifest.stageSources.lapByLap.backupPath, "backups_importacao/kart__2026-08-16__etapa_3__laps");
});

test("persistência canônica distribui 441 voltas em 30 documentos determinísticos", () => {
    const drivers = Array.from({ length: 30 }, (_, i) => ({ driver_id: `D${i}`, driver_name: `PILOTO ${i}`, kart_numero: String(i + 1), positionOverall: i + 1, melhor_tempo: "1:01.000" }));
    const lapRows = [];
    drivers.forEach((driver, driverIndex) => {
        const count = driverIndex < 21 ? 15 : 14; // 21*15 + 9*14 = 441
        for (let lap = 1; lap <= count; lap += 1) lapRows.push({ ...driver, volta: lap, lap, tempo: 61 + driverIndex / 100, positionOverall: driverIndex + 1 });
    });
    const participants = StageImportV2.buildStageParticipants({ qualifying: drivers, result: drivers, laps: lapRows }).participants;
    const official = participants.slice(0, 5).map(p => p.pilot_uid);
    const docs = StageImportV2.buildCanonicalSourceDocuments({ qualifying: drivers, result: drivers, laps: lapRows, officialPilotUids: official, stageImportId: "stage-3", importIds: { qualifying: "q", result: "r", laps: "l" } });
    assert.equal(docs.classificacao.length, 30);
    assert.equal(docs.pilotos_resultado.length, 30);
    assert.equal(docs.volta_a_volta_pilotos.length, 30);
    assert.equal(docs.volta_a_volta_pilotos.reduce((sum, doc) => sum + doc.laps.length, 0), 441);
    assert.equal(docs.volta_a_volta_pilotos.filter(doc => doc.isChampionship).length, 5);
    assert.ok(Math.max(...docs.volta_a_volta_pilotos.map(StageImportV2.estimateFirestoreDocumentSize)) < 750 * 1024);
    assert.equal(new Set(docs.volta_a_volta_pilotos.map(doc => doc.pilot_uid)).size, 30);
});

test("recupera driver_id de piloto_original antes de reconciliar identidade", () => {
    const files = {
        qualifying: [{ piloto_original: "[233543] TALES MOLINA", driver_name: "TALES MOLINA", kart_numero: "029" }],
        result: [{ driver_id: "233543", driver_name: "TALES MOLINA", kart_numero: "029" }],
        laps: [{ driver_id: "233543", driver_name: "TALES MOLINA", kart_numero: "029", volta: 1 }]
    };
    const participant = StageImportV2.buildStageParticipants(files).participants[0];
    assert.equal(participant.driver_id, "233543");
    assert.deepEqual(participant.sources, { qualifying: true, result: true, laps: true });
});

test("adapter V2 restaura os payloads dos três savers legados", () => {
    const lapRows = result.flatMap(row => [1, 2].map(volta => ({ ...row, volta, tempo_volta: volta === 1 ? "1:03.000" : "1:02.000" })));
    const payloads = StageImportV2.buildLegacySavePayloads({ qualifying, result, laps: lapRows, officialPilotUids, scoring: { 1: 20, 2: 17, 3: 15, 4: 13, 5: 11 } });
    assert.equal(payloads.classificacao.length, 5);
    assert.equal(payloads.resultado.length, 5);
    assert.equal(payloads.voltaAVolta.length, 5);
    assert.equal(payloads.classificacao[0].driver_id, "233543");
    assert.equal(payloads.classificacao[0].melhor_tempo, "1:02.961");
    assert.equal(payloads.resultado.find(p => p.driver_id === "41938").pontos, 20);
    assert.equal(payloads.voltaAVolta[0].voltas, 2);
    assert.equal(payloads.voltaAVolta[0].melhor_tempo, "1:02.000");
});
