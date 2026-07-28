(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    root.FirestoreIntegrity = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    function requireFirestoreId(value, label, context = {}) {
        const id = String(value ?? "").trim();
        if (!id) {
            console.error(`[Kart/Reprocess] Firestore ID vazio: ${label}`, context);
            throw new Error(`${label} obrigatório ausente no reprocessamento (${JSON.stringify(context)})`);
        }
        return id;
    }

    function canonicalStageNumber(value) {
        const match = String(value ?? "").trim().match(/(\d+)/);
        return match ? Number(match[1]) : null;
    }

    function validateStageAnalytics({ officialDrivers = [], regularity = [], qualifying = [], overtakes = [], pilotAnalytics = [], snapshots = [] }, getId) {
        const ids = rows => new Set((rows || []).map(getId).filter(Boolean));
        const expected = ids(officialDrivers);
        const report = { officialDrivers: expected.size, result: expected.size, regularity: ids(regularity).size, qualifying: ids(qualifying).size, overtakes: ids(overtakes).size, pilotAnalytics: ids(pilotAnalytics).size, snapshots: [] };
        report.snapshots = (snapshots || []).map(snapshot => {
            const actual = ids(snapshot.positions || snapshot.drivers);
            return { lap: snapshot.lap || snapshot.numeroVolta, championshipDriverCount: [...actual].filter(id => expected.has(id)).length, missing: [...expected].filter(id => !actual.has(id)), extras: [...actual].filter(id => !expected.has(id)) };
        });
        return report;
    }

    return { requireFirestoreId, canonicalStageNumber, validateStageAnalytics };
}));
