(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    root.StageIntegrity = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const text = value => String(value ?? "").trim();
    const stageDate = value => text(value).slice(0, 10);
    const stageNumber = value => {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : null;
    };

    function createStageKey(campeonatoId, etapa, dataCorrida) {
        const championship = text(campeonatoId);
        const number = stageNumber(etapa);
        const date = stageDate(dataCorrida);
        if (!championship || !number || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            throw new Error("Etapa sem campeonato_id, etapa ou dataCorrida válidos");
        }
        return `${championship}|${number}|${date}`;
    }

    function sourceStageKey(source) {
        return createStageKey(source?.campeonato_id || source?.campeonatoId, source?.etapa, source?.dataCorrida);
    }

    function validateStageSources(stage, sources, { requireAll = false } = {}) {
        const stageKey = createStageKey(stage.campeonatoId || stage.campeonato_id, stage.etapa, stage.dataCorrida);
        const names = ["resultadoFinal", "classificacao", "voltaAVolta"];
        const debug = { campeonatoId: stage.campeonatoId || stage.campeonato_id, etapa: stageNumber(stage.etapa), dataCorrida: stageDate(stage.dataCorrida) };
        names.forEach(name => {
            const source = sources?.[name] || null;
            debug[name] = source ? {
                idImportacao: source.idImportacao || "", etapa: source.etapa,
                dataCorrida: source.dataCorrida, nomeArquivo: source.nomeArquivo || ""
            } : null;
            if (!source && requireAll) throw new Error(`[Kart/StageSources] fonte obrigatória ausente: ${name}`);
            if (source && sourceStageKey(source) !== stageKey) {
                throw new Error(`[Kart/StageSources] ${name} pertence a outra etapa`);
            }
        });
        console.debug("[Kart/StageSources]", debug);
        return stageKey;
    }

    function positionOverall(row) {
        for (const value of [row?.result?.positionOverall, row?.positionOverall, row?.posicao_geral_arquivo, row?.posicao_final, row?.posicao, row?.pos]) {
            const number = Number(value);
            if (Number.isFinite(number) && number > 0) return number;
        }
        return Number.MAX_SAFE_INTEGER;
    }

    function buildChampionshipResult(resultAll, officialPilotUids) {
        const official = officialPilotUids instanceof Set ? officialPilotUids : new Set(officialPilotUids || []);
        return [...(resultAll || [])]
            .sort((a, b) => positionOverall(a) - positionOverall(b))
            .filter(row => official.has(text(row.pilot_uid || row.pilotUid)))
            .map((row, index) => ({
                ...row,
                positionOverall: positionOverall(row),
                positionChampionship: index + 1,
                posicao_final2: index + 1,
                posCampeonato: index + 1
            }));
    }

    function normalizeScoring(scoringConfig) {
        const source = scoringConfig?.positions || scoringConfig?.pontos || scoringConfig || {};
        return Object.fromEntries(Object.entries(source).map(([position, points]) => [String(Number(position)), Number(points)]));
    }

    function getPointsForChampionshipPosition(scoringConfig, positionChampionship) {
        const normalized = normalizeScoring(scoringConfig);
        const positionKey = String(Number(positionChampionship));
        const hasRule = Object.prototype.hasOwnProperty.call(normalized, positionKey);
        if (!hasRule) {
            console.warn("[Kart/Scoring] regra inexistente", { positionChampionship, positionKey });
            return 0;
        }
        return Number.isFinite(normalized[positionKey]) ? normalized[positionKey] : 0;
    }

    function applyChampionshipScoring(rows, scoringConfig) {
        return (rows || []).map(row => ({ ...row, pontos: getPointsForChampionshipPosition(scoringConfig, row.positionChampionship) }));
    }

    function validateScoringBeforePersist(rows, scoringConfig) {
        const configuredPositivePositions = Object.values(normalizeScoring(scoringConfig)).filter(points => points > 0).length;
        const positivePilots = (rows || []).filter(row => Number(row.pontos) > 0).length;
        if (configuredPositivePositions > 1 && rows.length > 1 && positivePilots === 1) {
            const error = new Error("[Kart/Scoring] processamento suspeito: somente um piloto recebeu pontos");
            console.error(error.message, { officialCount: rows.length, positivePilots });
            throw error;
        }
        return true;
    }

    return { createStageKey, validateStageSources, buildChampionshipResult, getPointsForChampionshipPosition, applyChampionshipScoring, validateScoringBeforePersist };
}));
