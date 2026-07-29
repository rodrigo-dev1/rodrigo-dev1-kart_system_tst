(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    root.KartAnalytics = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    const VERSION = 11;
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

    /** Read-only transition adapter. It never calculates a metric and never
     * treats a Firestore document id as pilot_uid. */
    function normalizePilotAnalyticsForHighlights(raw = {}) {
        const pilot_uid = normalizePilotUid(pick(raw.pilot_uid, raw.pilotUid));
        return {
            ...raw,
            pilot_uid,
            name: pick(raw.name, raw.driver_name_display, raw.driver_name, raw.nome) || "",
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
                madeOverall: num(pick(raw.overtakes?.madeOverall, raw.overtakesMadeOverall, raw.ultrapassagensFeitas)),
                takenOverall: num(pick(raw.overtakes?.takenOverall, raw.overtakesTakenOverall, raw.ultrapassagensTomadas)),
                balanceOverall: num(pick(raw.overtakes?.balanceOverall, raw.overtakesBalanceOverall, raw.saldoUltrapassagens))
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
            if (official.has(pilot_uid)) return [highlightType, highlight];
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
            overtakes: desc(p => num(p?.overtakes?.madeOverall), true),
            start: desc(p => num(p?.start?.deltaOverall), true),
            leadership: desc(p => num(p?.leadership?.lapsLedOverall), true),
            regularity: asc(p => regularityIsValid(p?.pace) ? num(p.pace.regularity) : null)
        };
        return validateHighlights({ highlights, officialPilotUids, officialAnalytics: candidates });
    }

    function buildChampionshipHighlights(stageSummaries, officialPilotUids) {
        const stages = (stageSummaries || []).flatMap((stage, index) =>
            (stage?.allPilotAnalytics || stage?.analytics || []).map(row => ({ ...row, _stage: stage.etapa ?? stage.stage ?? index + 1 })));
        const candidates = getOfficialHighlightCandidates({ analytics: stages, officialPilotUids });
        const byPilot = new Map();
        candidates.forEach(row => {
            const uid = String(identity.getPilotUid(row) || row.pilot_uid);
            if (!byPilot.has(uid)) byPilot.set(uid, { ...row, overtakes: { ...row.overtakes, madeOverall: 0 }, leadership: { ...row.leadership, lapsLedOverall: 0 }, _regularities: [] });
            const aggregate = byPilot.get(uid);
            aggregate.overtakes.madeOverall += num(row.overtakes?.madeOverall) || 0;
            aggregate.leadership.lapsLedOverall += num(row.leadership?.lapsLedOverall) || 0;
            if (regularityIsValid(row.pace)) aggregate._regularities.push(num(row.pace.regularity));
        });
        const aggregate = [...byPilot.values()].map(row => ({ ...row, pace: { ...row.pace, status: row._regularities.length ? "ok" : "voltas_insuficientes", cleanLaps: row._regularities.length ? MIN_CLEAN_LAPS : 0, regularity: mean(row._regularities) } }));
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
        return validateHighlights({ highlights, officialPilotUids, officialAnalytics: candidates });
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
        const grid = new Map((gridRows || []).map((row, index) => [identity.getPilotUid(row) || identity.getDriverId(row), Number(row.positionChampionship || row.posicao_classificacao_campeonato || index + 1)]).filter(([id]) => id));
        return numeros.map(numeroVolta => {
            const passagem = [];
            grupos.forEach((laps, driverId) => {
                const candidatas = laps.filter(l => Number(l.volta_lider) <= numeroVolta);
                const lap = candidatas[candidatas.length - 1];
                if (lap) passagem.push({ pilot_uid: identity.getPilotUid(lap), driver_id: identity.getDriverId(lap) || null, driver_name: lap.driver_name || driverId, kart_numero: lap.kart_numero || "", completedLaps: Number(lap.volta), leaderLap: numeroVolta, elapsedTime: num(lap.elapsed_time), lapTime: num(lap.tempo_volta_segundos), isChampionship: oficiais.has(identity.getPilotUid(lap) || identity.getDriverId(lap)) });
            });
            // Um oficial sem passagem até este instante continua representado.
            officialRows.forEach(driver => {
                const id = identity.getPilotUid(driver) || identity.getDriverId(driver);
                if (!id || passagem.some(item => (identity.getPilotUid(item) || identity.getDriverId(item)) === id)) return;
                passagem.push({ pilot_uid: identity.getPilotUid(driver), driver_id: identity.getDriverId(driver) || null, driver_name: identity.getDriverName(driver), kart_numero: driver.kart_numero || "", completedLaps: 0, leaderLap: numeroVolta, elapsedTime: null, lapTime: null, isChampionship: true, stateSource: grid.has(id) ? "grid" : "awaiting_first_passage", gridPosition: grid.get(id) || null });
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
    function calcularUltrapassagens(snapshots, championshipOnly, participants = []) {
        const result = new Map();
        (participants || []).filter(p => !championshipOnly || p.isChampionship).forEach(p => {
            const id = identity.getPilotUid(p) || identity.getDriverId(p) || key(p);
            if (id) result.set(id, { ...(identity.getPilotUid(p) ? { pilot_uid: identity.getPilotUid(p) } : {}), driver_id: identity.getDriverId(p) || null, driver_name: identity.getDriverName(p), isChampionship: p.isChampionship === true, feitas: 0, tomadas: 0, saldo: 0 });
        });
        (snapshots || []).flatMap(snapshot => snapshot.positions || []).filter(p => !championshipOnly || p.isChampionship).forEach(p => {
            const id = identity.getPilotUid(p) || identity.getDriverId(p) || key(p);
            if (id && !result.has(id)) result.set(id, { ...(identity.getPilotUid(p) ? { pilot_uid: identity.getPilotUid(p) } : {}), driver_id: identity.getDriverId(p) || null, driver_name: identity.getDriverName(p), isChampionship: p.isChampionship === true, feitas: 0, tomadas: 0, saldo: 0 });
        });
        for (let index = 1; index < (snapshots || []).length; index += 1) {
            const changes = calculatePositionChangesBetweenSnapshots(snapshots[index - 1].positions, snapshots[index].positions, championshipOnly);
            changes.forEach(change => {
                const resultKey = identity.getPilotUid(change) || identity.getDriverId(change) || key(change);
                if (!result.has(resultKey)) result.set(resultKey, { ...change, feitas: 0, tomadas: 0, saldo: 0 });
                let made = change.madeOverall, taken = change.takenOverall;
                // Snapshots legados/incompletos podem não conter os pares que
                // explicam o delta. Neles preservamos o saldo já consolidado.
                const delta = championshipOnly ? Number(change.positionDeltaChampionship) : Number(change.positionDeltaOverall);
                if (!made && !taken && Number.isFinite(delta) && delta !== 0) {
                    made = Math.max(0, delta); taken = Math.max(0, -delta);
                }
                result.get(resultKey).feitas += made;
                result.get(resultKey).tomadas += taken;
            });
        }
        return [...result.values()].map(i => ({ ...i, saldo: i.feitas - i.tomadas }));
    }
    function calculatePositionChangesBetweenSnapshots(previousOrder, currentOrder, championshipOnly = false) {
        const filter = rows => (rows || []).filter(row => !championshipOnly || row.isChampionship);
        const previous = filter(previousOrder), current = filter(currentOrder);
        const prevPos = new Map(previous.map((row, index) => [key(row), index]));
        const currPos = new Map(current.map((row, index) => [key(row), index]));
        return current.filter(row => prevPos.has(key(row))).map(row => {
            let madeOverall = 0, takenOverall = 0;
            previous.forEach(other => {
                if (key(other) === key(row) || !currPos.has(key(other))) return;
                const wasAhead = prevPos.get(key(row)) < prevPos.get(key(other));
                const isAhead = currPos.get(key(row)) < currPos.get(key(other));
                if (!wasAhead && isAhead) madeOverall += 1;
                if (wasAhead && !isAhead) takenOverall += 1;
            });
            return { ...row, madeOverall, takenOverall, balanceOverall: madeOverall - takenOverall };
        });
    }
    function gridSnapshot(gridRows, participants, officialIds) {
        const known = new Map((participants || []).map(row => [key(row), row]));
        return (gridRows || []).map((row, index) => {
            const merged = { ...(known.get(key(row)) || {}), ...row };
            return { ...merged, positionOverall: index + 1, isChampionship: officialIds.has(identity.getPilotUid(merged) || identity.getDriverId(merged)) };
        });
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
        const snapshots = gerarSnapshots(voltas, officialRows, gridRows);
        const grid = gridSnapshot(gridRows, [...participants.values()], new Set(idsCampeonato));
        const transitions = grid.length ? [{ lap: 0, positions: grid, drivers: grid }, ...snapshots] : snapshots;
        const firstLapChanges = transitions.length > 1 ? calculatePositionChangesBetweenSnapshots(transitions[0].positions, transitions[1].positions, false) : [];
        firstLapChanges.forEach(change => {
            const gridPosition = grid.findIndex(row => key(row) === key(change)) + 1;
            const firstLapPosition = snapshots[0]?.positions?.findIndex(row => key(row) === key(change)) + 1;
            if (grid.length === snapshots[0]?.positions?.length && change.balanceOverall !== gridPosition - firstLapPosition) console.warn("[Kart/FirstLap] inconsistência", { pilot_uid: identity.getPilotUid(change), gridPosition, firstLapPosition, ...change });
        });
        return { analyticsVersion: VERSION, participants: [...participants.values()], regularidade: regularidade.items, gridPace: regularidade.gridPace, snapshots, firstLapChanges, ultrapassagensCampeonato: calcularUltrapassagens(transitions, true, [...participants.values()]), ultrapassagensGeral: calcularUltrapassagens(transitions, false, [...participants.values()]) };
    }
    function consolidarPilotAnalytics(rows, { campeonatoId = "", etapaId = "all" } = {}) {
        const stages = (rows || []).filter(row => (!campeonatoId || row.campeonato_id === campeonatoId) && (!etapaId || etapaId === "all" || row.etapa_id === etapaId));
        return {
            stages,
            kpis: {
                races: stages.length,
                wins: stages.filter(row => row.achievements?.win).length,
                podiums: stages.filter(row => row.achievements?.podium).length,
                poles: stages.filter(row => row.achievements?.pole).length,
                points: stages.reduce((sum, row) => sum + Number(row.result?.points || 0), 0),
                titles: 0
            }
        };
    }
    return { VERSION, MIN_CLEAN_LAPS, toNullableNumber: num, normalizePilotUid, normalizePilotAnalyticsForHighlights, regularityIsValid, calcularRegularidade, gerarSnapshots, filtrarSnapshot, calcularUltrapassagens, calculatePositionChangesBetweenSnapshots, processarVoltasEtapa, consolidarPilotAnalytics, getOfficialHighlightCandidates, getOfficialMetricCandidates, validateHighlights, buildStageHighlights, buildChampionshipHighlights, championshipSnapshotRows };
}));
