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
        return cleanDriverDisplayName(value)
            .replace(/\[\s*[^\]]+\s*\]/g, " ")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
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
        const pilotUid = getPilotUid(item);
        if (pilotUid) return `pilot:${pilotUid}`;
        const id = getDriverId(item);
        return id ? `id:${id}` : (normalizeDriverName(getDriverName(item)) ? `name:${normalizeDriverName(getDriverName(item))}` : "");
    }

    function getPilotUid(item) {
        if (!item || typeof item !== "object") return "";
        return String(item.pilot_uid || item.pilotUid || "").trim();
    }

    // Deterministic 64-bit hash represented by 16 hexadecimal characters. The
    // namespace in the input (driver:/name:) is part of the digest and the kart
    // number is deliberately never used.
    function stableHash(value) {
        const text = String(value || "");
        let h1 = 0xdeadbeef ^ text.length, h2 = 0x41c6ce57 ^ text.length;
        for (let i = 0; i < text.length; i += 1) {
            const ch = text.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
    }

    function generatePilotUid({ driver_id, driverId, driver_name, name, normalized_name } = {}) {
        const externalId = normalizeDriverId(driver_id || driverId);
        const normalizedName = normalizeDriverName(normalized_name || driver_name || name);
        if (!externalId && !normalizedName) throw new Error("Não é possível gerar pilot_uid sem driver_id ou nome");
        return `p_${stableHash(externalId ? `driver:${externalId}` : `name:${normalizedName}`)}`;
    }

    function ensurePilotUid(item) {
        const existing = getPilotUid(item);
        if (existing) return existing;
        return generatePilotUid({ ...item, driver_name: getDriverName(item) });
    }

    function findPilotByExternalId(identities, externalId) {
        const id = normalizeDriverId(externalId);
        if (!id) return null;
        return (identities || []).find(identity => getDriverId(identity) === id || (identity.external_ids || []).map(normalizeDriverId).includes(id)) || null;
    }

    function findPilotByNormalizedName(identities, name) {
        const normalized = normalizeDriverName(name);
        return normalized ? (identities || []).filter(identity => normalizeDriverName(identity.normalized_name || getDriverName(identity)) === normalized) : [];
    }

    function mergePilotIdentity(identity, observation, now = new Date().toISOString()) {
        const externalId = getDriverId(observation);
        const originalName = getDriverName(observation);
        const displayName = cleanDriverDisplayName(originalName) || identity.driver_name_display || "";
        const aliases = [...new Set([...(identity.aliases || []), originalName, displayName].map(v => String(v || "").trim()).filter(Boolean))];
        const externalIds = [...new Set([...(identity.external_ids || []), identity.driver_id, externalId].map(normalizeDriverId).filter(Boolean))];
        return {
            ...identity,
            pilot_uid: ensurePilotUid(identity),
            driver_id: normalizeDriverId(identity.driver_id) || externalId || null,
            driver_name_display: identity.driver_name_display || displayName,
            normalized_name: identity.normalized_name || normalizeDriverName(displayName),
            aliases,
            external_ids: externalIds,
            createdAtISO: identity.createdAtISO || now,
            updatedAtISO: now
        };
    }

    function resolvePilotIdentity(observation, identities = [], options = {}) {
        const externalId = getDriverId(observation);
        const originalName = getDriverName(observation);
        const normalizedName = normalizeDriverName(originalName);
        let identity = findPilotByExternalId(identities, externalId);
        let resolution = identity ? "external_id" : "";
        if (!identity && normalizedName) {
            const matches = findPilotByNormalizedName(identities, normalizedName);
            if (matches.length === 1) { identity = matches[0]; resolution = "normalized_name"; }
            else if (matches.length > 1) {
                const warning = { code: "AMBIGUOUS_IDENTITY", message: "Identidade ambígua", normalized_name: normalizedName, candidates: matches.map(getPilotUid) };
                if (typeof options.onWarning === "function") options.onWarning(warning);
                // Never merge ambiguous names. A new external ID can safely
                // establish an independent identity; otherwise use a stable
                // ambiguity namespace so processing remains idempotent.
                const seed = externalId ? `driver:${externalId}` : `ambiguous:${normalizedName}:${options.disambiguator || "unknown"}`;
                identity = { pilot_uid: `p_${stableHash(seed)}` };
                resolution = "ambiguous_new";
            }
        }
        if (!identity) {
            identity = { pilot_uid: generatePilotUid({ driver_id: externalId, normalized_name: normalizedName }) };
            resolution = "created";
        }
        const merged = mergePilotIdentity(identity, observation, options.now);
        const normalized = {
            ...observation,
            pilot_uid: merged.pilot_uid,
            driver_id: merged.driver_id || null,
            id_piloto: merged.driver_id || null,
            driver_name_original: originalName,
            driver_name_display: cleanDriverDisplayName(originalName) || merged.driver_name_display,
            driver_name: cleanDriverDisplayName(originalName) || merged.driver_name_display,
            normalized_name: merged.normalized_name,
            kart_numero: normalizeKartNumber(observation?.kart_numero || observation?.kart)
        };
        return { identity: merged, pilot: normalized, resolution };
    }

    function getStageChampionshipDrivers(resultRows, registeredDrivers = []) {
        const registryByName = new Map();
        (registeredDrivers || []).forEach(driver => {
            const name = normalizeDriverName(getDriverName(driver));
            const id = getDriverId(driver);
            if (!name || !id) return;
            if (!registryByName.has(name)) registryByName.set(name, []);
            registryByName.get(name).push(driver);
        });
        // Resultado da Etapa define os membros. O cadastro serve apenas para
        // hidratar o driver_id de linhas legadas, nunca para adicionar membros.
        const source = Array.isArray(resultRows) && resultRows.length ? resultRows : registeredDrivers;
        const rows = source.map(row => {
            if (getDriverId(row)) return row;
            const matches = registryByName.get(normalizeDriverName(getDriverName(row))) || [];
            return matches.length === 1 ? { ...row, driver_id: getDriverId(matches[0]), identityResolution: "unique_registry_name" } : row;
        });
        const byKey = new Map();
        rows.forEach(item => {
            let normalized = item;
            try {
                const pilotUid = ensurePilotUid(item);
                normalized = { ...item, pilot_uid: pilotUid, driver_id: getDriverId(item) || null };
            } catch (_) { /* an empty legacy row is ignored below */ }
            const key = driverKey(normalized);
            if (key && !byKey.has(key)) byKey.set(key, normalized);
        });
        const drivers = [...byKey.values()];
        return {
            drivers,
            uids: new Set(drivers.map(getPilotUid).filter(Boolean)),
            ids: new Set(drivers.map(getDriverId).filter(Boolean)),
            // O conjunto de nomes pode conter todos os oficiais; ele só é
            // consultado por isChampionshipDriver quando o item comparado não
            // possui ID. Assim o fallback legado nunca suplanta um ID válido.
            legacyNames: new Set(drivers.map(item => normalizeDriverName(getDriverName(item))).filter(Boolean))
        };
    }

    function getOfficialStageDriverIds(resultRows, registeredDrivers = []) {
        const official = getStageChampionshipDrivers(resultRows, registeredDrivers);
        const missingDriverIds = official.drivers.filter(driver => !getDriverId(driver));
        return { ...official, missingDriverIds };
    }

    // Filtra a lista da tomada, preservando estritamente a ordem do arquivo.
    function filterStageQualifying(classificationRows, official) {
        const rows = [...(classificationRows || [])].sort((a, b) => {
            const position = item => {
                for (const value of [item.positionOverall, item.posicao_geral_arquivo, item.posicao_final, item.posicao, item.pos]) {
                    const n = Number(value);
                    if (Number.isFinite(n) && n > 0) return n;
                }
                return Number.MAX_SAFE_INTEGER;
            };
            return position(a) - position(b);
        });
        return filterStageChampionshipDrivers(rows, official).map((item, index) => ({
            ...item,
            positionOverall: Number(item.positionOverall || item.posicao_geral_arquivo || item.posicao_final || item.posicao || item.pos) || null,
            positionChampionship: index + 1,
            posicao_classificacao_campeonato: index + 1,
            posicao_largada_campeonato: index + 1
        }));
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
        return { drivers: official.drivers, ids: official.ids, uids: official.uids, byDriverId, byNormalizedName: names, byKartNumber };
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
        const pilotUid = getPilotUid(item);
        if (pilotUid && official?.uids) return official.uids.has(pilotUid);
        const id = getDriverId(item);
        if (id) return official?.ids?.has(id) || false;
        const name = normalizeDriverName(getDriverName(item));
        return !!name && (official?.legacyNames?.has(name) || false);
    }

    // Filtro unico para qualquer visualizacao da etapa. Um ID presente (mesmo
    // que desconhecido) nunca cai no fallback de nome: o fallback existe
    // somente para registros legados que realmente nao possuem driver_id.
    function filterStageChampionshipDrivers(rows, official) {
        return (Array.isArray(rows) ? rows : []).filter(item => isChampionshipDriver(item, official));
    }

    // Regularidade e ultrapassagens precisam manter os pilotos oficiais mesmo
    // quando o analytics antigo nao possui uma linha para um deles.
    function reconcileStageChampionshipDrivers(rows, official, createMissing) {
        const source = Array.isArray(rows) ? rows : [];
        const filtered = filterStageChampionshipDrivers(source, official);
        const byId = new Map(filtered.map(item => [getDriverId(item), item]).filter(([id]) => id));
        const byName = new Map(filtered
            .filter(item => !getDriverId(item))
            .map(item => [normalizeDriverName(getDriverName(item)), item])
            .filter(([name]) => name));
        return (official?.drivers || []).map(driver => {
            const id = getDriverId(driver);
            const match = (id && byId.get(id)) || (!id && byName.get(normalizeDriverName(getDriverName(driver))));
            return match || (typeof createMissing === "function" ? createMissing(driver) : driver);
        });
    }

    function compareDriverIdSets(officialRows, actualRows) {
        const expected = new Set((officialRows || []).map(getDriverId).filter(Boolean));
        const actual = new Set((actualRows || []).map(getDriverId).filter(Boolean));
        return {
            expectedCount: expected.size,
            actualCount: actual.size,
            expected: [...expected],
            actual: [...actual],
            missing: [...expected].filter(id => !actual.has(id)),
            extra: [...actual].filter(id => !expected.has(id))
        };
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

    return { normalizeDriverId, normalizeDriverName, normalizeKartNumber, getDriverId, getPilotUid, getDriverName, cleanDriverDisplayName, getDriverDisplayName, getDriverShortDisplayName, driverKey, stableHash, generatePilotUid, ensurePilotUid, findPilotByExternalId, findPilotByNormalizedName, mergePilotIdentity, resolvePilotIdentity, getStageReferenceRows, getStageChampionshipDrivers, getOfficialStageDriverIds, filterStageQualifying, createStageDriverMap, resolveStageLapParticipant, isChampionshipDriver, filterStageChampionshipDrivers, reconcileStageChampionshipDrivers, compareDriverIdSets, compareStageDriverIds };
}));
