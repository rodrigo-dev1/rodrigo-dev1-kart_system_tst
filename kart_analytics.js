(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    root.KartAnalytics = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    const VERSION = 5;
    const num = value => {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    };
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
        const expected = idsOficiais instanceof Set
            ? new Set([...idsOficiais].map(normalizeDriverId).filter(Boolean))
            : new Set((idsOficiais || []).map(normalizeDriverId).filter(Boolean));
        return rows.filter(item => expected.has(identity.getDriverId(item))).map((item, index) => ({
            ...item,
            positionChampionship: index + 1
        }));
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
    function gerarSnapshots(voltas, idsCampeonato) {
        const oficiais = new Set((idsCampeonato || []).map(normalizeDriverId).filter(Boolean));
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
        return numeros.map(numeroVolta => {
            const passagem = [];
            grupos.forEach((laps, driverId) => {
                const candidatas = laps.filter(l => Number(l.volta_lider) <= numeroVolta);
                const lap = candidatas[candidatas.length - 1];
                if (lap) passagem.push({ driver_id: identity.getDriverId(lap), driver_name: lap.driver_name || driverId, kart_numero: lap.kart_numero || "", completedLaps: Number(lap.volta), leaderLap: numeroVolta, elapsedTime: num(lap.elapsed_time), lapTime: num(lap.tempo_volta_segundos), isChampionship: oficiais.has(identity.getDriverId(lap)) });
            });
            passagem.sort((a, b) => b.completedLaps - a.completedLaps || a.elapsedTime - b.elapsedTime);
            let oficialPos = 0;
            passagem.forEach((p, index) => {
                p.positionOverall = index + 1;
                p.positionChampionship = p.isChampionship ? ++oficialPos : null;
                const positionKey = p.driver_id || `name:${identity.normalizeDriverName(p.driver_name)}`;
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
            anterior = new Map(passagem.map(p => [p.driver_id || `name:${identity.normalizeDriverName(p.driver_name)}`, p]));
            return { lap: numeroVolta, numeroVolta, drivers: passagem, positions: passagem };
        });
    }
    function calcularUltrapassagens(snapshots, championshipOnly, participants = []) {
        const result = new Map();
        (participants || []).filter(p => !championshipOnly || p.isChampionship).forEach(p => {
            const id = identity.getDriverId(p) || key(p);
            if (id) result.set(id, { driver_id: identity.getDriverId(p), driver_name: identity.getDriverName(p), isChampionship: p.isChampionship === true, feitas: 0, tomadas: 0, saldo: 0 });
        });
        (snapshots || []).forEach((snapshot, snapshotIndex) => {
            snapshot.positions.filter(p => !championshipOnly || p.isChampionship).forEach(p => {
                const resultKey = p.driver_id || `name:${identity.normalizeDriverName(p.driver_name)}`;
                if (!result.has(resultKey)) result.set(resultKey, { driver_id: p.driver_id, driver_name: p.driver_name, isChampionship: p.isChampionship === true, feitas: 0, tomadas: 0, saldo: 0 });
                if (!snapshotIndex) return; // primeira classificação é somente a referência da largada
                const delta = championshipOnly ? p.positionDeltaChampionship : p.positionDeltaOverall;
                if (delta > 0) result.get(resultKey).feitas += delta;
                if (delta < 0) result.get(resultKey).tomadas += Math.abs(delta);
            });
        });
        return [...result.values()].map(i => ({ ...i, saldo: i.feitas - i.tomadas }));
    }
    function processarVoltasEtapa(voltas, officialDrivers = []) {
        const officialRows = (officialDrivers || []).map(item => typeof item === "object" ? item : { driver_id: item });
        const idsCampeonato = officialRows.map(identity.getDriverId).filter(Boolean);
        const participants = new Map();
        (voltas || []).forEach(v => { const k = key(v); if (k && !participants.has(k)) participants.set(k, { ...v, isChampionship: idsCampeonato.includes(identity.getDriverId(v)) }); });
        officialRows.forEach(row => { const k = key(row); if (k && !participants.has(k)) participants.set(k, { ...row, isChampionship: true }); });
        const regularidade = calcularRegularidade(voltas);
        const regularityKeys = new Set(regularidade.items.map(key));
        participants.forEach((p, k) => { if (!regularityKeys.has(k)) regularidade.items.push({ driver_id: identity.getDriverId(p), driver_name: identity.getDriverName(p), kart_numero: p.kart_numero || "", isChampionship: p.isChampionship, regularidade: null, pace: null, bestLap: null, bestLapValid: null, cleanLaps: 0, cleanLapsCount: 0, totalLaps: 0, cleanLapNumbers: [], excludedLapNumbers: [], laps: [], status: "voltas_insuficientes" }); });
        const snapshots = gerarSnapshots(voltas, idsCampeonato);
        return { analyticsVersion: VERSION, participants: [...participants.values()], regularidade: regularidade.items, gridPace: regularidade.gridPace, snapshots, ultrapassagensCampeonato: calcularUltrapassagens(snapshots, true, [...participants.values()]), ultrapassagensGeral: calcularUltrapassagens(snapshots, false, [...participants.values()]) };
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
    return { VERSION, calcularRegularidade, gerarSnapshots, filtrarSnapshot, calcularUltrapassagens, processarVoltasEtapa, consolidarPilotAnalytics };
}));
