(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    root.KartAnalytics = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    // v18: o ledger pairwise exige o grid completo (inclusive externos).
    // Documentos anteriores podiam comparar a volta 1 com um grid parcial.
    const VERSION = 18;
    const MIN_CLEAN_LAPS = 2;
    const num = value => {
        if (value === null || value === undefined || value === "") return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    };
    const normalizePilotUid = value => String(value ?? "").trim();
    const pick = (...values) => values.find(value => value !== null && value !== undefined && value !== "");
    const invalidStatuses = new Set(["invalid", "insufficient", "error", "voltas_insuficientes"]);
    const regularityIsValid = pace => {
        const status = String(pace?.status ?? "").trim().toLowerCase();
        return num(pace?.regularity) >= 0 && num(pace?.cleanLaps) >= MIN_CLEAN_LAPS && !invalidStatuses.has(status);
    };

    /** Canonical read adapter for the persisted per-stage overtake metric.
     * Missing values remain missing: position delta is deliberately not a
     * fallback, and first-lap overtakes are never added to the race total. */
    function getPilotStageOvertakes(raw = {}, { warn = true } = {}) {
        const current = num(raw.analyticsVersion) >= VERSION;
        const made = num(current ? raw.overtakes?.madeOverall : pick(raw.overtakes?.madeOverall, raw.overtakesMadeOverall, raw.ultrapassagensFeitas));
        const taken = num(current ? raw.overtakes?.takenOverall : pick(raw.overtakes?.takenOverall, raw.overtakesTakenOverall, raw.ultrapassagensTomadas));
        const storedBalance = num(current ? raw.overtakes?.balanceOverall : pick(raw.overtakes?.balanceOverall, raw.overtakesBalanceOverall, raw.saldoUltrapassagens));
        if ((made === null || taken === null) && warn) console.warn("[Kart/Overtakes] analytics canônico ausente", {
            pilot_uid: normalizePilotUid(pick(raw.pilot_uid, raw.pilotUid)),
            etapa_id: raw.etapa_id || raw.stageKey || "", made, taken
        });
        const balance = made !== null && taken !== null ? made - taken : storedBalance;
        if (made !== null && taken !== null && storedBalance !== null && storedBalance !== balance && warn) {
            console.warn("[Kart/Overtakes] saldo persistido inconsistente", { pilot_uid: raw.pilot_uid, made, taken, storedBalance, balance });
        }
        return { made, taken, balance };
    }

    /** Read-only transition adapter. It never calculates a metric and never
     * treats a Firestore document id as pilot_uid. */
    function normalizePilotAnalyticsForHighlights(raw = {}) {
        const pilot_uid = normalizePilotUid(pick(raw.pilot_uid, raw.pilotUid));
        const driver_name_display = pick(raw.driver_name_display, raw.name, raw.driver_name, raw.nome) || "";
        const stageOvertakes = getPilotStageOvertakes(raw, { warn: false });
        return {
            ...raw,
            pilot_uid,
            name: driver_name_display,
            driver_name_display,
            result: {
                positionOverall: num(pick(raw.result?.positionOverall, raw.positionOverall, raw.posicao_geral_arquivo)),
                positionChampionship: num(pick(raw.result?.positionChampionship, raw.positionChampionship, raw.posicao_campeonato))
            },
            qualifying: {
                positionOverall: num(pick(raw.qualifying?.positionOverall, raw.qualifyingPositionOverall, raw.posicao_classificacao_geral)),
                positionChampionship: num(pick(raw.qualifying?.positionChampionship, raw.qualifyingPositionChampionship, raw.posicao_classificacao_campeonato))
            },
            race: {
                bestLap: num(pick(raw.race?.bestLap, raw.bestLap?.time, raw.bestLap, raw.melhorVolta, raw.pace?.bestLap)),
                bestLapRankOverall: num(pick(raw.race?.bestLapRankOverall, raw.bestLap?.rankOverall, raw.bestLapRankOverall)),
                bestLapRankChampionship: num(pick(raw.race?.bestLapRankChampionship, raw.bestLap?.rankChampionship, raw.bestLapRankChampionship))
            },
            start: {
                gridPositionOverall: num(pick(raw.start?.gridPositionOverall, raw.gridPositionOverall)),
                firstLapPositionOverall: num(pick(raw.start?.firstLapPositionOverall, raw.firstLapPositionOverall)),
                deltaOverall: num(pick(raw.start?.deltaOverall, raw.startDeltaOverall)),
                gridPositionChampionship: num(pick(raw.start?.gridPositionChampionship, raw.gridPositionChampionship)),
                firstLapPositionChampionship: num(pick(raw.start?.firstLapPositionChampionship, raw.firstLapPositionChampionship)),
                deltaChampionship: num(pick(raw.start?.deltaChampionship, raw.startDeltaChampionship))
            },
            firstLapOvertakes: {
                madeOverall: num(pick(raw.firstLapOvertakes?.madeOverall, raw.overtakes?.firstLapMadeOverall, raw.firstLapMadeOverall)),
                takenOverall: num(pick(raw.firstLapOvertakes?.takenOverall, raw.overtakes?.firstLapTakenOverall, raw.firstLapTakenOverall)),
                balanceOverall: num(pick(raw.firstLapOvertakes?.balanceOverall, raw.overtakes?.firstLapBalanceOverall, raw.firstLapBalanceOverall))
            },
            overtakes: {
                madeOverall: stageOvertakes.made,
                takenOverall: stageOvertakes.taken,
                balanceOverall: stageOvertakes.balance
            },
            leadership: {
                lapsLedOverall: num(pick(raw.leadership?.lapsLedOverall, raw.lapsLedOverall, raw.voltasLideradas)),
                relevantLapsOverall: num(pick(raw.leadership?.relevantLapsOverall, raw.relevantLapsOverall))
            },
            pace: {
                pace: num(pick(raw.pace?.pace, raw.paceValue)),
                regularity: num(pick(raw.pace?.regularity, raw.regularity, raw.regularidade, raw.analytics?.regularidade?.regularity)),
                cleanLaps: num(pick(raw.pace?.cleanLaps, raw.cleanLaps, raw.cleanLapsCount)),
                status: pick(raw.pace?.status, raw.regularityStatus, raw.status) ?? null
            }
        };
    }
    const identity = typeof DriverIdentity !== "undefined" ? DriverIdentity : require("./driver_identity.js");
    const normalizeDriverId = identity.normalizeDriverId;
    const key = item => identity.driverKey(item);
    const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    const stddev = values => {
        const avg = mean(values);
        return avg === null ? null : Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length);
    };
    const median = values => {
        const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
        if (!sorted.length) return null;
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    };
    function filtrarSnapshot(snapshot, idsOficiais, mode = "campeonato") {
        const rows = Array.isArray(snapshot?.drivers) ? snapshot.drivers : (Array.isArray(snapshot?.positions) ? snapshot.positions : []);
        if (mode === "geral") return rows.map(item => ({ ...item }));
        const expected = idsOficiais instanceof Set ? idsOficiais : new Set(idsOficiais || []);
        const filtered = rows
            .filter(item => expected.has(identity.getPilotUid(item)) || expected.has(identity.getDriverId(item)))
            .map(item => ({ ...item }));
        return filtered
            .map((item, index) => ({ ...item, positionChampionship: num(item.positionChampionship) || index + 1 }))
            .sort((a, b) => Number(a.positionChampionship || Infinity) - Number(b.positionChampionship || Infinity));
    }

    function officialUidSet(officialPilotUids) {
        return new Set([...(officialPilotUids instanceof Set ? officialPilotUids : new Set(officialPilotUids || []))].map(normalizePilotUid).filter(Boolean));
    }

    /** Metrics are already calculated against the complete race here.  This
     * helper only restricts who is eligible to be presented as a winner. */
    function getOfficialHighlightCandidates({ analytics, officialPilotUids }) {
        const official = officialUidSet(officialPilotUids);
        return (analytics || []).map(normalizePilotAnalyticsForHighlights).filter(item => item.pilot_uid && official.has(item.pilot_uid));
    }

    const getOfficialMetricCandidates = (analytics, officialPilotUids) =>
        getOfficialHighlightCandidates({ analytics, officialPilotUids });

    function validateHighlights({ highlights, officialPilotUids, officialAnalytics = [] }) {
        const official = officialUidSet(officialPilotUids);
        const validated = Object.fromEntries(Object.entries(highlights).map(([highlightType, highlight]) => {
            if (!highlight) return [highlightType, null];
            const pilot_uid = String(identity.getPilotUid(highlight) || highlight.pilot_uid || "");
            if (official.has(pilot_uid)) {
                if (highlightType === "regularity" && num(highlight?.pace?.regularity) !== null && !String(highlight.driver_name_display || highlight.name || "").trim()) {
                    throw new Error("[Kart/Highlights] regularidade com valor sem driver_name_display");
                }
                return [highlightType, highlight];
            }
            console.error("[Kart/Highlights] piloto externo selecionado", { highlightType, pilot_uid, name: identity.getDriverName(highlight) });
            return [highlightType, null];
        }));
        const rows = (officialAnalytics || []).map(normalizePilotAnalyticsForHighlights).filter(p => official.has(p.pilot_uid));
        const required = [
            ["bestLap", rows.some(p => num(p.race.bestLap) > 0)],
            ["overtakes", rows.some(p => num(p.overtakes.madeOverall) > 0)],
            ["start", rows.some(p => num(p.start.deltaOverall) > 0)],
            ["regularity", rows.some(p => regularityIsValid(p.pace))],
            ["pole", rows.some(p => num(p.qualifying.positionChampionship) === 1)]
        ];
        const missing = required.filter(([key, hasCandidate]) => hasCandidate && !validated[key]).map(([key]) => key);
        if (missing.length) throw new Error(`[Kart/Highlights] candidatos válidos sem destaque: ${missing.join(", ")}`);
        return validated;
    }

    function buildStageHighlights(allAnalytics, officialPilotUids) {
        const candidates = getOfficialMetricCandidates(allAnalytics, officialPilotUids);
        const asc = path => candidates.map(x => [x, path(x)]).filter(([, value]) => Number.isFinite(value)).sort((a, b) => a[1] - b[1])[0]?.[0] || null;
        const desc = (path, positive = false) => candidates.map(x => [x, path(x)]).filter(([, value]) => Number.isFinite(value) && (!positive || value > 0)).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
        const overallHat = p => p?.qualifying?.positionOverall === 1 && p?.result?.positionOverall === 1 && p?.race?.bestLapRankOverall === 1;
        const relevantLaps = p => Number(p?.leadership?.relevantLapsOverall || 0);
        const highlights = {
            grandChelem: candidates.find(p => overallHat(p) && relevantLaps(p) > 0 && p.leadership.lapsLedOverall === relevantLaps(p)) || null,
            hatTrick: candidates.find(overallHat) || null,
            bestLap: asc(p => num(p?.race?.bestLap) > 0 ? num(p.race.bestLap) : null),
            pole: candidates.find(p => num(p?.qualifying?.positionChampionship) === 1) || null,
            overtakes: desc(p => getPilotStageOvertakes(p).made, true),
            start: candidates.filter(p => num(p?.start?.deltaOverall) > 0).sort((a, b) =>
                num(b.start.deltaOverall) - num(a.start.deltaOverall)
                || (num(a.start.firstLapPositionOverall) ?? Infinity) - (num(b.start.firstLapPositionOverall) ?? Infinity)
                || (num(a.result?.positionOverall) ?? Infinity) - (num(b.result?.positionOverall) ?? Infinity)
                || a.pilot_uid.localeCompare(b.pilot_uid)
            )[0] || null,
            leadership: desc(p => num(p?.leadership?.lapsLedOverall), true),
            regularity: asc(p => regularityIsValid(p?.pace) ? num(p.pace.regularity) : null)
        };
        return validateHighlights({ highlights, officialPilotUids, officialAnalytics: candidates });
    }

    function buildChampionshipHighlights(stageSummaries, officialPilotUids) {
        const stageKeys = new Set();
        const stages = (stageSummaries || []).flatMap((stage, index) => {
            const stageKey = String(stage?.stageKey || stage?.etapa_id || stage?.etapa || stage?.stage || index + 1);
            if (stageKeys.has(stageKey)) throw new Error(`[Kart/Highlights] etapa duplicada: ${stageKey}`);
            stageKeys.add(stageKey);
            const pilotKeys = new Set();
            return (stage?.allPilotAnalytics || stage?.analytics || []).map(row => {
                const uid = normalizePilotUid(row?.pilot_uid || row?.pilotUid);
                const key = `${stageKey}|${uid}`;
                if (!uid) throw new Error(`[Kart/Highlights] pilot_uid ausente na etapa ${stageKey}`);
                if (pilotKeys.has(key)) throw new Error(`[Kart/Highlights] pilot analytics duplicado: ${key}`);
                pilotKeys.add(key);
                return { ...row, _stage: stage.etapa ?? stage.stage ?? index + 1, _stageKey: stageKey };
            });
        });
        const candidates = getOfficialHighlightCandidates({ analytics: stages, officialPilotUids });
        const byPilot = new Map();
        candidates.forEach(row => {
            const uid = String(identity.getPilotUid(row) || row.pilot_uid);
            if (!byPilot.has(uid)) byPilot.set(uid, { ...row, pilot_uid: uid, driver_name_display: row.driver_name_display || row.name, overtakes: { madeOverall: 0, takenOverall: 0, balanceOverall: 0 }, leadership: { ...row.leadership, lapsLedOverall: 0 }, _regularities: [], stagesUsed: 0 });
            const aggregate = byPilot.get(uid);
            const overtakes = getPilotStageOvertakes(row);
            if (overtakes.made !== null) aggregate.overtakes.madeOverall += overtakes.made;
            if (overtakes.taken !== null) aggregate.overtakes.takenOverall += overtakes.taken;
            aggregate.overtakes.balanceOverall = aggregate.overtakes.madeOverall - aggregate.overtakes.takenOverall;
            aggregate.leadership.lapsLedOverall += num(row.leadership?.lapsLedOverall) || 0;
            if (regularityIsValid(row.pace)) {
                aggregate._regularities.push(num(row.pace.regularity));
                aggregate.stagesUsed += 1;
            }
        });
        const aggregate = [...byPilot.values()].map(row => ({ ...row, regularities: [...row._regularities], metric: "averageRegularity", pace: { ...row.pace, status: row._regularities.length ? "ok" : "voltas_insuficientes", cleanLaps: row._regularities.length ? MIN_CLEAN_LAPS : 0, regularity: mean(row._regularities) } }));
        console.table(aggregate.map(row => ({ pilot_uid: row.pilot_uid, name: row.driver_name_display, stageCount: row.stagesUsed, regularities: row.regularities, averageRegularity: row.pace.regularity })));
        const highlights = buildStageHighlights(aggregate, officialPilotUids);
        const bestLaps = candidates.filter(row => num(row.race?.bestLap) > 0).sort((a, b) => num(a.race.bestLap) - num(b.race.bestLap));
        highlights.bestLap = bestLaps[0] || null;
        const poles = new Map();
        candidates.filter(row => num(row.qualifying?.positionChampionship) === 1).forEach(row => {
            const uid = row.pilot_uid;
            if (!poles.has(uid)) poles.set(uid, { ...row, poleCount: 0 });
            poles.get(uid).poleCount += 1;
        });
        highlights.pole = [...poles.values()].sort((a, b) => b.poleCount - a.poleCount)[0] || null;
        const positiveStarts = candidates.filter(row => num(row.start?.deltaOverall) > 0).sort((a, b) => num(b.start.deltaOverall) - num(a.start.deltaOverall));
        highlights.start = positiveStarts[0] || null;
        const validated = validateHighlights({ highlights, officialPilotUids, officialAnalytics: candidates });
        if (validated.overtakes) {
            const total = byPilot.get(validated.overtakes.pilot_uid)?.overtakes?.madeOverall;
            if (validated.overtakes.overtakes.madeOverall !== total) throw new Error("[Kart/Highlights] destaque de ultrapassagens diverge do total canônico");
        }
        return validated;
    }

    function championshipSnapshotRows(snapshot, officialPilotUids) {
        return getOfficialMetricCandidates(snapshot?.positions || snapshot?.drivers || [], officialPilotUids)
            .sort((a, b) => Number(a.positionChampionship || Infinity) - Number(b.positionChampionship || Infinity))
            .map(item => ({ ...item, displayPosition: item.positionOverall, displayDelta: item.positionDeltaOverall }));
    }
    function calcularRegularidade(voltas) {
        const grupos = new Map();
        (voltas || []).forEach(lap => {
            const id = key(lap);
            if (!id) return;
            if (!grupos.has(id)) grupos.set(id, []);
            grupos.get(id).push(lap);
        });
        const items = [...grupos.entries()].map(([driverId, laps]) => {
            const validas = laps.filter(l => Number(l.volta) !== 1 && num(l.tempo_volta_segundos) > 0);
            const mediana = median(validas.map(l => num(l.tempo_volta_segundos)));
            const anomalas = new Set(validas.filter(l => mediana !== null && num(l.tempo_volta_segundos) < mediana * 0.80));
            const candidatas = validas.filter(l => !anomalas.has(l));
            const bestLap = candidatas.length ? Math.min(...candidatas.map(l => num(l.tempo_volta_segundos))) : null;
            const limpas = bestLap === null ? [] : candidatas.filter(l => num(l.tempo_volta_segundos) <= bestLap * 1.05);
            const tempos = limpas.map(l => num(l.tempo_volta_segundos));
            const pace = mean(tempos);
            const regularidade = stddev(tempos);
            const base = laps[0] || {};
            return {
                pilot_uid: identity.getPilotUid(base),
                driver_id: identity.getDriverId(base), driver_name: base.driver_name || driverId, kart_numero: base.kart_numero || "",
                bestLap, bestLapValid: bestLap, pace, regularidade, cleanLaps: limpas.length,
                cleanLapsCount: limpas.length, totalLaps: laps.length,
                cleanLapNumbers: limpas.map(l => Number(l.volta)),
                excludedLapNumbers: laps.filter(l => !limpas.includes(l)).map(l => Number(l.volta)),
                isChampionship: base.isChampionship === true,
                status: tempos.length >= 2 ? "ok" : "voltas_insuficientes",
                laps: [...laps].sort((a, b) => Number(a.volta) - Number(b.volta)).map(l => ({
                    volta: Number(l.volta), lap: Number(l.volta), tempo: num(l.tempo_volta_segundos), time: num(l.tempo_volta_segundos),
                    clean: limpas.includes(l), validForRegularity: limpas.includes(l), isBest: num(l.tempo_volta_segundos) === bestLap,
                    classification: Number(l.volta) === 1 ? "not_classified" : anomalas.has(l) ? "joker_lap" : num(l.tempo_volta_segundos) === bestLap ? "fastest" : limpas.includes(l) ? "clean" : "slow",
                    reason: Number(l.volta) === 1 ? "first_lap" : anomalas.has(l) ? "outlier_fast" : limpas.includes(l) ? null : "over_105_percent"
                }))
            };
        });
        const gridPace = mean(items.map(i => i.pace).filter(Number.isFinite));
        return { items, gridPace };
    }
    function gerarSnapshots(voltas, officialDrivers = [], gridRows = []) {
        const officialRows = (officialDrivers || []).map(item => typeof item === "object" ? item : { driver_id: item });
        const oficiais = new Set(officialRows.map(row => identity.getPilotUid(row) || identity.getDriverId(row)).filter(Boolean));
        const grupos = new Map();
        (voltas || []).forEach(lap => {
            const id = key(lap);
            if (!id) return;
            if (!grupos.has(id)) grupos.set(id, []);
            grupos.get(id).push(lap);
        });
        grupos.forEach(laps => laps.sort((a, b) => Number(a.elapsed_time) - Number(b.elapsed_time)));
        const numeros = [...new Set((voltas || []).map(v => Number(v.volta_lider)).filter(n => n > 0))].sort((a, b) => a - b);
        let anterior = new Map();
        const grid = new Map((gridRows || []).map((row, index) => [identity.getPilotUid(row) || identity.getDriverId(row), index + 1]).filter(([id]) => id));
        return numeros.map(numeroVolta => {
            const passagem = [];
            grupos.forEach((laps, driverId) => {
                const candidatas = laps.filter(l => Number(l.volta_lider) <= numeroVolta);
                const lap = candidatas[candidatas.length - 1];
                if (lap) passagem.push({ pilot_uid: identity.getPilotUid(lap), driver_id: identity.getDriverId(lap) || null, driver_name: lap.driver_name || driverId, kart_numero: lap.kart_numero || "", completedLaps: Number(lap.volta), leaderLap: numeroVolta, elapsedTime: num(lap.elapsed_time), lapTime: num(lap.tempo_volta_segundos), isChampionship: oficiais.has(identity.getPilotUid(lap) || identity.getDriverId(lap)) });
            });
            // Todo participante do grid sem passagem até este instante continua
            // representado. Isso evita que um piloto (inclusive externo) seja
            // artificialmente removido da ordem consolidada da primeira volta.
            const carryForwardRows = [...(gridRows || []), ...officialRows];
            carryForwardRows.forEach(driver => {
                const id = identity.getPilotUid(driver) || identity.getDriverId(driver);
                if (!id || passagem.some(item => (identity.getPilotUid(item) || identity.getDriverId(item)) === id)) return;
                passagem.push({ pilot_uid: identity.getPilotUid(driver), driver_id: identity.getDriverId(driver) || null, driver_name: identity.getDriverName(driver), kart_numero: driver.kart_numero || "", completedLaps: 0, leaderLap: numeroVolta, elapsedTime: null, lapTime: null, isChampionship: oficiais.has(id), stateSource: grid.has(id) ? "grid" : "awaiting_first_passage", gridPosition: grid.get(id) || null });
            });
            passagem.sort((a, b) => b.completedLaps - a.completedLaps || (Number.isFinite(a.elapsedTime) ? a.elapsedTime : Infinity) - (Number.isFinite(b.elapsedTime) ? b.elapsedTime : Infinity) || (a.gridPosition || Infinity) - (b.gridPosition || Infinity));
            let oficialPos = 0;
            passagem.forEach((p, index) => {
                p.positionOverall = index + 1;
                p.positionChampionship = p.isChampionship ? ++oficialPos : null;
                const positionKey = identity.driverKey(p);
                const old = anterior.get(positionKey);
                p.positionDeltaOverall = old ? old.positionOverall - p.positionOverall : 0;
                p.positionDeltaChampionship = old && p.isChampionship ? old.positionChampionship - p.positionChampionship : 0;
                const prev = passagem[index - 1];
                p.gapToPreviousOverall = !prev ? 0 : prev.completedLaps === p.completedLaps ? Math.max(0, p.elapsedTime - prev.elapsedTime) : null;
                p.lapsBehindPreviousOverall = prev ? Math.max(0, prev.completedLaps - p.completedLaps) : 0;
            });
            const champ = passagem.filter(p => p.isChampionship);
            champ.forEach((p, index) => {
                const prev = champ[index - 1];
                p.gapToPreviousChampionship = !prev ? 0 : prev.completedLaps === p.completedLaps ? Math.max(0, p.elapsedTime - prev.elapsedTime) : null;
                p.lapsBehindPreviousChampionship = prev ? Math.max(0, prev.completedLaps - p.completedLaps) : 0;
                p.previousChampionshipName = prev?.driver_name || "";
            });
            anterior = new Map(passagem.map(p => [identity.driverKey(p), p]));
            return { lap: numeroVolta, numeroVolta, drivers: passagem, positions: passagem };
        });
    }
    const overtakeKey = row => identity.getPilotUid(row) || identity.getDriverId(row) || key(row);
    function snapshotRows(snapshot) {
        const source = Array.isArray(snapshot) ? snapshot : (snapshot?.positions || snapshot?.drivers || []);
        return [...source].filter(row => overtakeKey(row)).sort((a, b) => {
            const ap = num(a.positionOverall), bp = num(b.positionOverall);
            return (ap ?? Infinity) - (bp ?? Infinity);
        });
    }

    /** Canonical pairwise overtake detector. Every unordered pair is visited
     * once and only comparable pilots present in both snapshots can create an
     * event. The consolidated positionOverall order is authoritative. */
    function calculateOvertakesBetweenSnapshots(previousSnapshot, currentSnapshot, context = {}) {
        const previous = snapshotRows(previousSnapshot), current = snapshotRows(currentSnapshot);
        const previousById = new Map(previous.map(row => [overtakeKey(row), row]));
        const currentById = new Map(current.map(row => [overtakeKey(row), row]));
        const comparableIds = previous.map(overtakeKey).filter(id => currentById.has(id));
        const result = new Map();
        const events = [];
        const ensure = id => {
            if (!result.has(id)) {
                const row = currentById.get(id) || previousById.get(id) || {};
                result.set(id, { ...row, made: 0, taken: 0, balance: 0 });
            }
            return result.get(id);
        };
        comparableIds.forEach(ensure);
        const seenPairs = new Set();
        for (let i = 0; i < comparableIds.length; i += 1) {
            for (let j = i + 1; j < comparableIds.length; j += 1) {
                const aId = comparableIds[i], bId = comparableIds[j];
                const pairKey = [String(aId), String(bId)].sort().join("|");
                if (seenPairs.has(pairKey)) continue;
                seenPairs.add(pairKey);
                const aWasAhead = previous.indexOf(previousById.get(aId)) < previous.indexOf(previousById.get(bId));
                const aIsAhead = current.indexOf(currentById.get(aId)) < current.indexOf(currentById.get(bId));
                if (aWasAhead === aIsAhead) continue;
                const winner = ensure(aIsAhead ? aId : bId), loser = ensure(aIsAhead ? bId : aId);
                winner.made += 1;
                loser.taken += 1;
                const overtakerUid = aIsAhead ? aId : bId;
                const overtakenUid = aIsAhead ? bId : aId;
                events.push({
                    transition: context.transition || null,
                    lap: num(context.lap),
                    overtakerUid,
                    overtakenUid,
                    overtakerName: identity.getDriverDisplayName(currentById.get(overtakerUid) || previousById.get(overtakerUid)),
                    overtakenName: identity.getDriverDisplayName(currentById.get(overtakenUid) || previousById.get(overtakenUid)),
                    type: "position_inversion"
                });
            }
        }
        result.forEach(row => { row.balance = row.made - row.taken; });
        const totalMade = [...result.values()].reduce((sum, row) => sum + row.made, 0);
        const totalTaken = [...result.values()].reduce((sum, row) => sum + row.taken, 0);
        if (totalMade !== totalTaken) {
            console.error("[Kart/Overtakes] made/taken inconsistente", {
                etapa: context.stageId || context.etapa || null,
                transition: context.transitionIndex ?? context.transition ?? null,
                totalMade, totalTaken
            });
            throw new Error(`[Kart/Overtakes] transição inconsistente: made=${totalMade}, taken=${totalTaken}`);
        }
        return { byPilot: result, events, totalMade, totalTaken, comparableComplete: comparableIds.length === previous.length && comparableIds.length === current.length };
    }

    /** Single source for first-lap and full-race overtakes. GRID -> V1 is the
     * first iteration and therefore belongs to the race total exactly once. */
    function calculateRaceOvertakes({ snapshots = [], stageId = "" } = {}) {
        const result = new Map();
        const allRows = (snapshots || []).flatMap(snapshotRows);
        allRows.forEach(row => {
            const id = overtakeKey(row);
            if (!id || result.has(id)) return;
            result.set(id, { ...row, firstLap: { made: 0, taken: 0, balance: 0 }, race: { made: 0, taken: 0, balance: 0 }, transitionBreakdown: [] });
        });
        for (let transitionIndex = 1; transitionIndex < snapshots.length; transitionIndex += 1) {
            const previousSnapshot = snapshots[transitionIndex - 1] || {};
            const currentSnapshot = snapshots[transitionIndex] || {};
            const from = previousSnapshot.snapshotType === "grid"
                ? "GRID"
                : `V${num(previousSnapshot.numeroVolta ?? previousSnapshot.lap) ?? transitionIndex - 1}`;
            const to = `V${num(currentSnapshot.numeroVolta ?? currentSnapshot.lap) ?? transitionIndex}`;
            const transitionLabel = `${from}->${to}`;
            const transition = calculateOvertakesBetweenSnapshots(previousSnapshot, currentSnapshot, {
                stageId, transitionIndex, transition: transitionLabel,
                lap: num(currentSnapshot.numeroVolta ?? currentSnapshot.lap) ?? transitionIndex
            });
            transition.byPilot.forEach((change, id) => {
                if (!result.has(id)) return;
                const row = result.get(id);
                row.race.made += change.made;
                row.race.taken += change.taken;
                row.transitionBreakdown.push({
                    from, to, transition: `${from} -> ${to}`,
                    made: transition.events.filter(event => event.overtakerUid === id),
                    taken: transition.events.filter(event => event.overtakenUid === id),
                    madeCount: change.made, takenCount: change.taken, balance: change.balance
                });
                if (transitionIndex === 1) row.firstLap = { made: change.made, taken: change.taken, balance: change.balance };
            });
        }
        result.forEach(row => {
            row.race.balance = row.race.made - row.race.taken;
            if (row.race.made < row.firstLap.made || row.race.taken < row.firstLap.taken) {
                throw new Error(`[Kart/Overtakes] total menor que primeira volta: ${overtakeKey(row)}`);
            }
        });
        const raceTotals = assertOvertakeInvariant([...result.values()].map(row => ({ madeOverall: row.race.made, takenOverall: row.race.taken })), `etapa ${stageId || "-"}`);
        const firstLapTotals = assertOvertakeInvariant([...result.values()].map(row => ({ madeOverall: row.firstLap.made, takenOverall: row.firstLap.taken })), `primeira volta da etapa ${stageId || "-"}`);
        const overtakeEvents = [...result.values()].flatMap(row => row.transitionBreakdown.flatMap(item => item.made));
        return Object.assign(result, { overtakeEvents, raceTotals, firstLapTotals });
    }

    function calcularUltrapassagens(snapshots, championshipOnly, participants = []) {
        const canonical = calculateRaceOvertakes({ snapshots });
        const participantById = new Map((participants || []).map(row => [overtakeKey(row), row]));
        return [...canonical.entries()].filter(([id, row]) => !championshipOnly || (participantById.get(id) || row).isChampionship === true).map(([id, row]) => {
            const source = participantById.get(id) || row;
            return {
                ...(identity.getPilotUid(source) ? { pilot_uid: identity.getPilotUid(source) } : {}),
                driver_id: identity.getDriverId(source) || null,
                driver_name: identity.getDriverName(source),
                isChampionship: source.isChampionship === true,
                feitas: row.race.made,
                tomadas: row.race.taken,
                saldo: row.race.balance
            };
        });
    }
    function assertOvertakeInvariant(rows, context = "corrida") {
        const made = (rows || []).reduce((sum, row) => sum + Number(row.feitas ?? row.madeOverall ?? row.made ?? 0), 0);
        const taken = (rows || []).reduce((sum, row) => sum + Number(row.tomadas ?? row.takenOverall ?? row.taken ?? 0), 0);
        if (made !== taken) throw new Error(`[Kart/Overtakes] invariante violada em ${context}: made=${made}, taken=${taken}`);
        return { made, taken };
    }
    function calculatePositionChangesBetweenSnapshots(previousOrder, currentOrder, championshipOnly = false) {
        const transition = calculateOvertakesBetweenSnapshots(previousOrder, currentOrder);
        return [...transition.byPilot.values()].filter(row => !championshipOnly || row.isChampionship).map(row => ({
            ...row,
            madeOverall: row.made,
            takenOverall: row.taken,
            balanceOverall: row.balance
        }));
    }
    function officialGridPosition(row) {
        return num(pick(row?.qualifying?.positionOverall, row?.positionOverall, row?.posicao_geral_arquivo, row?.posicao_final, row?.posicao));
    }
    function gridSnapshot(gridRows, participants, officialIds) {
        const known = new Map((participants || []).map(row => [key(row), row]));
        const ordered = (gridRows || []).map((row, documentIndex) => ({ row, documentIndex, position: officialGridPosition(row) }))
            .filter(item => item.position !== null)
            .sort((a, b) => a.position - b.position || a.documentIndex - b.documentIndex);
        let championshipPosition = 0;
        return ordered.map(({ row, position }) => {
            const merged = { ...(known.get(key(row)) || {}), ...row };
            const isChampionship = officialIds.has(identity.getPilotUid(merged) || identity.getDriverId(merged));
            return {
                ...merged,
                positionOverall: position,
                positionChampionship: isChampionship ? ++championshipPosition : null,
                completedLaps: 0,
                positionDeltaOverall: 0,
                positionDeltaChampionship: 0,
                isChampionship,
                source: "classificacao",
                gridSource: "classificacao"
            };
        });
    }

    /** Fonte única da performance de largada. As posições gerais são índices
     * dos snapshots completos; só a posição de campeonato filtra externos. */
    function calculateStartAnalytics({ gridSnapshot: gridRows = [], firstLapSnapshot: firstLapRows = [], officialPilotUids = [], drivers = [] } = {}) {
        const rows = value => Array.isArray(value) ? value : (value?.positions || value?.drivers || []);
        const grid = rows(gridRows), firstLap = rows(firstLapRows);
        const driverRows = drivers.length ? drivers : grid;
        const analyticsKey = row => identity.getPilotUid(row) || identity.getDriverId(row) || key(row);
        const official = new Set([...(officialPilotUids || []), ...driverRows.filter(row => row.isChampionship === true).map(analyticsKey)].filter(Boolean));
        const positionMap = (list, field) => new Map(list.map((row, index) => [analyticsKey(row), num(row?.[field]) ?? index + 1]).filter(([id]) => id));
        const championshipMap = list => positionMap(list.filter(row => official.has(analyticsKey(row))), "positionChampionship");
        const gridOverall = positionMap(grid, "positionOverall"), firstOverall = positionMap(firstLap, "positionOverall");
        const gridChampionship = championshipMap(grid), firstChampionship = championshipMap(firstLap);
        const result = new Map();
        driverRows.forEach(driver => {
            const id = analyticsKey(driver);
            if (!id || result.has(id)) return;
            const gridPositionOverall = num(gridOverall.get(id));
            const firstLapPositionOverall = num(firstOverall.get(id));
            const gridPositionChampionship = num(gridChampionship.get(id));
            const firstLapPositionChampionship = num(firstChampionship.get(id));
            result.set(id, {
                gridPositionOverall,
                firstLapPositionOverall,
                deltaOverall: gridPositionOverall !== null && firstLapPositionOverall !== null ? gridPositionOverall - firstLapPositionOverall : null,
                gridPositionChampionship,
                firstLapPositionChampionship,
                deltaChampionship: gridPositionChampionship !== null && firstLapPositionChampionship !== null ? gridPositionChampionship - firstLapPositionChampionship : null,
                gridSource: grid.find(row => analyticsKey(row) === id)?.gridSource || grid.find(row => analyticsKey(row) === id)?.source || null
            });
        });
        return result;
    }
    function processarVoltasEtapa(voltas, officialDrivers = [], gridRows = []) {
        const officialRows = (officialDrivers || []).map(item => typeof item === "object" ? item : { driver_id: item });
        const idsCampeonato = officialRows.map(row => identity.getPilotUid(row) || identity.getDriverId(row)).filter(Boolean);
        const participants = new Map();
        (voltas || []).forEach(v => { const k = key(v); if (k && !participants.has(k)) participants.set(k, { ...v, isChampionship: idsCampeonato.includes(identity.getPilotUid(v) || identity.getDriverId(v)) }); });
        officialRows.forEach(row => { const k = key(row); if (k && !participants.has(k)) participants.set(k, { ...row, isChampionship: true }); });
        const regularidade = calcularRegularidade(voltas);
        const regularityKeys = new Set(regularidade.items.map(key));
        participants.forEach((p, k) => { if (!regularityKeys.has(k)) regularidade.items.push({ pilot_uid: identity.getPilotUid(p), driver_id: identity.getDriverId(p) || null, driver_name: identity.getDriverName(p), kart_numero: p.kart_numero || "", isChampionship: p.isChampionship, regularidade: null, pace: null, bestLap: null, bestLapValid: null, cleanLaps: 0, cleanLapsCount: 0, totalLaps: 0, cleanLapNumbers: [], excludedLapNumbers: [], laps: [], status: "voltas_insuficientes" }); });
        const grid = gridSnapshot(gridRows, [...participants.values()], new Set(idsCampeonato));
        const raceSnapshots = gerarSnapshots(voltas, officialRows, grid);
        const gridState = { snapshotIndex: 0, snapshotType: "grid", type: "grid", lap: 0, numeroVolta: 0, label: "LARGADA", positions: grid, drivers: grid };
        const firstRaceSnapshot = raceSnapshots[0];
        if (firstRaceSnapshot) {
            const previous = new Map(grid.map(row => [key(row), row]));
            firstRaceSnapshot.positions.forEach(row => {
                const old = previous.get(key(row));
                row.positionDeltaOverall = old ? old.positionOverall - row.positionOverall : 0;
                row.positionDeltaChampionship = old && row.isChampionship ? old.positionChampionship - row.positionChampionship : 0;
            });
        }
        raceSnapshots.forEach((snapshot, index) => Object.assign(snapshot, { snapshotIndex: index + 1, snapshotType: "race", type: "race", label: `VOLTA ${snapshot.numeroVolta}` }));
        const snapshots = [gridState, ...raceSnapshots];
        console.debug("[Kart/BestStart/Snapshot]", { index: 0, lap: 0, snapshotType: "grid", leaderLap: null, driverCount: grid.length });
        raceSnapshots.forEach((snapshot, index) => console.debug("[Kart/BestStart/Snapshot]", {
            index: index + 1, lap: snapshot.lap, snapshotType: "race",
            leaderLap: snapshot.numeroVolta, driverCount: snapshot.positions?.length || 0
        }));
        const transitions = snapshots;
        const firstLapSnapshot = raceSnapshots.find(snapshot => num(snapshot.leaderLap ?? snapshot.lap ?? snapshot.numeroVolta) === 1) || null;
        const startDrivers = [...new Map([...grid, ...participants.values()].map(row => [identity.getPilotUid(row) || identity.getDriverId(row) || key(row), row])).values()];
        const startAnalytics = calculateStartAnalytics({ gridSnapshot: gridState, firstLapSnapshot, officialPilotUids: idsCampeonato, drivers: startDrivers });
        const raceOvertakes = calculateRaceOvertakes({ snapshots: transitions });
        const firstLapChanges = [...raceOvertakes.values()].map(row => ({ ...row, madeOverall: row.firstLap.made, takenOverall: row.firstLap.taken, balanceOverall: row.firstLap.balance }));
        const ultrapassagensGeral = [...raceOvertakes.values()].map(row => ({ ...row, feitas: row.race.made, tomadas: row.race.taken, saldo: row.race.balance }));
        const ultrapassagensCampeonato = ultrapassagensGeral.filter(row => row.isChampionship === true);
        firstLapChanges.forEach(change => {
            const start = startAnalytics.get(identity.getPilotUid(change) || identity.getDriverId(change) || key(change));
            if (grid.length === firstLapSnapshot?.positions?.length && start && change.balanceOverall !== start.deltaOverall) {
                console.error("[Kart/Overtakes] firstLap balance diverge de start.deltaOverall", { pilot_uid: identity.getPilotUid(change), firstLapBalance: change.balanceOverall, startDeltaOverall: start.deltaOverall });
                throw new Error(`[Kart/Overtakes] primeira volta inconsistente: ${identity.getPilotUid(change) || key(change)}`);
            }
        });
        return { analyticsVersion: VERSION, participants: [...participants.values()], regularidade: regularidade.items, gridPace: regularidade.gridPace, gridSnapshot: gridState, firstLapSnapshot, startAnalytics, snapshots, raceOvertakes, firstLapChanges, ultrapassagensCampeonato, ultrapassagensGeral };
    }
    function consolidarPilotAnalytics(rows, { campeonatoId = "", etapaId = "all" } = {}) {
        const stages = (rows || []).filter(row => (!campeonatoId || row.campeonato_id === campeonatoId) && (!etapaId || etapaId === "all" || row.etapa_id === etapaId));
        const countPosition = (path, predicate) => stages.filter(row => {
            const value = num(path(row));
            return value !== null && value > 0 && predicate(value);
        }).length;
        const bestPosition = path => {
            const positions = stages.map(path).map(num).filter(value => value !== null && value > 0);
            return positions.length ? Math.min(...positions) : null;
        };
        const wins = {
            overall: countPosition(row => row.result?.positionOverall, position => position === 1),
            championship: countPosition(row => row.result?.positionChampionship, position => position === 1)
        };
        const podiums = {
            overall: countPosition(row => row.result?.positionOverall, position => position <= 3),
            championship: countPosition(row => row.result?.positionChampionship, position => position <= 3)
        };
        const poles = {
            overall: countPosition(row => row.qualifying?.positionOverall, position => position === 1),
            championship: countPosition(row => row.qualifying?.positionChampionship, position => position === 1)
        };
        return {
            stages,
            kpis: {
                races: stages.length,
                wins,
                podiums,
                poles,
                points: stages.reduce((sum, row) => sum + Number(row.result?.points || 0), 0),
                bestPosition: {
                    overall: bestPosition(row => row.result?.positionOverall),
                    championship: bestPosition(row => row.result?.positionChampionship)
                },
                winsLegacy: wins.championship,
                podiumsLegacy: podiums.championship,
                polesLegacy: poles.championship
            }
        };
    }
    return { VERSION, MIN_CLEAN_LAPS, toNullableNumber: num, normalizePilotUid, getPilotStageOvertakes, normalizePilotAnalyticsForHighlights, regularityIsValid, calcularRegularidade, gerarSnapshots, filtrarSnapshot, calcularUltrapassagens, calculateOvertakesBetweenSnapshots, calculateRaceOvertakes, calculatePositionChangesBetweenSnapshots, calculateStartAnalytics, assertOvertakeInvariant, processarVoltasEtapa, consolidarPilotAnalytics, getOfficialHighlightCandidates, getOfficialMetricCandidates, validateHighlights, buildStageHighlights, buildChampionshipHighlights, championshipSnapshotRows };
}));
