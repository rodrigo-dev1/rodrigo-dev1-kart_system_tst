(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    root.KartAnalytics = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    const VERSION = 1;
    const num = value => {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    };
    const key = item => String(item.driver_id || item.id_piloto || item.driver_name || "").trim();
    const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    const stddev = values => {
        const avg = mean(values);
        return avg === null ? null : Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length);
    };
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
            const bestLap = validas.length ? Math.min(...validas.map(l => num(l.tempo_volta_segundos))) : null;
            const limpas = bestLap === null ? [] : validas.filter(l => num(l.tempo_volta_segundos) <= bestLap * 1.05);
            const tempos = limpas.map(l => num(l.tempo_volta_segundos));
            const pace = mean(tempos);
            const regularidade = stddev(tempos);
            const base = laps[0] || {};
            return {
                driver_id: driverId, driver_name: base.driver_name || driverId, kart_numero: base.kart_numero || "",
                bestLap, pace, regularidade, cleanLaps: limpas.length, totalLaps: laps.length,
                laps: [...laps].sort((a, b) => Number(a.volta) - Number(b.volta)).map(l => ({
                    volta: Number(l.volta), tempo: num(l.tempo_volta_segundos), clean: limpas.includes(l), isBest: num(l.tempo_volta_segundos) === bestLap
                }))
            };
        });
        const gridPace = mean(items.map(i => i.pace).filter(Number.isFinite));
        return { items, gridPace };
    }
    function gerarSnapshots(voltas, idsCampeonato) {
        const oficiais = new Set((idsCampeonato || []).map(String));
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
                if (lap) passagem.push({ driver_id: driverId, driver_name: lap.driver_name || driverId, kart_numero: lap.kart_numero || "", completedLaps: Number(lap.volta), leaderLap: numeroVolta, elapsedTime: num(lap.elapsed_time), lapTime: num(lap.tempo_volta_segundos), isChampionship: oficiais.has(driverId) });
            });
            passagem.sort((a, b) => b.completedLaps - a.completedLaps || a.elapsedTime - b.elapsedTime);
            let oficialPos = 0;
            passagem.forEach((p, index) => {
                p.positionOverall = index + 1;
                p.positionChampionship = p.isChampionship ? ++oficialPos : null;
                const old = anterior.get(p.driver_id);
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
            anterior = new Map(passagem.map(p => [p.driver_id, p]));
            return { numeroVolta, positions: passagem };
        });
    }
    function calcularUltrapassagens(snapshots, championshipOnly) {
        const result = new Map();
        (snapshots || []).forEach((snapshot, snapshotIndex) => {
            snapshot.positions.filter(p => !championshipOnly || p.isChampionship).forEach(p => {
                if (!result.has(p.driver_id)) result.set(p.driver_id, { driver_id: p.driver_id, driver_name: p.driver_name, feitas: 0, tomadas: 0, saldo: 0 });
                if (!snapshotIndex) return; // primeira classificação é somente a referência da largada
                const delta = championshipOnly ? p.positionDeltaChampionship : p.positionDeltaOverall;
                if (delta > 0) result.get(p.driver_id).feitas += delta;
                if (delta < 0) result.get(p.driver_id).tomadas += Math.abs(delta);
            });
        });
        return [...result.values()].map(i => ({ ...i, saldo: i.feitas - i.tomadas }));
    }
    function processarVoltasEtapa(voltas, idsCampeonato) {
        const regularidade = calcularRegularidade(voltas);
        const snapshots = gerarSnapshots(voltas, idsCampeonato);
        return { analyticsVersion: VERSION, regularidade: regularidade.items, gridPace: regularidade.gridPace, snapshots, ultrapassagensCampeonato: calcularUltrapassagens(snapshots, true), ultrapassagensGeral: calcularUltrapassagens(snapshots, false) };
    }
    return { VERSION, calcularRegularidade, gerarSnapshots, calcularUltrapassagens, processarVoltasEtapa };
}));
