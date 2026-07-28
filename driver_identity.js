(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    root.DriverIdentity = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    function normalizeDriverId(value) {
        if (value === null || value === undefined) return "";
        return String(value).trim().replace(/^\[/, "").replace(/\]$/, "").trim();
    }

    function getDriverId(item) {
        if (!item || typeof item !== "object") return "";
        for (const field of ["driver_id", "driverId", "id_piloto", "idPiloto"]) {
            const id = normalizeDriverId(item[field]);
            if (id) return id;
        }
        return "";
    }

    function normalizeDriverName(value) {
        return String(value || "")
            .replace(/^\s*\d+\s*-\s*/, "")
            .replace(/\[\s*[^\]]+\s*\]/g, " ")
            .replace(/\s*-\s*RENTAL\s*$/i, "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .toUpperCase();
    }

    function getDriverName(item) {
        return String(item?.driver_name || item?.nome || item?.piloto || "").trim();
    }

    function driverKey(item) {
        const id = getDriverId(item);
        return id ? `id:${id}` : (normalizeDriverName(getDriverName(item)) ? `name:${normalizeDriverName(getDriverName(item))}` : "");
    }

    function getStageChampionshipDrivers(resultRows, registeredDrivers = []) {
        const rows = Array.isArray(resultRows) && resultRows.length ? resultRows : registeredDrivers;
        const byKey = new Map();
        rows.forEach(item => {
            const key = driverKey(item);
            if (key && !byKey.has(key)) byKey.set(key, item);
        });
        const drivers = [...byKey.values()];
        return {
            drivers,
            ids: new Set(drivers.map(getDriverId).filter(Boolean)),
            // O conjunto de nomes pode conter todos os oficiais; ele só é
            // consultado por isChampionshipDriver quando o item comparado não
            // possui ID. Assim o fallback legado nunca suplanta um ID válido.
            legacyNames: new Set(drivers.map(item => normalizeDriverName(getDriverName(item))).filter(Boolean))
        };
    }

    // A tabela "Resultado da Etapa" e hidratada de dashboardResumo.corrida.
    // Portanto, quando esse resumo existe, ele precisa preceder a subcollection
    // (que pode ter sido parcialmente sobrescrita por uma importacao antiga).
    function getStageReferenceRows(stageDocument, resultRows = [], classificationRows = []) {
        const persistedResult = stageDocument?.dashboardResumo?.corrida;
        if (Array.isArray(persistedResult) && persistedResult.length) return persistedResult;
        if (Array.isArray(resultRows) && resultRows.length) return resultRows;
        const persistedClassification = stageDocument?.dashboardResumo?.classificacao;
        if (Array.isArray(persistedClassification) && persistedClassification.length) return persistedClassification;
        return Array.isArray(classificationRows) ? classificationRows : [];
    }

    function isChampionshipDriver(item, official) {
        const id = getDriverId(item);
        if (id) return official?.ids?.has(id) || false;
        const name = normalizeDriverName(getDriverName(item));
        return !!name && (official?.legacyNames?.has(name) || false);
    }

    function compareStageDriverIds(resultRows, snapshotRows, filteredRows) {
        const ids = rows => new Set((rows || []).map(getDriverId).filter(Boolean));
        const resultIds = ids(resultRows), snapshotIds = ids(snapshotRows), filteredIds = ids(filteredRows);
        const expected = new Set([...resultIds].filter(id => snapshotIds.has(id)));
        return {
            expectedCount: resultIds.size,
            lapCount: snapshotIds.size,
            expectedInLapCount: expected.size,
            actualCount: filteredIds.size,
            expected: [...expected],
            missing: [...expected].filter(id => !filteredIds.has(id)),
            unexpected: [...filteredIds].filter(id => !expected.has(id))
        };
    }

    return { normalizeDriverId, normalizeDriverName, getDriverId, getDriverName, driverKey, getStageReferenceRows, getStageChampionshipDrivers, isChampionshipDriver, compareStageDriverIds };
}));
