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
        if (typeof item === "string") return item.trim();
        return String(
            item?.driver_name ||
            item?.nome ||
            item?.piloto ||
            item?.name ||
            item?.display_name ||
            item?.displayName ||
            item?.piloto_original ||
            ""
        ).trim();
    }

    function cleanDriverDisplayName(value) {
        let text = String(value || "")
            .replace(/\u00a0/g, " ")
            .replace(/[‐‑‒–—−]/g, "-")
            .replace(/\s+/g, " ")
            .trim();

        if (!text) return "";

        // IDs do piloto nunca fazem parte do nome mostrado.
        text = text.replace(/\[\s*[^\]]+\s*\]/g, " ").replace(/\s+/g, " ").trim();

        // O cabeçalho do volta a volta costuma vir como:
        // "034 - LEONARDO LEMES - RENTAL". Trabalhar por segmentos torna a
        // limpeza tolerante a hífens extras e dados antigos já persistidos.
        let parts = text.split(/\s+-\s+/).map(part => part.trim()).filter(Boolean);
        while (parts.length && /^\d{1,4}$/.test(parts[0])) parts.shift();
        while (parts.length && /^RENTAL(?:\s+.*)?$/i.test(parts[parts.length - 1])) parts.pop();
        text = parts.join(" - ");

        // Fallbacks para formatos sem espaços ao redor do hífen.
        text = text
            .replace(/^\s*\d{1,4}\s*-\s*/u, "")
            .replace(/(?:\s*-\s*)?\bRENTAL\b(?:\s*-\s*)*$/iu, "")
            .replace(/^\s*-+|-+\s*$/gu, "")
            .replace(/\s+/gu, " ")
            .trim();

        return text;
    }

    function getDriverDisplayName(item) {
        return cleanDriverDisplayName(getDriverName(item));
    }

    function getDriverShortDisplayName(item, maxWords = 2) {
        const full = getDriverDisplayName(item);
        if (!full) return "";
        const limit = Math.max(1, Number(maxWords) || 2);
        return full.split(/\s+/u).slice(0, limit).join(" ");
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

    function normalizeKartNumber(value) {
        const digits = String(value ?? "").trim().replace(/\D/g, "");
        return digits ? digits.padStart(3, "0") : "";
    }

    // The stage result is the only authority here. Registry rows must never add
    // somebody who did not take part in this race.
    function createStageDriverMap(resultRows) {
        const official = getStageChampionshipDrivers(resultRows);
        const byDriverId = new Map();
        const names = new Map();
        const byKartNumber = new Map();
        official.drivers.forEach(row => {
            const driverId = getDriverId(row);
            const name = getDriverName(row);
            const normalizedName = normalizeDriverName(name);
            const kartNumber = normalizeKartNumber(row.kart_numero || row.kart);
            const driver = { ...row, driverId, name, kartNumber };
            if (driverId) byDriverId.set(driverId, driver);
            if (normalizedName) {
                if (!names.has(normalizedName)) names.set(normalizedName, []);
                names.get(normalizedName).push(driver);
            }
            if (kartNumber) {
                if (!byKartNumber.has(kartNumber)) byKartNumber.set(kartNumber, []);
                byKartNumber.get(kartNumber).push(driver);
            }
        });
        return { drivers: official.drivers, ids: official.ids, byDriverId, byNormalizedName: names, byKartNumber };
    }

    function resolveStageLapParticipant(participant, stageMap, persistedLinks = []) {
        const fileId = getDriverId(participant);
        const normalizedName = normalizeDriverName(getDriverName(participant));
        const kartNumber = normalizeKartNumber(participant?.kart_numero || participant?.kart);
        let resolved = fileId ? stageMap.byDriverId.get(fileId) : null;
        let resolution = resolved ? "file_driver_id" : "";

        if (!resolved) {
            const link = (persistedLinks || []).find(item => {
                const sameFileId = fileId && getDriverId(item) === fileId;
                const sameName = normalizedName && normalizeDriverName(getDriverName(item)) === normalizedName;
                const sameKart = kartNumber && normalizeKartNumber(item.kart_numero || item.kart) === kartNumber;
                return sameFileId || (sameName && (!kartNumber || sameKart));
            });
            const linkedId = getDriverId(link);
            if (linkedId) { resolved = stageMap.byDriverId.get(linkedId); resolution = resolved ? "persisted_link" : ""; }
        }
        // A valid canonical id can live in an alias field even when driver_id is absent.
        if (!resolved) {
            const canonicalId = normalizeDriverId(participant?.piloto_doc_id || participant?.pilotoVinculadoDocId);
            resolved = canonicalId ? stageMap.byDriverId.get(canonicalId) : null;
            if (resolved) resolution = "canonical_registry_id";
        }
        if (!resolved && normalizedName) {
            const matches = stageMap.byNormalizedName.get(normalizedName) || [];
            if (matches.length === 1) { resolved = matches[0]; resolution = "unique_stage_name"; }
            else if (kartNumber) {
                const confirmed = matches.filter(item => item.kartNumber === kartNumber);
                if (confirmed.length === 1) { resolved = confirmed[0]; resolution = "stage_name_and_kart"; }
            }
        }
        return { resolved, resolution, fileId, normalizedName, kartNumber };
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

    return { normalizeDriverId, normalizeDriverName, normalizeKartNumber, getDriverId, getDriverName, cleanDriverDisplayName, getDriverDisplayName, getDriverShortDisplayName, driverKey, getStageReferenceRows, getStageChampionshipDrivers, createStageDriverMap, resolveStageLapParticipant, isChampionshipDriver, compareStageDriverIds };
}));
