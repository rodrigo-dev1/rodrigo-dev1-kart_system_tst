(function (root, factory) {
    const api = factory(typeof require === "function" ? require("./driver_identity.js") : root.DriverIdentity);
    if (typeof module === "object" && module.exports) module.exports = api;
    root.StageImportV2 = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (DriverIdentity) {
    "use strict";

    const TYPES = Object.freeze({ qualifying: "classificacao", result: "resultado_final", laps: "volta_a_volta" });
    const text = value => String(value ?? "").trim();
    const driverId = row => {
        const explicit = DriverIdentity.normalizeDriverId(row?.driver_id || row?.driverId || row?.id_piloto);
        if (explicit) return explicit;
        // Some pandas/browser parser combinations retain the bracketed code only
        // in piloto_original. Identity must be recovered before display-name
        // cleanup removes that token.
        const original = text(row?.piloto_original || row?.driver_name || row?.nome || row?.piloto);
        return DriverIdentity.normalizeDriverId(original.match(/\[\s*(\d+)\s*\]/)?.[1] || "");
    };
    const kart = row => DriverIdentity.normalizeKartNumber(row?.kart_number || row?.kart_numero || row?.kart);
    const name = row => DriverIdentity.cleanDriverDisplayName(row?.driver_name || row?.nome || row?.piloto || row?.piloto_original);
    const normalizedName = row => DriverIdentity.normalizeDriverName(name(row)).toUpperCase();
    const seconds = value => {
        if (value === null || value === undefined || value === "") return null;
        if (typeof value === "number") return Number.isFinite(value) ? value : null;
        const parts = text(value).replace(",", ".").split(":").map(Number);
        if (!parts.every(Number.isFinite)) return null;
        return parts.length === 2 ? Number((parts[0] * 60 + parts[1]).toFixed(3)) : (parts.length === 1 ? parts[0] : null);
    };
    const formatLap = value => {
        const n = seconds(value);
        if (n === null) return "";
        const minutes = Math.floor(n / 60);
        return `${minutes}:${(n - minutes * 60).toFixed(3).padStart(6, "0")}`;
    };
    const overall = row => Number(row?.positionOverall || row?.posicao_geral_arquivo || row?.posicao_final || row?.posicao || row?.pos) || null;

    function sourceObservation(row, sourceType) {
        return { ...row, sourceType, driver_id: driverId(row) || null, driver_name: name(row), normalized_name: normalizedName(row), kart_number: kart(row) };
    }

    function buildStageParticipants({ qualifying = [], result = [], laps = [] }, identities = []) {
        const participants = [];
        const registry = [...identities];
        const conflicts = [];
        const indexes = { uid: new Map(), id: new Map(), nameKart: new Map(), name: new Map() };
        const addIndex = participant => {
            indexes.uid.set(participant.pilot_uid, participant);
            if (participant.driver_id) indexes.id.set(participant.driver_id, participant);
            if (participant.normalized_name) indexes.name.set(participant.normalized_name, participant);
            if (participant.normalized_name && participant.kart_number) indexes.nameKart.set(`${participant.normalized_name}|${participant.kart_number}`, participant);
        };
        const observe = (raw, sourceType) => {
            const observation = sourceObservation(raw, sourceType);
            const uid = text(raw.pilot_uid || raw.pilotUid);
            let participant = (uid && indexes.uid.get(uid)) || (observation.driver_id && indexes.id.get(observation.driver_id));
            participant ||= indexes.nameKart.get(`${observation.normalized_name}|${observation.kart_number}`);
            if (!participant && !observation.kart_number) participant = indexes.name.get(observation.normalized_name);
            if (participant && participant.driver_id && observation.driver_id && participant.driver_id !== observation.driver_id) {
                participant.conflict = true;
                conflicts.push({ code: "DRIVER_ID_CONFLICT", pilot_uid: participant.pilot_uid, sourceType, expected: participant.driver_id, actual: observation.driver_id });
            }
            if (!participant) {
                // Rows already reconciled with the Firestore identity registry must
                // keep that UID. Re-resolving only from driver_id here used to turn
                // a registry UID back into a generated UID and made the selected
                // official disappear from the result payload.
                const resolved = uid
                    ? { identity: DriverIdentity.mergePilotIdentity({ pilot_uid: uid }, observation) }
                    : DriverIdentity.resolvePilotIdentity(observation, registry);
                if (!registry.some(item => item.pilot_uid === resolved.identity.pilot_uid)) registry.push(resolved.identity);
                participant = {
                    pilot_uid: resolved.identity.pilot_uid, driver_id: observation.driver_id || null,
                    normalized_name: observation.normalized_name, display_name: observation.driver_name,
                    kart_number: observation.kart_number, isChampionship: false,
                    sources: { qualifying: false, result: false, laps: false }, observations: {}, conflict: false
                };
                participants.push(participant); addIndex(participant);
            }
            participant.driver_id ||= observation.driver_id;
            participant.kart_number ||= observation.kart_number;
            participant.sources[sourceType] = true;
            if (!participant.observations[sourceType]) participant.observations[sourceType] = [];
            participant.observations[sourceType].push(observation);
            addIndex(participant);
        };
        qualifying.forEach(row => observe(row, "qualifying"));
        result.forEach(row => observe(row, "result"));
        laps.forEach(row => observe(row, "laps"));
        return { participants, conflicts, identities: registry };
    }

    function validateStageFiles(files, metadata = {}) {
        const errors = [], warnings = [];
        for (const key of ["qualifying", "result", "laps"]) if (!Array.isArray(files[key]) || !files[key].length) errors.push({ code: "MISSING_SOURCE", source: key });
        const signatures = [metadata.qualifying, metadata.result, metadata.laps].filter(Boolean);
        for (const field of ["date", "event", "category", "session"]) {
            const values = new Set(signatures.map(item => text(item[field]).toUpperCase()).filter(Boolean));
            if (values.size > 1) errors.push({ code: "METADATA_MISMATCH", field, values: [...values] });
        }
        const built = buildStageParticipants(files);
        errors.push(...built.conflicts);
        const overlap = built.participants.filter(p => p.sources.qualifying && p.sources.result).length;
        if (files.qualifying?.length && files.result?.length && !overlap) errors.push({ code: "NO_PARTICIPANT_OVERLAP" });
        built.participants.filter(p => Object.values(p.sources).filter(Boolean).length !== 3).forEach(p => errors.push({ code: "PARTICIPANT_SOURCE_MISMATCH", pilot_uid: p.pilot_uid, sources: p.sources }));
        const lapDrivers = built.participants.filter(p => p.sources.laps).length;
        return {
            valid: errors.length === 0, compatible: errors.length === 0, errors, warnings,
            participantCount: built.participants.length, overlap,
            qualifyingDrivers: built.participants.filter(p => p.sources.qualifying).length,
            resultDrivers: built.participants.filter(p => p.sources.result).length,
            lapDrivers, lapRecords: Array.isArray(files.laps) ? files.laps.length : 0,
            conflicts: errors
        };
    }

    function processStage({ qualifying = [], result = [], laps = [], officialPilotUids = [], scoring = {}, poleBonus = 1, bestLapBonus = 1 }) {
        const built = buildStageParticipants({ qualifying, result, laps });
        if (built.conflicts.length) throw new Error("Conflito de identidade nos arquivos da etapa");
        const official = new Set(officialPilotUids);
        built.participants.forEach(p => { p.isChampionship = official.has(p.pilot_uid); });
        const rowFor = (participant, source) => participant.observations[source]?.[0] || null;
        const ranked = source => built.participants.filter(p => p.isChampionship && rowFor(p, source)).sort((a, b) => overall(rowFor(a, source)) - overall(rowFor(b, source)));
        const qualifyingRank = ranked("qualifying"), resultRank = ranked("result");
        const analytics = built.participants.map(participant => {
            const q = rowFor(participant, "qualifying"), r = rowFor(participant, "result");
            const qPosition = qualifyingRank.indexOf(participant) + 1, rPosition = resultRank.indexOf(participant) + 1;
            return {
                pilot_uid: participant.pilot_uid, driver_id: participant.driver_id, driver_name: participant.display_name,
                kart_number: participant.kart_number, isChampionship: participant.isChampionship,
                qualifying: q ? { positionOverall: overall(q), positionChampionship: participant.isChampionship ? qPosition : null, bestLap: seconds(q.bestLap ?? q.bestLapSeconds ?? q.melhor_tempo_segundos ?? q.melhor_tempo), bestLapFormatted: formatLap(q.bestLap ?? q.bestLapSeconds ?? q.melhor_tempo_segundos ?? q.melhor_tempo), sourceType: TYPES.qualifying, sourceFile: q.sourceFile || q.arquivo_origem || "" } : null,
                race: r ? { positionOverall: overall(r), positionChampionship: participant.isChampionship ? rPosition : null, bestLap: seconds(r.bestLap ?? r.bestLapSeconds ?? r.melhor_tempo_segundos ?? r.melhor_tempo), bestLapFormatted: formatLap(r.bestLap ?? r.bestLapSeconds ?? r.melhor_tempo_segundos ?? r.melhor_tempo), sourceType: TYPES.result, sourceFile: r.sourceFile || r.arquivo_origem || "" } : null,
                scoring: { base: participant.isChampionship ? Number(scoring[String(rPosition)] || 0) : 0, bonusGrid: 0, bonusBestLap: 0, total: 0 }
            };
        });
        analytics.forEach(item => { if (item.qualifying && item.qualifying.sourceType !== TYPES.qualifying) throw new Error("qualifying.bestLap possui fonte inválida"); });
        const officialAnalytics = analytics.filter(item => item.isChampionship);
        const pole = officialAnalytics.filter(item => item.qualifying?.positionChampionship === 1)[0] || null;
        const bestLap = officialAnalytics.filter(item => item.race?.bestLap !== null).sort((a, b) => a.race.bestLap - b.race.bestLap)[0] || null;
        if (pole) pole.scoring.bonusGrid = Number(poleBonus || 0);
        if (bestLap) bestLap.scoring.bonusBestLap = Number(bestLapBonus || 0);
        officialAnalytics.forEach(item => { item.scoring.total = item.scoring.base + item.scoring.bonusGrid + item.scoring.bonusBestLap; });
        return { participants: built.participants, analytics, qualifying: qualifyingRank.map(p => analytics.find(a => a.pilot_uid === p.pilot_uid)), result: resultRank.map(p => analytics.find(a => a.pilot_uid === p.pilot_uid)), highlights: { pole, bestLap } };
    }

    function validateStageCardinality({ participants = [], officialPilotUids = [] }) {
        const official = new Set((officialPilotUids || []).map(text).filter(Boolean));
        if (official.size !== (officialPilotUids || []).length) throw new Error("pilot_uid oficial vazio ou duplicado");
        const byUid = new Map((participants || []).map(participant => [text(participant.pilot_uid), participant]));
        const sourceLabels = { qualifying: "Classificação", result: "Resultado Final", laps: "Volta a volta" };
        for (const pilotUid of official) {
            const participant = byUid.get(pilotUid);
            const displayName = participant?.display_name || participant?.driver_name || pilotUid;
            for (const source of Object.keys(sourceLabels)) {
                if (!participant?.sources?.[source]) {
                    throw new Error(`Piloto oficial ausente no ${sourceLabels[source]} persistido: ${displayName}`);
                }
            }
        }
        const counts = Object.fromEntries(Object.keys(sourceLabels).map(source => [source, [...official].filter(uid => byUid.get(uid)?.sources?.[source]).length]));
        return { selectedOfficialCount: official.size, officialQualifyingCount: counts.qualifying, officialResultCount: counts.result, officialLapDriverCount: counts.laps };
    }

    function createStageUid(championshipId, date, stageNumber) {
        const slug = text(championshipId).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase();
        if (!slug || !/^\d{4}-\d{2}-\d{2}$/.test(text(date)) || !(Number(stageNumber) > 0)) throw new Error("Metadados inválidos para stage_uid");
        return `${slug}__${date}__etapa_${Number(stageNumber)}`;
    }

    function createPersistenceManifest(stageUid, filenames = {}) {
        if (!text(stageUid)) throw new Error("stage_uid obrigatório");
        const sourceConfig = {
            qualifying: { importId: `${stageUid}__qualifying`, tipoArquivo: TYPES.qualifying, tipoLabel: "Classificação / Tomada" },
            result: { importId: `${stageUid}__result`, tipoArquivo: TYPES.result, tipoLabel: "Resultado Final" },
            laps: { importId: `${stageUid}__laps`, tipoArquivo: TYPES.laps, tipoLabel: "Volta a volta" }
        };
        return {
            stageImportId: stageUid,
            sourceConfig,
            stageSources: {
                qualifying: { importId: sourceConfig.qualifying.importId, backupPath: `backups_importacao/${sourceConfig.qualifying.importId}`, filename: filenames.qualifying || "" },
                result: { importId: sourceConfig.result.importId, backupPath: `backups_importacao/${sourceConfig.result.importId}`, filename: filenames.result || "" },
                lapByLap: { importId: sourceConfig.laps.importId, backupPath: `backups_importacao/${sourceConfig.laps.importId}`, filename: filenames.laps || "" }
            }
        };
    }

    // Firestore limits a document to 1 MiB. This is only a diagnostic estimate
    // (the SDK adds its own encoding overhead), so aggregated documents warn at
    // a deliberately lower threshold.
    function estimateFirestoreDocumentSize(data) {
        const json = JSON.stringify(data ?? null);
        return typeof Blob === "function" ? new Blob([json]).size : Buffer.byteLength(json, "utf8");
    }

    function buildCanonicalSourceDocuments({ qualifying = [], result = [], laps = [], officialPilotUids = [], importIds = {}, stageImportId = "" }) {
        const built = buildStageParticipants({ qualifying, result, laps });
        if (built.conflicts.length) throw new Error("Conflito de identidade nos arquivos da etapa");
        const official = new Set(officialPilotUids);
        const common = participant => ({
            pilot_uid: participant.pilot_uid,
            driver_id: participant.driver_id || null,
            driver_name: participant.display_name,
            kart_number: participant.kart_number || "",
            kart_numero: participant.kart_number || "",
            isChampionship: official.has(participant.pilot_uid),
            stageImportId
        });
        const ranked = (source, rows) => [...rows].sort((a, b) => overall(a) - overall(b));
        const championshipPosition = (row, source) => {
            const eligible = ranked(source, (source === "qualifying" ? qualifying : result).filter(candidate => {
                const match = built.participants.find(p => p.observations[source]?.includes(candidate));
                return match && official.has(match.pilot_uid);
            }));
            return eligible.indexOf(row) + 1 || null;
        };
        const documents = { classificacao: [], pilotos_resultado: [], volta_a_volta_pilotos: [] };
        built.participants.forEach(participant => {
            const q = participant.observations.qualifying?.[0];
            const r = participant.observations.result?.[0];
            if (q) documents.classificacao.push({ ...q, ...common(participant), positionOverall: overall(q), positionChampionship: official.has(participant.pilot_uid) ? championshipPosition(q, "qualifying") : null, bestLap: seconds(q.bestLap ?? q.melhor_tempo_segundos ?? q.melhor_tempo), bestLapFormatted: formatLap(q.bestLap ?? q.melhor_tempo_segundos ?? q.melhor_tempo), importId: importIds.qualifying || "", idImportacao: importIds.qualifying || "" });
            if (r) documents.pilotos_resultado.push({ ...r, ...common(participant), positionOverall: overall(r), positionChampionship: official.has(participant.pilot_uid) ? championshipPosition(r, "result") : null, laps: Number(r.laps ?? r.voltas ?? 0), totalTime: r.totalTime ?? r.tempo_total ?? null, bestLap: seconds(r.bestLap ?? r.melhor_tempo_segundos ?? r.melhor_tempo), importId: importIds.result || "", idImportacao: importIds.result || "" });
            const pilotLaps = participant.observations.laps || [];
            if (pilotLaps.length) documents.volta_a_volta_pilotos.push({ ...common(participant), laps: pilotLaps, lapCount: pilotLaps.length, importId: importIds.laps || "", idImportacao: importIds.laps || "" });
        });
        return documents;
    }

    // Convert reconciled data back to the shapes consumed by the proven legacy
    // savers. V2 owns orchestration only; Firestore readers keep one contract.
    function buildLegacySavePayloads({ qualifying = [], result = [], laps = [], officialPilotUids = [], scoring = {}, poleBonus = 1, bestLapBonus = 1 }) {
        const processed = processStage({ qualifying, result, laps, officialPilotUids, scoring, poleBonus, bestLapBonus });
        const official = new Set(officialPilotUids);
        const analytics = new Map(processed.analytics.map(row => [row.pilot_uid, row]));
        const adapt = (participant, source) => {
            const raw = participant.observations[source]?.[0];
            if (!raw || !official.has(participant.pilot_uid)) return null;
            const analytic = analytics.get(participant.pilot_uid);
            const values = source === "qualifying" ? analytic.qualifying : analytic.race;
            return { ...raw, pilot_uid: participant.pilot_uid, driver_id: participant.driver_id || "", id_piloto: participant.driver_id || "", driver_name: participant.display_name, kart_numero: participant.kart_number || raw.kart_numero || "", posicao_final: values.positionOverall, posicao_geral_arquivo: values.positionOverall, posicao_final2: values.positionChampionship, posCampeonato: values.positionChampionship, pontos: source === "result" ? analytic.scoring.base : analytic.scoring.bonusGrid, melhor_tempo: values.bestLapFormatted || raw.melhor_tempo || "", melhor_tempo_segundos: values.bestLap, melhor_tempo_ponto: source === "result" ? analytic.scoring.bonusBestLap : analytic.scoring.bonusGrid };
        };
        const voltaAVolta = processed.participants.filter(p => official.has(p.pilot_uid)).map(participant => {
            const pilotLaps = participant.observations.laps || [];
            const validTimes = pilotLaps.map(lap => seconds(lap.tempo_volta_segundos ?? lap.tempo_volta ?? lap.tempo)).filter(value => value !== null);
            const best = validTimes.length ? Math.min(...validTimes) : null;
            return { pilot_uid: participant.pilot_uid, driver_id: participant.driver_id || "", id_piloto: participant.driver_id || "", driver_name: participant.display_name, kart_numero: participant.kart_number || "", classe: pilotLaps[0]?.classe || "", voltas: pilotLaps.length, melhor_tempo_segundos: best, melhor_tempo: best === null ? "" : formatLap(best) };
        });
        return { classificacao: processed.participants.map(p => adapt(p, "qualifying")).filter(Boolean), resultado: processed.participants.map(p => adapt(p, "result")).filter(Boolean), voltaAVolta, processed };
    }

    return { TYPES, seconds, formatLap, buildStageParticipants, validateStageFiles, validateStageCardinality, processStage, createStageUid, createPersistenceManifest, estimateFirestoreDocumentSize, buildCanonicalSourceDocuments, buildLegacySavePayloads };
}));
