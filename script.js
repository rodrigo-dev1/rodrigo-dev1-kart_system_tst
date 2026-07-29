const firebaseConfig = {
    apiKey: "AIzaSyC_ruvtoN9KFp9K4cuJeL17Z_KVN9tTO5s",
    authDomain: "kart-v1.firebaseapp.com",
    projectId: "kart-v1",
    storageBucket: "kart-v1.firebasestorage.app",
    messagingSenderId: "524238423587",
    appId: "1:524238423587:web:39d9d17963b4ee59ef5396",
    measurementId: "G-C1EG0T5VS8"
};

firebase.initializeApp(firebaseConfig);
const firestore = firebase.firestore();

const COLLECTION_CAMPEONATOS = "campeonato";
const COLLECTION_PILOTOS = "Pilotos";
const COLLECTION_BACKUPS = "backups_importacao";
const COLLECTION_PILOT_IDENTITIES = "pilot_identities";
const NORMALIZATION_VERSION = 2;

const SENHA_ADMIN = "123456";

let DB = {
    campeonatos: [],
    pilotos: [],
    resultados: []
};

let HISTORICO_CACHE = [];
let abaGestaoAtual = "campeonatos";
let campeonatoEditando = null;
let pilotoEditando = null;

let IMPORTACAO_PREVIA = [];
let IMPORTACAO_PYSCRIPT = [];
let IMPORTACAO_PYSCRIPT_ARQUIVO = "";
let IMPORTACAO_PYSCRIPT_TIPO = "";
let IMPORTACAO_PREVIA_GERADA = false;

let RANKING_FIRESTORE_CACHE = [];
let RANKING_ABA_ATUAL = "pilotos";
let RANKING_CORRIDA_ABA_ATUAL = "corrida";
let HISTORIAS_UI_CACHE = {};

function pedirSenhaAdmin() {
    return new Promise(resolve => {
        const overlay = document.createElement("div");
        overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:1000000;display:flex;align-items:center;justify-content:center;padding:16px;";
        overlay.innerHTML = `<div style="width:100%;max-width:360px;background:#1d2129;border:1px solid #394150;border-radius:12px;padding:14px;">
            <h3 style="margin:0 0 8px 0;">Senha administrativa</h3>
            <input id="senhaAdminInput" type="password" placeholder="Digite a senha" style="width:100%;padding:12px;background:#333;border:1px solid #444;color:white;border-radius:8px;box-sizing:border-box;">
            <div style="display:flex;gap:8px;margin-top:10px;">
                <button id="senhaCancelar" style="background:#2b3240;border:1px solid #3a4252;">Cancelar</button>
                <button id="senhaConfirmar">Confirmar</button>
            </div>
        </div>`;
        document.body.appendChild(overlay);
        const input = overlay.querySelector("#senhaAdminInput");
        const fechar = ok => {
            overlay.remove();
            resolve(ok);
        };
        overlay.querySelector("#senhaCancelar")?.addEventListener("click", () => fechar(false));
        overlay.querySelector("#senhaConfirmar")?.addEventListener("click", () => {
            if ((input?.value || "") !== SENHA_ADMIN) {
                alert("Senha inválida.");
                return;
            }
            fechar(true);
        });
        input?.addEventListener("keydown", ev => {
            if (ev.key === "Enter") overlay.querySelector("#senhaConfirmar")?.click();
        });
        setTimeout(() => input?.focus(), 0);
    });
}

const PONTOS_PADRAO = {
    1: 20,
    2: 17,
    3: 15,
    4: 13,
    5: 11,
    6: 9,
    7: 7,
    8: 5,
    9: 3,
    10: 1
};

const TIPOS_ARQUIVO = [
    { tipo: "resultado_final", label: "Resultado final", usaPreview: true },
    { tipo: "classificacao", label: "Classificação", usaPreview: true },
    { tipo: "volta_a_volta", label: "Volta a volta", usaPreview: false, usaSelecaoHistoria: true }
];

async function fetchData() {
    const loading = document.getElementById("loading");

    try {
        if (loading) loading.innerHTML = "Sincronizando Firebase...";

        await carregarDadosBaseFirestore();
        popularFiltros();
        renderGestao();
        await inicializarRankingFirestore();

        if (loading) loading.style.display = "none";
    } catch (e) {
        console.error(e);
        if (loading) loading.innerHTML = `Erro ao carregar dados do Firebase: ${htmlEscape(e.message || e)}`;
    }
}

async function carregarDadosBaseFirestore() {
    const campeonatosSnapshot = await firestore.collection(COLLECTION_CAMPEONATOS).get();
    const pilotosSnapshot = await firestore.collection(COLLECTION_PILOTOS).get();

    const campeonatos = [];
    campeonatosSnapshot.forEach(doc => {
        const data = doc.data() || {};
        campeonatos.push({
            ...data,
            id: doc.id,
            nome: data.nome || data.nome_exibicao || doc.id,
            descricao: data.descricao || data["descrição"] || "",
            data_inicio: data.data_inicio || data["data de inicio"] || "",
            data_fim: data.data_fim || data["data de fim"] || ""
        });
    });

    const pilotos = [];
    pilotosSnapshot.forEach(doc => {
        const data = doc.data() || {};
        const docIdComoIdPiloto = /^\d+$/.test(String(doc.id || "")) ? doc.id : "";
        const idPiloto = String(data.id_piloto || data.driver_id || docIdComoIdPiloto || "").trim();
        const nome = data.nome || data.driver_name || "";

        pilotos.push({
            ...data,
            id: doc.id,
            id_piloto: idPiloto,
            driver_id: idPiloto,
            nome,
            driver_name: data.driver_name || nome,
            apelido: data.apelido || "",
            campeonatos: extrairCampeonatosDoPilotoExistente(data),
            vinculos: extrairCampeonatosDoPilotoExistente(data)
        });
    });

    campeonatos.sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")));
    pilotos.sort((a, b) => String(a.nome || a.driver_name || "").localeCompare(String(b.nome || b.driver_name || "")));

    DB = {
        campeonatos,
        pilotos,
        resultados: []
    };
}

function show(id) {
    document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
    const el = document.getElementById(id);
    if (el) el.classList.add("active");

    if (id === "dash") {
        inicializarRankingFirestore();
    }
}

function htmlEscape(v) {
    return String(v ?? "").replace(/[&<>'"]/g, c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;"
    }[c]));
}

function normalizarChave(v) {
    return String(v || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .toLowerCase();
}

function normalizarDocId(v) {
    return normalizarChave(v).replace(/^_+|_+$/g, "").slice(0, 700) || "sem_id";
}

function hojeISO() {
    return new Date().toISOString().slice(0, 10);
}

function formatarDataBR(dataISO) {
    if (!dataISO) return "-";

    const base = String(dataISO).split("T")[0].split(" ")[0];
    const p = base.split("-");

    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : base;
}

function formatarDataISO(dataISO) {
    if (!dataISO) return "";
    return String(dataISO).split("T")[0].split(" ")[0];
}

function paraTimestamp(dataISO) {
    const base = formatarDataISO(dataISO);
    const t = new Date(`${base}T00:00:00Z`).getTime();

    return Number.isNaN(t) ? 0 : t;
}

function extrairDataItem(item) {
    if (item.dataCorrida) return item.dataCorrida;
    if (item.dataUploadISO) return item.dataUploadISO.slice(0, 10);

    const m = String(item.dataUpload || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);

    if (m) return `${m[3]}-${m[2]}-${m[1]}`;

    return hojeISO();
}

function arquivoParaDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;

        reader.readAsDataURL(file);
    });
}

function getPilotoCampo(p, ...keys) {
    const achado = keys.find(k => p && p[k] !== undefined && p[k] !== null);
    return achado ? p[achado] : "";
}

function nomePilotoCurto(driverName = "", driverId = "") {
    const piloto = DB.pilotos.find(p => String(p.id_piloto || p.driver_id || "").trim() === String(driverId || "").trim())
        || DB.pilotos.find(p => String(p.nome || p.driver_name || "").trim().toUpperCase() === String(driverName || "").trim().toUpperCase());

    const apelido = String(piloto?.apelido || "").trim();
    if (apelido) return apelido;
    const nome = String(driverName || "").trim();
    return nome ? nome.split(/\s+/)[0] : "-";
}

function vinculosPiloto(p) {
    const bruto = getPilotoCampo(p, "campeonatos", "vinculos");

    if (Array.isArray(bruto)) {
        return bruto.map(v => String(v || "").trim()).filter(Boolean);
    }

    return String(bruto || "")
        .split(",")
        .map(v => v.trim())
        .filter(Boolean);
}

function normalizarDriverId(driverId) {
    return DriverIdentity.normalizeDriverId(driverId);
}

function getDriverId(item) {
    return DriverIdentity.getDriverId(item);
}

function getPilotUid(item) {
    return DriverIdentity.getPilotUid(item);
}

async function carregarIdentidadesPilotos() {
    const snapshot = await firestore.collection(COLLECTION_PILOT_IDENTITIES).get();
    const identities = snapshot.docs.map(doc => ({ pilot_uid: doc.id, ...(doc.data() || {}) }));
    // Cadastro global legado participa da resolução, mas nunca substitui uma
    // identidade central já aprendida.
    DB.pilotos.forEach(pilot => {
        if (getPilotUid(pilot) && !identities.some(item => getPilotUid(item) === getPilotUid(pilot))) identities.push(pilot);
    });
    return identities;
}

async function resolverPersistirIdentidades(rows, identities = null, context = {}) {
    const registry = identities || await carregarIdentidadesPilotos();
    const normalized = [], changed = new Map(), warnings = [];
    (rows || []).forEach((row, index) => {
        const resolved = DriverIdentity.resolvePilotIdentity(row, registry, {
            disambiguator: `${context.campeonato_id || "global"}:${context.etapa_id || "stage"}:${index}`,
            onWarning: warning => warnings.push({ ...warning, index })
        });
        const current = registry.findIndex(item => getPilotUid(item) === resolved.identity.pilot_uid);
        if (current >= 0) registry[current] = resolved.identity; else registry.push(resolved.identity);
        changed.set(resolved.identity.pilot_uid, resolved.identity);
        normalized.push({ ...resolved.pilot, normalizationVersion: NORMALIZATION_VERSION });
    });
    const batch = firestore.batch();
    changed.forEach((identity, pilotUid) => batch.set(
        firestore.collection(COLLECTION_PILOT_IDENTITIES).doc(FirestoreIntegrity.requireFirestoreId(pilotUid, "pilot_uid", context)),
        toFirestoreSafe(identity), { merge: true }
    ));
    changed.forEach(identity => {
        const matches = DB.pilotos.filter(pilot =>
            (getDriverId(identity) && getDriverId(pilot) === getDriverId(identity)) ||
            (identity.normalized_name && DriverIdentity.normalizeDriverName(DriverIdentity.getDriverName(pilot)) === identity.normalized_name)
        );
        if (matches.length === 1) batch.set(firestore.collection(COLLECTION_PILOTOS).doc(matches[0].id), {
            pilot_uid: identity.pilot_uid,
            driver_id: identity.driver_id || null,
            id_piloto: identity.driver_id || null,
            atualizadoEmISO: identity.updatedAtISO
        }, { merge: true });
    });
    if (changed.size) await batch.commit();
    warnings.forEach(warning => console.warn("[Kart/Identity] Identidade ambígua", { ...context, ...warning }));
    return { rows: normalized, identities: registry, warnings };
}

function pilotosDoCampeonato(campeonato) {
    return DB.pilotos.filter(p => pilotoPertenceAoCampeonato(p, campeonato));
}

// Fonte única da identidade oficial. O vínculo vem sempre do cadastro global do
// piloto; nomes são mantidos apenas para arquivos legados sem driver_id.
function getChampionshipDrivers(campeonato) {
    const pilotos = pilotosDoCampeonato(campeonato).map(p => {
        const driverId = getDriverId(p);
        const nome = String(p.driver_name || p.nome || "").trim();
        return { ...p, driver_id: driverId, id_piloto: driverId, driver_name: nome, nome };
    });
    return {
        pilotos,
        ids: new Set(pilotos.map(p => p.driver_id).filter(Boolean)),
        nomesLegados: new Set(pilotos.map(p => normalizarNomeComparacao(p.driver_name)).filter(Boolean))
    };
}

function isChampionshipDriver(item, campeonatoDrivers) {
    const driverId = getDriverId(item);
    if (driverId) return campeonatoDrivers?.ids?.has(driverId) || false;
    const nome = normalizarNomeComparacao(item?.driver_name || item?.nome || item?.piloto || "");
    return !!nome && (campeonatoDrivers?.nomesLegados?.has(nome) || false);
}

function getTipoArquivoSelecionado() {
    const tipo = document.getElementById("imp_tipo_arquivo")?.value || "";
    return TIPOS_ARQUIVO.find(item => item.tipo === tipo) || null;
}

function isArquivoTexto(file) {
    if (!file) return false;

    const nome = (file.name || "").toLowerCase();
    const mime = (file.type || "").toLowerCase();

    return mime.includes("html") ||
        mime.includes("text") ||
        mime.includes("xml") ||
        nome.endsWith(".html") ||
        nome.endsWith(".htm") ||
        nome.endsWith(".xml") ||
        nome.endsWith(".txt");
}

function limparEstadoImportacao() {
    IMPORTACAO_PREVIA = [];
    IMPORTACAO_PREVIA_GERADA = false;

    const preview = document.getElementById("previewImportacao");
    const btn = document.getElementById("btnConfirmarImportacao");

    if (preview) preview.innerHTML = "";
    if (btn) btn.style.display = "none";
}

function onTipoArquivoImportChange() {
    IMPORTACAO_PYSCRIPT = [];
    IMPORTACAO_PYSCRIPT_ARQUIVO = "";
    IMPORTACAO_PYSCRIPT_TIPO = "";

    const cfg = getTipoArquivoSelecionado();
    const label = document.getElementById("labelFileImportacao");
    const fileInput = document.getElementById("fileImportacaoUnico");
    const pyStatus = document.getElementById("pyStatus");

    limparEstadoImportacao();

    if (fileInput) fileInput.value = "";

    if (!cfg) {
        if (label) label.textContent = "Arquivo";
        if (pyStatus) pyStatus.innerHTML = "Selecione o tipo de arquivo e depois escolha o arquivo.";
        return;
    }

    if (label) label.textContent = `Arquivo — ${cfg.label}`;

    if (pyStatus) {
        if (cfg.tipo === "volta_a_volta") {
            pyStatus.innerHTML = `✅ Tipo selecionado: ${cfg.label}. Escolha o arquivo para listar apenas os pilotos vinculados ao campeonato e gerar as histórias com IA.`;
        } else {
            pyStatus.innerHTML = cfg.usaPreview
                ? `✅ Tipo selecionado: ${cfg.label}. Escolha o arquivo para liberar a lista única de importação abaixo.`
                : `ℹ️ Tipo selecionado: ${cfg.label}. Este arquivo será salvo no Firestore, sem prévia de pilotos.`;
        }
    }
}

window.onTipoArquivoImportChange = onTipoArquivoImportChange;

async function atualizarPreviewImportacaoAtual() {
    const campeonato = document.getElementById("imp_camp")?.value || "";
    const cfg = getTipoArquivoSelecionado();

    if (cfg?.tipo === "volta_a_volta") {
        const file = document.getElementById("fileImportacaoUnico")?.files?.[0];

        if (file) {
            await prepararPreviewVoltaAVoltaSelecionado(file);
            return;
        }
    }

    if (IMPORTACAO_PREVIA.length && campeonato) {
        await marcarPilotosJaVinculadosAoCampeonato(campeonato, true);
    }
}

window.atualizarPreviewImportacaoAtual = atualizarPreviewImportacaoAtual;

function getCampeonatoFirestoreRef(campeonato) {
    const campeonatoDocId = FirestoreIntegrity.requireFirestoreId(normalizarDocId(campeonato), "campeonatoId", { campeonato });

    return {
        campeonatoDocId,
        ref: firestore.collection(COLLECTION_CAMPEONATOS).doc(campeonatoDocId)
    };
}

function getResultadoFinalDocId(etapa, dataCorrida) {
    const etapaNumero = FirestoreIntegrity.canonicalStageNumber(etapa);
    const etapaId = FirestoreIntegrity.requireFirestoreId(
        etapaNumero ? normalizarDocId(`etapa_${etapaNumero}`) : "",
        "etapaId",
        { etapa, dataCorrida }
    );
    const dataId = normalizarDocId(dataCorrida || hojeISO());

    return `${etapaId}_${dataId}`;
}

function toFirestoreSafe(value) {
    if (value === undefined) return null;
    if (value === null) return null;

    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }

    if (typeof value === "string" || typeof value === "boolean") {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map(toFirestoreSafe);
    }

    if (typeof value === "object") {
        const out = {};

        Object.entries(value).forEach(([key, val]) => {
            if (val !== undefined) out[key] = toFirestoreSafe(val);
        });

        return out;
    }

    return String(value);
}

function tempoParaSegundosJS(valor) {
    if (valor === undefined || valor === null || valor === "") return null;

    if (typeof valor === "number") {
        return Number.isFinite(valor) ? valor : null;
    }

    const texto = String(valor).trim().replace(",", ".");

    if (!texto) return null;

    if (/^\d+:\d{2}(\.\d+)?$/.test(texto)) {
        const partes = texto.split(":");
        const minutos = Number(partes[0]);
        const segundos = Number(partes[1]);

        if (Number.isFinite(minutos) && Number.isFinite(segundos)) {
            return Number((minutos * 60 + segundos).toFixed(3));
        }

        return null;
    }

    if (/^\d+(\.\d+)?$/.test(texto)) {
        const segundos = Number(texto);
        return Number.isFinite(segundos) ? segundos : null;
    }

    return null;
}

function obterMelhorTempoSegundos(item) {
    const porCampoNumerico = tempoParaSegundosJS(item.melhor_tempo_segundos);

    if (porCampoNumerico !== null) return porCampoNumerico;

    return tempoParaSegundosJS(item.melhor_tempo);
}

function extrairCampeonatosDoPilotoExistente(data) {
    const camposPossiveis = [
        data?.campeonatos,
        data?.vinculos,
        data?.campeonato,
        data?.campeonato_nome,
        data?.campeonato_id,
        data?.id_campeonato
    ];
    const valores = [];

    const adicionarValor = valor => {
        if (valor === undefined || valor === null) return;

        if (Array.isArray(valor)) {
            valor.forEach(adicionarValor);
            return;
        }

        if (typeof valor === "object") {
            Object.values(valor).forEach(adicionarValor);
            return;
        }

        String(valor || "")
            .split(",")
            .map(v => v.trim())
            .filter(Boolean)
            .forEach(v => valores.push(v));
    };

    camposPossiveis.forEach(adicionarValor);

    return valores.filter((v, idx, arr) => arr.findIndex(x => normalizarChave(x) === normalizarChave(v)) === idx);
}

function aliasesCampeonato(valor) {
    const texto = String(valor || "").trim();
    const aliases = new Set();

    if (texto) {
        aliases.add(texto);
        aliases.add(normalizarDocId(texto));
        aliases.add(normalizarChave(texto));
    }

    const campeonato = DB.campeonatos.find(c =>
        String(c.nome || "").trim() === texto ||
        String(c.id || "").trim() === texto ||
        normalizarDocId(c.nome || "") === normalizarDocId(texto) ||
        normalizarDocId(c.id || "") === normalizarDocId(texto)
    );

    if (campeonato) {
        [campeonato.nome, campeonato.id, campeonato.nome_exibicao].forEach(v => {
            const item = String(v || "").trim();
            if (!item) return;
            aliases.add(item);
            aliases.add(normalizarDocId(item));
            aliases.add(normalizarChave(item));
        });
    }

    return aliases;
}

function pilotoPertenceAoCampeonato(p, campeonato) {
    const aliases = aliasesCampeonato(campeonato);

    return vinculosPiloto(p).some(v => {
        const valor = String(v || "").trim();
        return aliases.has(valor) || aliases.has(normalizarDocId(valor)) || aliases.has(normalizarChave(valor));
    });
}

async function marcarPilotosJaVinculadosAoCampeonato(campeonato, exibirHint = true) {
    if (!campeonato || !IMPORTACAO_PREVIA.length) return;

    const status = document.getElementById("statusImport");
    const cfg = getTipoArquivoSelecionado();
    const tipoArquivo = cfg?.tipo || IMPORTACAO_PREVIA[0]?.tipoArquivo || "";
    const deveCalcular = tipoArquivo === "resultado_final" || tipoArquivo === "classificacao";

    try {
        if (status) {
            status.innerHTML = "⏳ Verificando pilotos já vinculados ao campeonato no Firestore...";
        }

        await carregarDadosBaseFirestore();

        for (const item of IMPORTACAO_PREVIA) {
            aplicarSugestaoVinculoPilotoImportacao(item, campeonato);
        }

        recalcularPreviewImportacao(campeonato, exibirHint, deveCalcular);

        const selecionados = IMPORTACAO_PREVIA.filter(i => i.checked && !i.conflitoId).length;

        if (status) {
            status.innerHTML = selecionados
                ? `✅ ${selecionados} piloto(s) com vínculo encontrado por ID ou nome completo foram marcados automaticamente.`
                : "✅ Verificação concluída. Nenhum vínculo por ID ou nome completo foi marcado automaticamente.";
        }
    } catch (e) {
        console.error(e);

        if (status) {
            status.innerHTML = `⚠️ Não foi possível verificar os pilotos na collection Pilotos: ${htmlEscape(e.message || e)}`;
        }

        recalcularPreviewImportacao(campeonato, exibirHint, deveCalcular);
    }
}

async function prepararDocumentoCampeonato(campeonato) {
    const { campeonatoDocId, ref } = getCampeonatoFirestoreRef(campeonato);
    const snap = await ref.get();

    await ref.set({
        id: campeonatoDocId,
        nome: snap.exists ? (snap.data()?.nome || campeonato) : campeonato,
        atualizadoEmISO: new Date().toISOString(),
        estrutura: `${COLLECTION_CAMPEONATOS}/${campeonatoDocId}`
    }, { merge: true });

    return {
        campeonatoDocId,
        campRef: ref
    };
}

function montarBackupPayload({ campeonato, etapa, dataCorrida, cfg, file, conteudoRaw, dataUrl, idUnico }) {
    const limiteSeguroFirestoreBytes = 850000;
    const arquivoPequeno = Number(file.size || 0) <= limiteSeguroFirestoreBytes;

    return toFirestoreSafe({
        idImportacao: idUnico,
        campeonato,
        campeonato_id: normalizarDocId(campeonato),
        stageKey: StageIntegrity.createStageKey(normalizarDocId(campeonato), etapa, dataCorrida),
        etapa: Number(etapa),
        dataCorrida,
        tipoArquivo: cfg.tipo,
        tipoLabel: cfg.label,
        nomeArquivo: file.name,
        mimeType: file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "text/html"),
        tamanhoBytes: file.size,
        dataUpload: new Date().toLocaleString("pt-BR"),
        dataUploadISO: new Date().toISOString(),
        arquivoCompletoSalvoNoFirestore: arquivoPequeno,
        avisoArquivo: arquivoPequeno
            ? "Arquivo salvo no documento global de backup."
            : "Arquivo acima do limite seguro do Firestore. Salvei os metadados e os dados extraídos dos pilotos.",
        dataUrl: arquivoPequeno ? dataUrl : "",
        conteudo: arquivoPequeno ? conteudoRaw : ""
    });
}

async function salvarBackupImportacaoNoFirestore(backupPayload) {
    const backupId = backupPayload.idImportacao;
    const caminhoGlobal = `${COLLECTION_BACKUPS}/${backupId}`;

    await firestore.collection(COLLECTION_BACKUPS).doc(backupId).set({
        ...backupPayload,
        caminhoFirestore: caminhoGlobal,
        atualizadoEmISO: new Date().toISOString()
    }, { merge: true });

    return {
        backupId,
        caminhoFirestore: caminhoGlobal
    };
}

async function salvarArquivoSemPreviewNoFirestore({ campeonato, etapa, dataCorrida, cfg, backupPayload, backupId }) {
    const { campeonatoDocId, campRef } = await prepararDocumentoCampeonato(campeonato);

    const destino = cfg.tipo || "arquivo";
    const docId = `${getResultadoFinalDocId(etapa, dataCorrida)}_${normalizarDocId(backupId)}`;
    const ref = campRef.collection(destino).doc(docId);

    await ref.set(toFirestoreSafe({
        ...backupPayload,
        idImportacao: backupId,
        campeonato,
        campeonato_id: campeonatoDocId,
        etapa: Number(etapa),
        dataCorrida,
        tipoArquivo: cfg.tipo,
        nomeArquivo: backupPayload.nomeArquivo || "",
        caminhoBackup: `${COLLECTION_BACKUPS}/${backupId}`,
        caminhoFirestore: `${COLLECTION_CAMPEONATOS}/${campeonatoDocId}/${destino}/${docId}`,
        criadoEmISO: new Date().toISOString(),
        atualizadoEmISO: new Date().toISOString()
    }), { merge: true });

    return `${COLLECTION_CAMPEONATOS}/${campeonatoDocId}/${destino}/${docId}`;
}

async function salvarPilotoGlobalNoFirestore(p, campeonato) {
    const item = normalizarIdentidadePilotoVinculado(p);
    const pilotUid = getPilotUid(p) || DriverIdentity.ensurePilotUid(item);
    const pilotoSelecionado = DB.pilotos.find(pilot => getPilotUid(pilot) === pilotUid) || getPilotoSelecionadoImportacao(item);
    const idPilotoBruto = String(item.driver_id || item.id_piloto || "").trim();
    const nomeArquivo = String(item.driver_name || item.nome || item.piloto || "").trim();
    const pilotoSimilarSemId = !pilotoSelecionado && idPilotoBruto && nomeArquivo
        ? buscarPilotosSimilaresPorNome(nomeArquivo).find(piloto => !String(piloto.id_piloto || piloto.driver_id || "").trim())
        : null;
    const docIdDestino = pilotoSelecionado?.id || pilotoSimilarSemId?.id || (idPilotoBruto ? normalizarDocId(idPilotoBruto) : normalizarDocId(nomeArquivo));

    if (!docIdDestino || docIdDestino === "sem_id") {
        console.warn("Piloto sem id_piloto e sem nome não foi cadastrado na collection Pilotos:", p);
        return null;
    }

    const pilotoRef = firestore.collection(COLLECTION_PILOTOS).doc(docIdDestino);
    const snapshot = await pilotoRef.get();
    const dadosAtuais = snapshot.exists ? snapshot.data() || {} : (pilotoSelecionado || pilotoSimilarSemId || {});
    const campeonatosAtuais = extrairCampeonatosDoPilotoExistente(dadosAtuais);
    const idAtual = String(dadosAtuais.id_piloto || dadosAtuais.driver_id || "").trim();
    const idFinal = pilotoSelecionado ? (idAtual || idPilotoBruto) : (idPilotoBruto || idAtual);
    const nomeAtual = String(dadosAtuais.nome || dadosAtuais.driver_name || "").trim();
    const nomeFinal = pilotoSelecionado ? (nomeAtual || nomeArquivo || idFinal || docIdDestino) : (nomeArquivo || nomeAtual || idFinal || docIdDestino);

    const aliasesDoCampeonato = aliasesCampeonato(campeonato);
    const jaVinculado = campeonatosAtuais.some(v =>
        aliasesDoCampeonato.has(String(v || "").trim()) ||
        aliasesDoCampeonato.has(normalizarDocId(v)) ||
        aliasesDoCampeonato.has(normalizarChave(v))
    );

    if (!jaVinculado) {
        campeonatosAtuais.push(campeonato);
    }

    const payload = toFirestoreSafe({
        ...dadosAtuais,
        pilot_uid: pilotUid,
        id_piloto: idFinal,
        driver_id: idFinal,
        nome: nomeFinal,
        driver_name: nomeFinal,
        apelido: dadosAtuais.apelido || "",
        campeonatos: campeonatosAtuais,
        vinculos: campeonatosAtuais,
        origemCadastro: snapshot.exists
            ? dadosAtuais.origemCadastro || "cadastro_existente"
            : "importacao_arquivo",
        ultimoCampeonatoImportado: campeonato,
        atualizadoEmISO: new Date().toISOString(),
        criadoEmISO: dadosAtuais.criadoEmISO || new Date().toISOString(),
        ultimo_driver_id_arquivo: item.driver_id_arquivo || "",
        ultimo_driver_name_arquivo: item.driver_name_arquivo || ""
    });

    await pilotoRef.set(payload, { merge: true });

    return {
        id: docIdDestino,
        criado: !snapshot.exists,
        vinculado: !jaVinculado
    };
}

async function salvarPilotosImportadosNoFirestore({ campeonato, selecionados }) {
    const resumo = {
        processados: 0,
        cadastrados: 0,
        vinculados: 0,
        ignorados: 0
    };

    for (const p of selecionados || []) {
        const resultado = await salvarPilotoGlobalNoFirestore(p, campeonato);

        if (!resultado) {
            resumo.ignorados += 1;
            continue;
        }

        resumo.processados += 1;
        if (resultado.criado) resumo.cadastrados += 1;
        if (resultado.vinculado) resumo.vinculados += 1;
    }

    return resumo;
}

function selectEndFirebasePayload(item, contexto) {
    return toFirestoreSafe({
        arquivo_origem: item.arquivo_origem || contexto.nomeArquivo || "",
        evento: item.evento || "",
        driver_id: item.driver_id || "",
        driver_name: item.driver_name || "",
        diff: item.diff || "",
        total_tempo: item.total_tempo || "",
        s1_melhor_vlt: item.s1_melhor_vlt ?? null,
        s2_melhor_vlt: item.s2_melhor_vlt ?? null,
        s3_melhor_vlt: item.s3_melhor_vlt ?? null,
        sfspd_melhor_vlt: item.sfspd_melhor_vlt ?? null,
        posicao_final2: Number(item.posicao_final2 || 0),
        pontos: Number(item.pontos || 0),
        melhor_tempo_ponto: Number(item.melhor_tempo_ponto || 0)
    });
}


function obterConfigHistoriaIAImportacao() {
    const gerar = !!document.getElementById("imp_gerar_historia_ia")?.checked;
    const apiKey = String(document.getElementById("imp_gemini_key")?.value || "").trim();
    const modelo = String(document.getElementById("imp_gemini_model")?.value || "gemini-2.5-flash-lite").trim() || "gemini-2.5-flash-lite";

    return {
        gerar,
        apiKey,
        modelo
    };
}

function normalizarNomeComparacao(valor) {
    return String(valor || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();
}

function textoSeguroHistoria(valor, fallback = "-") {
    const texto = String(valor ?? "").trim();
    return texto || fallback;
}

function formatarNumeroHistoria(valor, casas = 3) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return "-";
    return n.toFixed(casas);
}

function extrairPilotoHeaderVoltaAVolta(texto) {
    const limpo = String(texto || "").replace(/\s+/g, " ").trim();
    const match = limpo.match(/^(\d+)\s*-\s*\[(\d+)\]\s*(.*?)\s*-\s*(.*)$/);

    if (match) {
        return {
            kart_numero: match[1],
            driver_id: match[2],
            driver_name: match[3].trim(),
            classe: match[4].trim(),
            piloto_original: limpo
        };
    }

    const matchSemClasse = limpo.match(/^(\d+)\s*-\s*\[(\d+)\]\s*(.*)$/);

    if (matchSemClasse) {
        return {
            kart_numero: matchSemClasse[1],
            driver_id: matchSemClasse[2],
            driver_name: matchSemClasse[3].trim(),
            classe: "",
            piloto_original: limpo
        };
    }

    // Alguns kartódromos exportam o cabeçalho sem [driver_id], por exemplo:
    // "041 - BRENO MANTOVANI - RENTAL". Antes esse texto inteiro virava o
    // nome do piloto e acabava criando cadastros duplicados.
    const partes = limpo.split(/\s+-\s+/).map(v => v.trim()).filter(Boolean);

    if (partes.length >= 2 && /^\d+$/.test(partes[0])) {
        const kartNumero = partes.shift();
        const classe = partes.length >= 2 ? partes.pop() : "";
        const nome = partes.join(" - ").trim();

        if (nome) {
            return {
                kart_numero: kartNumero,
                driver_id: "",
                driver_name: nome,
                classe,
                piloto_original: limpo
            };
        }
    }

    const matchSomenteId = limpo.match(/^\[(\d+)\]\s*(.*?)(?:\s*-\s*(.*))?$/);

    return {
        kart_numero: "",
        driver_id: matchSomenteId ? matchSomenteId[1] : "",
        driver_name: matchSomenteId ? matchSomenteId[2].trim() : limpo,
        classe: matchSomenteId ? String(matchSomenteId[3] || "").trim() : "",
        piloto_original: limpo
    };
}

function extrairVoltaAVoltaHTMLTexto(html, nomeArquivo = "") {
    const conteudo = String(html || "");
    if (!conteudo.trim()) return [];

    const doc = new DOMParser().parseFromString(conteudo, "text/html");
    const tabela = doc.querySelector("table.points") || doc.querySelector("table");

    if (!tabela) return [];

    const rows = Array.from(tabela.querySelectorAll("tr"));
    const dados = [];
    let pilotoAtual = null;

    rows.slice(1).forEach(row => {
        const cells = Array.from(row.querySelectorAll("td"));

        if (cells.length === 1 && cells[0].hasAttribute("colspan")) {
            pilotoAtual = extrairPilotoHeaderVoltaAVolta(cells[0].textContent || "");
            return;
        }

        if (!pilotoAtual || cells.length !== 10) return;

        const valores = cells.map(cell => String(cell.textContent || "").trim());

        dados.push({
            arquivo_origem: nomeArquivo,
            piloto: pilotoAtual.piloto_original,
            driver_id: pilotoAtual.driver_id,
            driver_name: pilotoAtual.driver_name,
            kart_numero: pilotoAtual.kart_numero,
            classe: pilotoAtual.classe,
            hora: valores[0],
            hora_dia: valores[0],
            volta: Number(valores[1]),
            volta_lider: Number(valores[2]),
            tempo_volta: valores[3],
            velocidade: valores[4],
            sfspd: valores[5],
            sfspd_tm: valores[6],
            sfspd_tempo: valores[6],
            s1: valores[7],
            s2: valores[8],
            s3: valores[9],
            tempo_volta_segundos: tempoParaSegundosJS(valores[3])
        });
    });

    const horaSegundos = valor => {
        const partes = String(valor || "").replace(",", ".").split(":").map(Number);
        if (partes.some(v => !Number.isFinite(v))) return null;
        if (partes.length === 3) return partes[0] * 3600 + partes[1] * 60 + partes[2];
        if (partes.length === 2) return partes[0] * 60 + partes[1];
        return partes.length === 1 ? partes[0] : null;
    };
    const porPiloto = new Map();
    dados.forEach(volta => {
        const id = volta.driver_id || normalizarNomeComparacao(volta.driver_name);
        if (!porPiloto.has(id)) porPiloto.set(id, []);
        porPiloto.get(id).push(volta);
    });
    porPiloto.forEach(voltas => {
        let anterior = -1;
        let dia = 0;
        voltas.sort((a, b) => Number(a.volta) - Number(b.volta)).forEach(volta => {
            const atual = horaSegundos(volta.hora_dia);
            if (atual === null) return;
            if (anterior >= 43200 && atual < 43200) dia += 1;
            volta.elapsed_time = Number((atual + dia * 86400).toFixed(3));
            anterior = atual;
        });
    });
    const inicio = Math.min(...dados.map(v => Number(v.elapsed_time)).filter(Number.isFinite));
    if (Number.isFinite(inicio)) dados.forEach(v => {
        if (Number.isFinite(Number(v.elapsed_time))) v.elapsed_time = Number((Number(v.elapsed_time) - inicio).toFixed(3));
    });

    return dados;
}


function encontrarPilotoCadastradoPorDriverId(item) {
    const idItem = String(item?.driver_id || item?.id_piloto || item?.id || "").trim();

    if (!idItem) return null;

    return DB.pilotos.find(p => {
        const idPiloto = String(p.id_piloto || p.driver_id || p.id || "").trim();
        return !!idPiloto && idItem === idPiloto;
    }) || null;
}

function encontrarPilotoCadastradoPorArquivo(item, permitirFallbackNome = true) {
    const pilotoPorId = encontrarPilotoCadastradoPorDriverId(item);

    if (pilotoPorId || !permitirFallbackNome) {
        return pilotoPorId;
    }

    const nomeItem = normalizarNomeComparacao(item?.driver_name || item?.nome || item?.piloto || "");

    return DB.pilotos.find(p => {
        const nomePiloto = normalizarNomeComparacao(p.nome || p.driver_name || "");
        return !!nomeItem && !!nomePiloto && nomeItem === nomePiloto;
    }) || null;
}

function tokensNomePiloto(valor) {
    return normalizarNomeComparacao(valor)
        .split(" ")
        .map(t => t.trim())
        .filter(t => t.length >= 3);
}

function pontuarSimilaridadeNomePiloto(nomeArquivo, nomeCadastro) {
    const a = normalizarNomeComparacao(nomeArquivo);
    const b = normalizarNomeComparacao(nomeCadastro);

    if (!a || !b) return 0;
    if (a === b) return 100;
    if (a.includes(b) || b.includes(a)) return 85;

    const tokensA = tokensNomePiloto(a);
    const tokensB = tokensNomePiloto(b);

    if (!tokensA.length || !tokensB.length) return 0;

    const comuns = tokensA.filter(t => tokensB.includes(t)).length;
    const cobertura = comuns / Math.max(tokensA.length, tokensB.length);
    const iniciaisIguais = tokensA[0] === tokensB[0] ? 10 : 0;

    return Math.round(cobertura * 80) + iniciaisIguais;
}

function buscarPilotosSimilaresPorNome(nome, limite = 5) {
    return DB.pilotos
        .map(p => ({
            piloto: p,
            score: pontuarSimilaridadeNomePiloto(nome, p.nome || p.driver_name || "")
        }))
        .filter(item => item.score >= 45)
        .sort((a, b) =>
            b.score - a.score ||
            String(a.piloto.nome || a.piloto.driver_name || "").localeCompare(String(b.piloto.nome || b.piloto.driver_name || ""))
        )
        .slice(0, limite)
        .map(item => ({
            ...item.piloto,
            similaridade: item.score
        }));
}

function getPilotoSelecionadoImportacao(item) {
    const docId = String(item?.pilotoVinculadoDocId || "").trim();

    if (!docId) return null;

    return DB.pilotos.find(p => String(p.id || "") === docId) || null;
}

function normalizarIdentidadePilotoVinculado(item) {
    const pilotoSelecionado = getPilotoSelecionadoImportacao(item);
    const driverIdArquivo = String(item?.driver_id || item?.id_piloto || "").trim();
    const driverNameArquivo = String(item?.driver_name || item?.nome || item?.piloto || "").trim();
    const driverIdSelecionado = String(pilotoSelecionado?.id_piloto || pilotoSelecionado?.driver_id || "").trim();
    const driverNameSelecionado = String(pilotoSelecionado?.nome || pilotoSelecionado?.driver_name || "").trim();

    // Quando o usuário escolhe explicitamente um cadastro, esse cadastro é a
    // identidade canônica. O ID/nome do arquivo ficam apenas como referência.
    const driverId = pilotoSelecionado
        ? (driverIdSelecionado || driverIdArquivo)
        : driverIdArquivo;
    const driverName = pilotoSelecionado
        ? (driverNameSelecionado || driverNameArquivo || driverId)
        : (driverNameArquivo || driverId);

    return {
        ...item,
        driver_id_arquivo: driverIdArquivo,
        driver_name_arquivo: driverNameArquivo,
        driver_id: driverId,
        id_piloto: driverId,
        driver_name: driverName,
        nome: driverName,
        pilotoVinculadoDocId: pilotoSelecionado?.id || item?.pilotoVinculadoDocId || ""
    };
}

function pilotoTemMesmoIdArquivo(piloto, driverId) {
    const idPiloto = String(piloto?.id_piloto || piloto?.driver_id || "").trim();
    return !!driverId && !!idPiloto && idPiloto === driverId;
}

function pilotoTemMesmoNomeCompletoArquivo(piloto, nomeArquivo) {
    const nomePiloto = normalizarNomeComparacao(piloto?.nome || piloto?.driver_name || "");
    const nomeItem = normalizarNomeComparacao(nomeArquivo);
    return !!nomePiloto && !!nomeItem && nomePiloto === nomeItem;
}

function vinculoEncontradoPorIdOuNomeCompleto(piloto, item, campeonato) {
    if (!piloto || !campeonato || !pilotoPertenceAoCampeonato(piloto, campeonato)) return false;

    const driverId = String(item?.driver_id || item?.id_piloto || "").trim();
    const nomeArquivo = item?.driver_name || item?.nome || item?.piloto || "";

    return pilotoTemMesmoIdArquivo(piloto, driverId) || pilotoTemMesmoNomeCompletoArquivo(piloto, nomeArquivo);
}

function aplicarSugestaoVinculoPilotoImportacao(item, campeonato = document.getElementById("imp_camp")?.value || "") {
    const driverId = String(item.driver_id || item.id_piloto || "").trim();
    const nomeArquivo = item.driver_name || item.nome || item.piloto || "";
    const porId = driverId ? DB.pilotos.filter(p => pilotoTemMesmoIdArquivo(p, driverId)) : [];
    const porNomeCompleto = DB.pilotos.filter(p => pilotoTemMesmoNomeCompletoArquivo(p, nomeArquivo));
    const similares = (!driverId || !porId.length) ? buscarPilotosSimilaresPorNome(nomeArquivo) : [];
    const similarSemId = driverId ? similares.find(piloto => !String(piloto.id_piloto || piloto.driver_id || "").trim()) : null;
    const selecionado = porId[0] || porNomeCompleto[0] || similarSemId || similares[0] || null;
    const conflitoId = porId.length > 1 || (!porId.length && porNomeCompleto.length > 1);
    const vinculoEncontrado = vinculoEncontradoPorIdOuNomeCompleto(selecionado, item, campeonato);

    item.pilotosSugeridos = [...porId, ...porNomeCompleto, ...similares].map(p => p.id);
    item.pilotoVinculadoDocId = selecionado?.id || "";
    item.criarNovoPiloto = !selecionado;
    item.conflitoId = conflitoId;

    if (conflitoId) {
        item.status = "Mais de um cadastro encontrado — selecione o piloto correto";
    } else if (selecionado) {
        const selecionadoSemId = !String(selecionado.id_piloto || selecionado.driver_id || "").trim();
        item.status = vinculoEncontrado
            ? `Vínculo encontrado: ${selecionado.nome || selecionado.driver_name || selecionado.id}`
            : selecionadoSemId && driverId
                ? `Nome similar sem ID encontrado: ${selecionado.nome || selecionado.driver_name || selecionado.id} — marque para preencher o driver_id e vincular`
                : `Sugestão: ${selecionado.nome || selecionado.driver_name || selecionado.id} — marque para vincular ao campeonato`;
    } else if (driverId) {
        item.status = "Sem vínculo encontrado: marque para cadastrar com o driver_id do arquivo";
    } else {
        item.status = "Sem vínculo encontrado: marque para cadastrar pelo nome";
    }

    item.checked = vinculoEncontrado && !conflitoId;

    return item;
}

function pilotoArquivoEstaNoCampeonato(item, campeonato, permitirFallbackNome = true) {
    if (!campeonato) return false;

    const pilotoCadastrado = encontrarPilotoCadastradoPorArquivo(item, permitirFallbackNome);
    if (!pilotoCadastrado) return false;

    return pilotoPertenceAoCampeonato(pilotoCadastrado, campeonato);
}

function pilotosUnicosVoltaAVoltaParaPreview(voltas) {
    const mapa = new Map();

    (voltas || []).forEach((volta, idx) => {
        const driverId = String(volta.driver_id || "").trim();
        const driverName = String(volta.driver_name || "").trim();
        const key = driverId ? `id:${driverId}` : `nome:${normalizarNomeComparacao(driverName)}`;

        if (!driverName && !driverId) return;

        if (!mapa.has(key)) {
            mapa.set(key, {
                driver_id: driverId,
                id_piloto: driverId,
                driver_name: driverName || "-",
                nome: driverName || "-",
                posicao_final: idx + 1,
                posicao_geral_arquivo: idx + 1,
                posGeral: idx + 1,
                kart_numero: volta.kart_numero || "",
                classe: volta.classe || "",
                voltas: 0,
                melhor_tempo: "",
                melhor_tempo_segundos: null,
                tipoArquivo: "volta_a_volta",
                somenteHistoria: true,
                checked: false,
                conflitoId: false,
                status: ""
            });
        }

        const item = mapa.get(key);
        item.voltas = Number(item.voltas || 0) + 1;

        const tempoAtual = tempoParaSegundosJS(volta.tempo_volta);
        const tempoMelhor = tempoParaSegundosJS(item.melhor_tempo);

        if (tempoAtual !== null && (tempoMelhor === null || tempoAtual < tempoMelhor)) {
            item.melhor_tempo = volta.tempo_volta || "";
            item.melhor_tempo_segundos = tempoAtual;
        }
    });

    return Array.from(mapa.values());
}

function montarImportacaoPreviaVoltaAVolta(registrosVoltas, campeonato = "", exibirHint = true) {
    const pilotosArquivo = pilotosUnicosVoltaAVoltaParaPreview(registrosVoltas);
    const pilotosCampeonato = pilotosArquivo
        .map(item => aplicarSugestaoVinculoPilotoImportacao({
            ...item,
            driver_id: String(item.driver_id || item.id_piloto || "").trim(),
            id_piloto: String(item.driver_id || item.id_piloto || "").trim(),
            driver_name: item.driver_name || item.nome || "-",
            nome: item.driver_name || item.nome || "-",
            tipoArquivo: "volta_a_volta"
        }, campeonato))
        .sort((a, b) => String(a.driver_name || "").localeCompare(String(b.driver_name || "")));

    IMPORTACAO_PREVIA = pilotosCampeonato.map((item, idx) => ({
        ...item,
        posicao_final: idx + 1,
        posicao_geral_arquivo: idx + 1,
        posGeral: idx + 1
    }));

    IMPORTACAO_PREVIA_GERADA = true;
    recalcularPreviewImportacao(campeonato, exibirHint, false);

    return IMPORTACAO_PREVIA;
}

async function prepararPreviewVoltaAVoltaSelecionado(fileArg = null) {
    const cfg = getTipoArquivoSelecionado();
    const status = document.getElementById("statusImport");
    const pyStatus = document.getElementById("pyStatus");
    const campeonato = document.getElementById("imp_camp")?.value || "";
    const file = fileArg || document.getElementById("fileImportacaoUnico")?.files?.[0];

    if (cfg?.tipo !== "volta_a_volta" || !file) return;

    try {
        if (pyStatus) pyStatus.innerHTML = `⏳ Lendo ${htmlEscape(file.name)} para identificar pilotos do campeonato...`;

        await carregarDadosBaseFirestore();

        const html = isArquivoTexto(file) ? await file.text() : "";

        if (!html) {
            if (pyStatus) pyStatus.innerHTML = "⚠️ Para Volta a volta, use arquivo HTML, HTM, XML ou TXT.";
            return;
        }

        const voltas = extrairVoltaAVoltaHTMLTexto(html, file.name);
        const pilotos = montarImportacaoPreviaVoltaAVolta(voltas, campeonato, true);
        const qtdVoltas = voltas.length;
        const qtdPilotos = pilotos.length;

        if (!campeonato) {
            if (status) status.innerHTML = "⚠️ Selecione o campeonato antes de salvar para cadastrar/vincular os pilotos identificados.";
        } else if (!qtdPilotos) {
            if (status) status.innerHTML = "⚠️ Nenhum piloto foi identificado no arquivo.";
        } else if (status) {
            status.innerHTML = `✅ Volta a volta lido: ${qtdVoltas} volta(s) e ${qtdPilotos} piloto(s) identificados. Apenas vínculos encontrados por ID ou nome completo ficam marcados; marque manualmente novos vínculos/cadastros.`;
        }

        if (pyStatus) {
            pyStatus.innerHTML = qtdPilotos
                ? `✅ Volta a volta lido: ${qtdPilotos} piloto(s) identificados para conferência de vínculo/cadastro.`
                : "⚠️ Volta a volta lido, mas nenhum piloto foi identificado.";
        }
    } catch (e) {
        console.error(e);
        if (pyStatus) pyStatus.innerHTML = `❌ Erro ao ler Volta a volta: ${htmlEscape(e.message || e)}`;
        if (status) status.innerHTML = `❌ Erro ao ler Volta a volta: ${htmlEscape(e.message || e)}`;
    }
}

async function prepararPreviewVoltaAVoltaPyScript(html, nomeArquivo = "arquivo.html") {
    const cfg = getTipoArquivoSelecionado();
    if (cfg?.tipo !== "volta_a_volta") return;

    const campeonato = document.getElementById("imp_camp")?.value || "";
    const status = document.getElementById("statusImport");
    const pyStatus = document.getElementById("pyStatus");

    try {
        await carregarDadosBaseFirestore();
        const voltas = extrairVoltaAVoltaHTMLTexto(html, nomeArquivo);
        const pilotos = montarImportacaoPreviaVoltaAVolta(voltas, campeonato, true);

        if (pyStatus) {
            pyStatus.innerHTML = pilotos.length
                ? `✅ Volta a volta lido: ${pilotos.length} piloto(s) identificados para conferência de vínculo/cadastro.`
                : "⚠️ Volta a volta lido, mas nenhum piloto foi identificado.";
        }

        if (status && campeonato) {
            status.innerHTML = pilotos.length
                ? `✅ Marque os pilotos que devem receber história individual e clique em salvar. Pilotos novos serão cadastrados e vinculados ao campeonato.`
                : "⚠️ Nenhum piloto foi identificado no arquivo.";
        }
    } catch (e) {
        console.error(e);
        if (pyStatus) pyStatus.innerHTML = `❌ Erro ao ler Volta a volta: ${htmlEscape(e.message || e)}`;
    }
}

function inicializarPreviewVoltaAVoltaJS() {
    const input = document.getElementById("fileImportacaoUnico");
    if (!input || input.dataset.voltaPreviewListener === "1") return;

    input.dataset.voltaPreviewListener = "1";
    input.addEventListener("change", async event => {
        const cfg = getTipoArquivoSelecionado();
        if (cfg?.tipo !== "volta_a_volta") return;

        const file = event.target?.files?.[0];
        if (!file) return;

        IMPORTACAO_PYSCRIPT = [];
        IMPORTACAO_PYSCRIPT_ARQUIVO = file.name || "";
        IMPORTACAO_PYSCRIPT_TIPO = "volta_a_volta";
        IMPORTACAO_PREVIA = [];
        IMPORTACAO_PREVIA_GERADA = false;

        await prepararPreviewVoltaAVoltaSelecionado(file);
    });
}

window.prepararPreviewVoltaAVoltaSelecionado = prepararPreviewVoltaAVoltaSelecionado;
window.prepararPreviewVoltaAVoltaPyScript = prepararPreviewVoltaAVoltaPyScript;

function pilotoChaveHistoria(item) {
    const driverId = String(item?.driver_id || item?.id_piloto || "").trim();
    if (driverId) return `id:${driverId}`;
    return `nome:${normalizarNomeComparacao(item?.driver_name || item?.nome || item?.piloto || "")}`;
}

function mesmoPilotoHistoria(a, b) {
    const idA = String(a?.driver_id || a?.id_piloto || "").trim();
    const idB = String(b?.driver_id || b?.id_piloto || "").trim();

    if (idA || idB) {
        return !!idA && !!idB && idA === idB;
    }

    const nomeA = normalizarNomeComparacao(a?.driver_name || a?.nome || a?.piloto || "");
    const nomeB = normalizarNomeComparacao(b?.driver_name || b?.nome || b?.piloto || "");

    return !!nomeA && !!nomeB && nomeA === nomeB;
}


function chavePilotoHistoriaMap(item) {
    const driverId = String(item?.driver_id || item?.id_piloto || item?.driverId || item?.docId || "").trim();

    if (driverId) return `id:${driverId}`;

    const nome = normalizarNomeComparacao(item?.driver_name || item?.nome || item?.piloto || "");
    return nome ? `nome:${nome}` : "";
}

function normalizarPilotoSelecionadoHistoriaVoltaAVolta(item) {
    const normalizado = normalizarIdentidadePilotoVinculado(item);
    const driverId = String(normalizado.driver_id || normalizado.id_piloto || "").trim();
    const driverName = String(normalizado.driver_name || normalizado.nome || "-").trim() || "-";

    if (!driverId && driverName === "-") return null;

    return {
        ...normalizado,
        checked: true,
        driver_id: driverId,
        id_piloto: driverId,
        driver_name: driverName,
        nome: driverName,
        tipoArquivo: "volta_a_volta",
        somenteHistoria: true
    };
}

function obterPilotosSelecionadosHistoriaVoltaAVolta(campeonato = "") {
    const selecionados = [];
    const vistos = new Set();

    IMPORTACAO_PREVIA.forEach((item, idx) => {
        const checkbox = document.getElementById(`imp_chk_${idx}`);
        const marcado = checkbox ? !!checkbox.checked : !!item.checked;

        item.checked = marcado;

        if (!item.checked || item.conflitoId) return;

        const piloto = normalizarPilotoSelecionadoHistoriaVoltaAVolta(item);
        if (!piloto) return;

        const chave = pilotoChaveHistoria(piloto);
        if (vistos.has(chave)) return;

        vistos.add(chave);
        selecionados.push(piloto);
    });

    return selecionados.sort((a, b) => String(a.driver_name || "").localeCompare(String(b.driver_name || "")));
}

function linhaResultadoTemPosicaoValida(data) {
    return [
        data?.posicao_final2,
        data?.posicao_final,
        data?.posicao_geral_arquivo,
        data?.posicao,
        data?.pos
    ].some(valor => Number.isFinite(Number(valor)) && Number(valor) > 0);
}

function linhaResultadoEhFantasmaVoltaAVolta(data) {
    if (!data || linhaResultadoTemPosicaoValida(data)) return false;
    if (String(data.tipoArquivo || "").toLowerCase() === "resultado_final") return false;

    return !!(
        data.selecionado_para_historia ||
        data.ultimoVoltaAVoltaImportado ||
        data.voltas_volta_a_volta !== undefined ||
        data.melhor_tempo_volta_a_volta !== undefined
    );
}

function normalizarKartComparacao(valor) {
    const texto = String(valor ?? "").trim();
    if (!texto) return "";
    const apenasNumero = texto.replace(/\D/g, "");
    if (!apenasNumero) return texto.toUpperCase();
    return String(Number(apenasNumero));
}

function encontrarResultadoExistenteParaPiloto(rows, piloto) {
    const id = String(piloto?.driver_id || piloto?.id_piloto || "").trim();
    const nome = normalizarNomeComparacao(piloto?.driver_name || piloto?.nome || "");
    const kart = normalizarKartComparacao(piloto?.kart_numero || piloto?.kart || "");
    const validos = (rows || []).filter(row => !linhaResultadoEhFantasmaVoltaAVolta(row.data || {}));

    if (id) {
        const porId = validos.find(row => String(row.data?.driver_id || row.data?.id_piloto || row.docId || "").trim() === id);
        if (porId) return porId;
    }

    if (nome) {
        const porNome = validos.find(row => normalizarNomeComparacao(row.data?.driver_name || row.data?.nome || "") === nome);
        if (porNome) return porNome;
    }

    if (kart) {
        const porKart = validos.filter(row => normalizarKartComparacao(row.data?.kart_numero || row.data?.kart || "") === kart);
        if (porKart.length === 1) return porKart[0];
    }

    return null;
}

async function salvarPilotosSelecionadosVoltaAVoltaNoFirestore({ campeonato, etapa, dataCorrida, selecionados, backupId = "", nomeArquivo = "" }) {
    if (!Array.isArray(selecionados) || !selecionados.length) return null;

    const selecionadosCanonicos = selecionados
        .map(normalizarIdentidadePilotoVinculado)
        .filter(p => p.driver_id || p.driver_name);
    const { campeonatoDocId, campRef } = await prepararDocumentoCampeonato(campeonato);
    const resultadoDocId = getResultadoFinalDocId(etapa, dataCorrida);
    const resultadoDocRef = campRef.collection("resultado_final").doc(resultadoDocId);
    const agoraISO = new Date().toISOString();

    await salvarPilotosImportadosNoFirestore({
        campeonato,
        selecionados: selecionadosCanonicos
    });

    // O Volta a volta não pode criar novas linhas em pilotos_resultado. Essa
    // coleção representa somente quem foi importado no Resultado Final.
    const resultadoSnapshot = await resultadoDocRef.collection("pilotos_resultado").get();
    const resultadoRows = resultadoSnapshot.docs.map(doc => ({ docId: doc.id, ref: doc.ref, data: doc.data() || {} }));
    const batch = firestore.batch();

    // Remove apenas linhas antigas inequivocamente criadas pelo bug anterior:
    // tinham dados de volta/história, mas nenhuma posição de corrida.
    resultadoRows.forEach(row => {
        if (linhaResultadoEhFantasmaVoltaAVolta(row.data)) batch.delete(row.ref);
    });

    batch.set(resultadoDocRef, toFirestoreSafe({
        campeonato,
        campeonato_id: campeonatoDocId,
        etapa: Number(etapa),
        dataCorrida,
        resultadoDocId,
        ultimoVoltaAVoltaImportado: backupId || "",
        voltaAVoltaResumo: {
            nomeArquivo,
            idImportacao: backupId || "",
            qtdPilotosSelecionadosHistoria: selecionadosCanonicos.length,
            pilotosSelecionados: selecionadosCanonicos.map(p => ({
                driver_id: p.driver_id || p.id_piloto || "",
                driver_name: p.driver_name || p.nome || "",
                driver_id_arquivo: p.driver_id_arquivo || "",
                driver_name_arquivo: p.driver_name_arquivo || "",
                kart_numero: p.kart_numero || "",
                piloto_doc_id: p.pilotoVinculadoDocId || "",
                voltas: Number(p.voltas || 0),
                melhor_tempo: p.melhor_tempo || ""
            })),
            atualizadoEmISO: agoraISO
        },
        atualizadoEmISO: agoraISO
    }), { merge: true });

    selecionadosCanonicos.forEach((piloto, idx) => {
        const itemId = normalizarDocId(piloto.driver_id || piloto.id_piloto || piloto.driver_name || `piloto_${idx + 1}`);
        const payloadBase = toFirestoreSafe({
            campeonato,
            campeonato_id: campeonatoDocId,
            etapa: Number(etapa),
            dataCorrida,
            driver_id: piloto.driver_id || piloto.id_piloto || "",
            id_piloto: piloto.driver_id || piloto.id_piloto || "",
            driver_name: piloto.driver_name || piloto.nome || "-",
            nome: piloto.driver_name || piloto.nome || "-",
            driver_id_arquivo: piloto.driver_id_arquivo || "",
            driver_name_arquivo: piloto.driver_name_arquivo || "",
            piloto_doc_id: piloto.pilotoVinculadoDocId || "",
            kart_numero: piloto.kart_numero || "",
            classe: piloto.classe || "",
            voltas: Number(piloto.voltas || 0),
            melhor_tempo: piloto.melhor_tempo || "",
            melhor_tempo_segundos: piloto.melhor_tempo_segundos ?? null,
            tipoArquivo: "volta_a_volta",
            somenteHistoria: true,
            historia_status: "pendente",
            selecionado_para_historia: true,
            idImportacao: backupId || "",
            nomeArquivo: nomeArquivo || "",
            caminhoBackup: backupId ? `${COLLECTION_BACKUPS}/${backupId}` : "",
            criadoEmISO: agoraISO,
            atualizadoEmISO: agoraISO
        });

        batch.set(resultadoDocRef.collection("volta_a_volta_pilotos").doc(itemId), payloadBase, { merge: true });

        // Só complementa uma linha de resultado que já existe. Nunca cria uma
        // linha de corrida a partir do arquivo Volta a volta.
        const existente = encontrarResultadoExistenteParaPiloto(resultadoRows, piloto);
        if (existente) {
            batch.set(existente.ref, toFirestoreSafe({
                voltas_volta_a_volta: Number(piloto.voltas || 0),
                melhor_tempo_volta_a_volta: piloto.melhor_tempo || "",
                melhor_tempo_volta_a_volta_segundos: piloto.melhor_tempo_segundos ?? null,
                ultimoVoltaAVoltaImportado: backupId || "",
                atualizadoEmISO: agoraISO
            }), { merge: true });
        }
    });

    await batch.commit();
    await carregarDadosBaseFirestore();
    popularFiltros();
    renderGestao();

    return {
        resultadoDocId,
        caminhoFirestore: `${COLLECTION_CAMPEONATOS}/${campeonatoDocId}/resultado_final/${resultadoDocId}/volta_a_volta_pilotos`,
        qtdPilotos: selecionadosCanonicos.length
    };
}

function aplicarHistoriasNasLinhasRanking(linhas, historiasMap, voltaPilotosMap) {
    return (linhas || []).map(row => {
        const key = chavePilotoHistoriaMap(row);
        const historia = key ? historiasMap.get(key) : null;
        const volta = key ? voltaPilotosMap.get(key) : null;

        return {
            ...(volta || {}),
            ...row,
            historia_piloto: row.historia_piloto || row.historia_ia_piloto || historia?.historia_piloto || historia?.historia_ia_piloto || volta?.historia_piloto || volta?.historia_ia_piloto || "",
            historia_ia_piloto: row.historia_ia_piloto || row.historia_piloto || historia?.historia_ia_piloto || historia?.historia_piloto || volta?.historia_ia_piloto || volta?.historia_piloto || "",
            historiaModelo: row.historiaModelo || historia?.historiaModelo || volta?.historiaModelo || "",
            historiaPilotoAtualizadaEmISO: row.historiaPilotoAtualizadaEmISO || historia?.historiaPilotoAtualizadaEmISO || volta?.historiaPilotoAtualizadaEmISO || "",
            historia_audio_url: row.historia_audio_url || historia?.historia_audio_url || volta?.historia_audio_url || "",
            historia_audio_data_url: row.historia_audio_data_url || historia?.historia_audio_data_url || volta?.historia_audio_data_url || ""
        };
    });
}

function ordenarPorPosicaoHistoria(rows) {
    return [...(rows || [])].sort((a, b) =>
        Number(obterPosicaoExibicaoRankingCorrida(a) || 999999) - Number(obterPosicaoExibicaoRankingCorrida(b) || 999999) ||
        String(a.driver_name || "").localeCompare(String(b.driver_name || ""))
    );
}

function linhaResumoResultadoHistoria(row, tipo) {
    const pos = obterPosicaoExibicaoRankingCorrida(row);
    const nome = row.driver_name || row.nome || row.piloto || "-";
    const melhor = row.melhor_tempo || "-";
    const total = row.total_tempo || "-";
    const pontos = row.pontos ?? "-";
    const bonus = Number(row.melhor_tempo_ponto || 0);
    const kart = row.kart_numero || row.kart_number || row.kart || "-";

    if (tipo === "classificacao") {
        return `P${pos} | ${nome} | melhor volta ${melhor} | kart ${kart} | bônus MV ${bonus}`;
    }

    return `P${pos} | ${nome} | total ${total} | melhor volta ${melhor} | pontos ${pontos} | bônus MV ${bonus} | kart ${kart}`;
}

function resumirVoltasPilotoHistoria(voltas, limiteLinhas = 18) {
    const linhas = [...(voltas || [])].sort((a, b) => Number(a.volta || 0) - Number(b.volta || 0));

    if (!linhas.length) return "Sem volta a volta importado para este piloto.";

    const tempos = linhas
        .map(v => Number(v.tempo_volta_segundos))
        .filter(v => Number.isFinite(v) && v > 0);

    const melhor = tempos.length ? Math.min(...tempos) : null;
    const pior = tempos.length ? Math.max(...tempos) : null;
    const media = tempos.length ? tempos.reduce((acc, v) => acc + v, 0) / tempos.length : null;

    const header = [
        `Voltas registradas: ${linhas.length}`,
        `Melhor volta no volta a volta: ${melhor !== null ? formatarNumeroHistoria(melhor) + "s" : "-"}`,
        `Pior volta: ${pior !== null ? formatarNumeroHistoria(pior) + "s" : "-"}`,
        `Média aproximada: ${media !== null ? formatarNumeroHistoria(media) + "s" : "-"}`
    ].join(" | ");

    const detalhes = linhas.slice(0, limiteLinhas).map(v =>
        `V${textoSeguroHistoria(v.volta)}: ${textoSeguroHistoria(v.tempo_volta)} | S1 ${textoSeguroHistoria(v.s1)} | S2 ${textoSeguroHistoria(v.s2)} | S3 ${textoSeguroHistoria(v.s3)} | Vel ${textoSeguroHistoria(v.velocidade)}`
    ).join("\n");

    const restante = linhas.length > limiteLinhas
        ? `\n... ${linhas.length - limiteLinhas} volta(s) omitida(s) para reduzir o prompt.`
        : "";

    return `${header}\n${detalhes}${restante}`;
}

function montarPilotosParaHistoria(corrida, classificacao, voltas) {
    const mapa = new Map();

    const adicionar = item => {
        const key = pilotoChaveHistoria(item);
        const nome = item?.driver_name || item?.nome || item?.piloto || "";

        if (!nome && !String(item?.driver_id || item?.id_piloto || "").trim()) return;

        if (!mapa.has(key)) {
            mapa.set(key, {
                driver_id: String(item?.driver_id || item?.id_piloto || "").trim(),
                driver_name: nome || "-"
            });
        }
    };

    (corrida || []).forEach(adicionar);
    (classificacao || []).forEach(adicionar);
    (voltas || []).forEach(adicionar);

    return Array.from(mapa.values()).sort((a, b) => String(a.driver_name || "").localeCompare(String(b.driver_name || "")));
}

function filtrarRowsPorPilotosHistoria(rows, pilotosAlvo) {
    const pilotos = Array.isArray(pilotosAlvo) ? pilotosAlvo.filter(Boolean) : [];

    if (!pilotos.length) return rows || [];

    return (rows || []).filter(row => pilotos.some(piloto => mesmoPilotoHistoria(row, piloto)));
}

function montarContextoGeralHistoria({ campeonato, etapa, dataCorrida, corrida, classificacao, voltas, pilotosAlvo = [] }) {
    const pilotos = Array.isArray(pilotosAlvo) && pilotosAlvo.length
        ? pilotosAlvo
        : montarPilotosParaHistoria(corrida, classificacao, voltas);
    const idsPilotos = new Set(pilotos.map(p => pilotoChaveHistoria(p)));
    const corridaFiltrada = filtrarRowsPorPilotosHistoria(corrida, pilotos);
    const classificacaoFiltrada = filtrarRowsPorPilotosHistoria(classificacao, pilotos);
    const voltasFiltradas = (voltas || []).filter(v => idsPilotos.has(pilotoChaveHistoria(v)));

    const linhasResultado = ordenarPorPosicaoHistoria(corridaFiltrada)
        .map(row => linhaResumoResultadoHistoria(row, "resultado"))
        .join("\n") || "Sem resultado final importado para os pilotos selecionados.";

    const linhasClassificacao = ordenarPorPosicaoHistoria(classificacaoFiltrada)
        .map(row => linhaResumoResultadoHistoria(row, "classificacao"))
        .join("\n") || "Sem classificação importada para os pilotos selecionados.";

    const resumoVoltas = pilotos.map(piloto => {
        const voltasPiloto = voltasFiltradas.filter(v => mesmoPilotoHistoria(v, piloto));
        return `\n### ${piloto.driver_name}\n${resumirVoltasPilotoHistoria(voltasPiloto, 10)}`;
    }).join("\n");

    return `CAMPEONATO: ${campeonato}\nETAPA: ${etapa}\nDATA: ${formatarDataBR(dataCorrida)}\nPILOTOS ANALISADOS: ${pilotos.map(p => p.driver_name || p.nome || p.driver_id || "-").join(", ")}\n\nRESULTADO FINAL:\n${linhasResultado}\n\nCLASSIFICAÇÃO / TOMADA:\n${linhasClassificacao}\n\nVOLTA A VOLTA RESUMIDO:${resumoVoltas || "\nSem volta a volta importado."}`;
}

function montarContextoPilotoHistoria({ piloto, corrida, classificacao, voltas }) {
    const resultado = (corrida || []).find(row => mesmoPilotoHistoria(row, piloto));
    const tomada = (classificacao || []).find(row => mesmoPilotoHistoria(row, piloto));
    const voltasPiloto = (voltas || []).filter(row => mesmoPilotoHistoria(row, piloto));

    return `PILOTO: ${piloto.driver_name}\n\nRESULTADO FINAL:\n${resultado ? linhaResumoResultadoHistoria(resultado, "resultado") : "Sem resultado final importado para este piloto."}\n\nCLASSIFICAÇÃO / TOMADA:\n${tomada ? linhaResumoResultadoHistoria(tomada, "classificacao") : "Sem classificação importada para este piloto."}\n\nVOLTAS CORRIDA:\n${resumirVoltasPilotoHistoria(voltasPiloto, 28)}`;
}

function montarPromptHistoriaGeral(contexto) {
    return `Você é um analista de kart. Faça uma análise GERAL e minimalista retornando apenas a história geral dos principais pontos de como foi a corrida. Leve em consideração Velocidade Pura, Melhor Conjunto e Potencial. Use tom direto, sem exageros e sem inventar dados que não estejam no contexto.\n\nDADOS DA CORRIDA:\n${contexto}`;
}

function montarPromptHistoriaPiloto(nomePiloto, contexto) {
    return `Você é um analista de telemetria de Kart profissional.\nSua missão é gerar um relatório de desempenho seguindo RIGOROSAMENTE o modelo abaixo.\nNão use negritos em excesso, não mude os títulos e mantenha o tom técnico e direto.\n\n--- MODELO A SER SEGUIDO ---\nNome do Piloto\n\nResultado\n[Nome] fez P[X] na tomada, com [Tempo], e terminou a prova com [X] voltas e melhor volta de [Tempo].\n\nLeitura do desempenho\n[Análise resumida do início, meio e fim da prova].\n\nPontos positivos:\n* Item 1\n* Item 2\n\nPontos de atenção:\n* Item 1\n* Item 2\n\nDiagnóstico\n[Resumo técnico do que impediu um resultado melhor].\n\nPróximo foco\n[Dica prática para a próxima corrida].\n--- FIM DO MODELO ---\n\nDADOS REAIS PARA ANALISAR AGORA:\n${contexto}\n\nGere o relatório para o piloto ${nomePiloto} seguindo exatamente a estrutura do modelo acima. Se algum dado estiver ausente, mencione de forma curta que a informação não foi importada.`;
}

async function chamarGeminiHistoria({ apiKey, modelo, prompt, temperature = 0.2, maxOutputTokens = 1600 }) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            contents: [
                {
                    role: "user",
                    parts: [{ text: prompt }]
                }
            ],
            generationConfig: {
                temperature,
                maxOutputTokens
            }
        })
    });

    if (!response.ok) {
        const erro = await response.text();
        throw new Error(`Gemini retornou erro ${response.status}: ${erro.slice(0, 500)}`);
    }

    const data = await response.json();
    const texto = (data.candidates || [])
        .flatMap(c => c?.content?.parts || [])
        .map(part => part.text || "")
        .join("\n")
        .trim();

    if (!texto) throw new Error("Gemini não retornou texto para a história.");

    return texto;
}

async function buscarVoltasDaCorridaParaHistoria({ campRef, etapa, dataCorrida, conteudoVoltaAtual = "", nomeArquivoAtual = "" }) {
    const voltas = [];

    if (conteudoVoltaAtual) {
        voltas.push(...extrairVoltaAVoltaHTMLTexto(conteudoVoltaAtual, nomeArquivoAtual));
    }

    try {
        const voltaSnapshot = await campRef.collection("volta_a_volta").where("dataCorrida", "==", dataCorrida).get();

        voltaSnapshot.forEach(doc => {
            const data = doc.data() || {};

            if (String(data.etapa || "") !== String(etapa || "")) return;
            if (!data.conteudo) return;

            voltas.push(...extrairVoltaAVoltaHTMLTexto(data.conteudo, data.nomeArquivo || doc.id));
        });
    } catch (e) {
        console.warn("Não foi possível buscar volta a volta salvo para história:", e);
    }

    const vistos = new Set();

    return voltas.filter(v => {
        const key = [v.driver_id, normalizarNomeComparacao(v.driver_name), v.volta, v.tempo_volta, v.hora].join("|");
        if (vistos.has(key)) return false;
        vistos.add(key);
        return true;
    });
}

async function coletarDadosCorridaParaHistoria({ campeonato, etapa, dataCorrida, conteudoVoltaAtual = "", nomeArquivoAtual = "" }) {
    const { campeonatoDocId, campRef } = await prepararDocumentoCampeonato(campeonato);
    const resultadoDocId = getResultadoFinalDocId(etapa, dataCorrida);
    const resultadoDocRef = campRef.collection("resultado_final").doc(resultadoDocId);

    const [resultadoDoc, corridaSnapshot, classificacaoSnapshot, voltas] = await Promise.all([
        resultadoDocRef.get(),
        resultadoDocRef.collection("pilotos_resultado").get(),
        resultadoDocRef.collection("classificacao").get(),
        buscarVoltasDaCorridaParaHistoria({ campRef, etapa, dataCorrida, conteudoVoltaAtual, nomeArquivoAtual })
    ]);

    const corrida = corridaSnapshot.docs.map(doc => ({ docId: doc.id, ...(doc.data() || {}) }));
    const classificacao = classificacaoSnapshot.docs.map(doc => ({ docId: doc.id, ...(doc.data() || {}) }));
    const pilotos = montarPilotosParaHistoria(corrida, classificacao, voltas);

    return {
        campeonatoDocId,
        resultadoDocId,
        resultadoDocRef,
        resultadoDoc: resultadoDoc.exists ? (resultadoDoc.data() || {}) : {},
        corrida,
        classificacao,
        voltas,
        pilotos
    };
}

async function salvarHistoriaPilotoFirestore({ resultadoDocRef, piloto, historia, modelo, agoraISO, idImportacaoHistoria = "" }) {
    const itemId = normalizarDocId(piloto.driver_id || piloto.id_piloto || piloto.driver_name || "piloto");
    const payload = toFirestoreSafe({
        driver_id: piloto.driver_id || piloto.id_piloto || "",
        id_piloto: piloto.driver_id || piloto.id_piloto || "",
        driver_name: piloto.driver_name || piloto.nome || "-",
        nome: piloto.driver_name || piloto.nome || "-",
        historia_piloto: historia,
        historia_ia_piloto: historia,
        historia_status: "gerada",
        historiaPilotoAtualizadaEmISO: agoraISO,
        historiaModelo: modelo,
        historiaIdImportacao: idImportacaoHistoria || "",
        idImportacaoHistoria: idImportacaoHistoria || "",
        atualizadoEmISO: agoraISO
    });

    const corridaRef = resultadoDocRef.collection("pilotos_resultado").doc(itemId);
    const classificacaoRef = resultadoDocRef.collection("classificacao").doc(itemId);
    const historiaRef = resultadoDocRef.collection("historias_pilotos").doc(itemId);
    const voltaPilotoRef = resultadoDocRef.collection("volta_a_volta_pilotos").doc(itemId);

    const [classificacaoDoc, corridaDoc] = await Promise.all([
        classificacaoRef.get(),
        corridaRef.get()
    ]);

    const writes = [
        historiaRef.set(payload, { merge: true }),
        voltaPilotoRef.set(payload, { merge: true })
    ];

    // História não cria participante no resultado. Só complementa a linha se
    // ela já tiver vindo do arquivo Resultado Final.
    if (corridaDoc.exists) writes.push(corridaRef.set(payload, { merge: true }));
    if (classificacaoDoc.exists) writes.push(classificacaoRef.set(payload, { merge: true }));

    await Promise.all(writes);
}

async function gerarHistoriasAposImportacao({
    campeonato,
    etapa,
    dataCorrida,
    cfg,
    conteudoVoltaAtual = "",
    nomeArquivoAtual = "",
    status = null,
    pilotosSelecionadosHistoria = null,
    idImportacaoHistoria = ""
}) {
    const config = obterConfigHistoriaIAImportacao();

    if (!config.gerar) return "";

    if (!config.apiKey) {
        return "⚠️ História IA não gerada: informe a chave Gemini no campo de importação.";
    }

    if (status) status.innerHTML = "⏳ Coletando dados da corrida para gerar história com IA...";

    const dados = await coletarDadosCorridaParaHistoria({ campeonato, etapa, dataCorrida, conteudoVoltaAtual, nomeArquivoAtual });
    const selecionadosInformados = Array.isArray(pilotosSelecionadosHistoria)
        ? pilotosSelecionadosHistoria
            .filter(p => p && !p.conflitoId && (p.checked === undefined || p.checked))
            .map(p => ({
                driver_id: String(p.driver_id || p.id_piloto || "").trim(),
                id_piloto: String(p.driver_id || p.id_piloto || "").trim(),
                driver_name: p.driver_name || p.nome || p.piloto || "-",
                nome: p.driver_name || p.nome || p.piloto || "-"
            }))
        : [];

    const pilotosBase = selecionadosInformados.length ? selecionadosInformados : dados.pilotos;

    if (!pilotosBase.length) {
        return "⚠️ História IA não gerada: não encontrei pilotos selecionados na corrida, classificação ou volta a volta.";
    }

    const agoraISO = new Date().toISOString();
    const contextoGeral = montarContextoGeralHistoria({
        campeonato,
        etapa,
        dataCorrida,
        corrida: dados.corrida,
        classificacao: dados.classificacao,
        voltas: dados.voltas,
        pilotosAlvo: pilotosBase
    });

    let historiaGeral = "";
    let falhaGeral = "";

    try {
        if (status) status.innerHTML = "⏳ Gerando história geral da corrida com IA...";

        historiaGeral = await chamarGeminiHistoria({
            apiKey: config.apiKey,
            modelo: config.modelo,
            prompt: montarPromptHistoriaGeral(contextoGeral),
            temperature: 0.2,
            maxOutputTokens: 1200
        });

        await dados.resultadoDocRef.set(toFirestoreSafe({
            campeonato,
            campeonato_id: dados.campeonatoDocId,
            etapa: Number(etapa),
            dataCorrida,
            resultadoDocId: dados.resultadoDocId,
            historia_geral: historiaGeral,
            historia_ia_geral: historiaGeral,
            historiaCorrida: {
                geral: historiaGeral,
                modelo: config.modelo,
                origem: "gemini",
                atualizadoEmISO: agoraISO,
                tipoArquivoDisparador: cfg?.tipo || "",
                idImportacao: idImportacaoHistoria || "",
                idImportacaoHistoria: idImportacaoHistoria || "",
                pilotosSelecionados: pilotosBase.map(p => ({
                    driver_id: p.driver_id || p.id_piloto || "",
                    driver_name: p.driver_name || p.nome || ""
                }))
            },
            historiaAtualizadaEmISO: agoraISO,
            historiaModelo: config.modelo,
            historiaFonte: {
                resultado_final: !!dados.corrida.length,
                classificacao: !!dados.classificacao.length,
                volta_a_volta: !!dados.voltas.length,
                arquivoAtual: nomeArquivoAtual || ""
            },
            historiaPilotosSelecionados: pilotosBase.map(p => ({
                driver_id: p.driver_id || p.id_piloto || "",
                driver_name: p.driver_name || p.nome || ""
            })),
            historiaIdImportacao: idImportacaoHistoria || "",
            idImportacaoHistoria: idImportacaoHistoria || "",
            historiaGeralStatus: "gerada",
            atualizadoEmISO: agoraISO
        }), { merge: true });
    } catch (e) {
        console.error("Falha ao gerar história geral:", e);
        falhaGeral = e.message || String(e);

        await dados.resultadoDocRef.set(toFirestoreSafe({
            campeonato,
            campeonato_id: dados.campeonatoDocId,
            etapa: Number(etapa),
            dataCorrida,
            resultadoDocId: dados.resultadoDocId,
            historiaGeralStatus: "erro",
            historiaGeralErro: falhaGeral,
            historiaModelo: config.modelo,
            historiaIdImportacao: idImportacaoHistoria || "",
            idImportacaoHistoria: idImportacaoHistoria || "",
            historiaAtualizadaEmISO: agoraISO,
            atualizadoEmISO: agoraISO
        }), { merge: true });
    }

    const pilotosParaGerar = pilotosBase.slice(0, 30);
    let geradosPiloto = 0;
    let falhasPiloto = 0;

    for (const piloto of pilotosParaGerar) {
        if (status) {
            status.innerHTML = `⏳ Gerando história do piloto ${htmlEscape(piloto.driver_name || "-")} (${geradosPiloto + falhasPiloto + 1}/${pilotosParaGerar.length})...`;
        }

        const contextoPiloto = montarContextoPilotoHistoria({
            piloto,
            corrida: dados.corrida,
            classificacao: dados.classificacao,
            voltas: dados.voltas
        });

        try {
            const historiaPiloto = await chamarGeminiHistoria({
                apiKey: config.apiKey,
                modelo: config.modelo,
                prompt: montarPromptHistoriaPiloto(piloto.driver_name || "Piloto", contextoPiloto),
                temperature: 0.1,
                maxOutputTokens: 1600
            });

            await salvarHistoriaPilotoFirestore({
                resultadoDocRef: dados.resultadoDocRef,
                piloto,
                historia: historiaPiloto,
                modelo: config.modelo,
                agoraISO,
                idImportacaoHistoria
            });

            geradosPiloto += 1;
        } catch (e) {
            console.error(`Falha ao gerar história do piloto ${piloto.driver_name || piloto.driver_id || "-"}:`, e);
            falhasPiloto += 1;

            const itemId = normalizarDocId(piloto.driver_id || piloto.id_piloto || piloto.driver_name || "piloto");
            const payloadErro = toFirestoreSafe({
                driver_id: piloto.driver_id || piloto.id_piloto || "",
                id_piloto: piloto.driver_id || piloto.id_piloto || "",
                driver_name: piloto.driver_name || piloto.nome || "-",
                nome: piloto.driver_name || piloto.nome || "-",
                historia_status: "erro",
                historiaErro: e.message || String(e),
                historiaModelo: config.modelo,
                historiaIdImportacao: idImportacaoHistoria || "",
                idImportacaoHistoria: idImportacaoHistoria || "",
                historiaPilotoAtualizadaEmISO: agoraISO,
                atualizadoEmISO: agoraISO
            });

            const corridaErroRef = dados.resultadoDocRef.collection("pilotos_resultado").doc(itemId);
            const corridaErroSnap = await corridaErroRef.get();
            const writesErro = [
                dados.resultadoDocRef.collection("historias_pilotos").doc(itemId).set(payloadErro, { merge: true }),
                dados.resultadoDocRef.collection("volta_a_volta_pilotos").doc(itemId).set(payloadErro, { merge: true })
            ];
            if (corridaErroSnap.exists) writesErro.push(corridaErroRef.set(payloadErro, { merge: true }));
            await Promise.all(writesErro);
        }
    }

    const partes = [];
    partes.push(historiaGeral ? "história geral" : `história geral com erro${falhaGeral ? ` (${falhaGeral})` : ""}`);
    partes.push(`${geradosPiloto} história(s) individual(is) salva(s)`);
    if (falhasPiloto) partes.push(`${falhasPiloto} falha(s) individual(is)`);

    return `📖 História IA processada: ${partes.join(" + ")}.`;
}

function registrarHistoriaUICache(historia) {
    const id = `hist_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const data = typeof historia === "object" && historia !== null
        ? historia
        : { texto: String(historia || "").trim() };
    HISTORIAS_UI_CACHE[id] = {
        texto: String(data.texto || data.historia || "").trim(),
        audioDataUrl: String(data.audioDataUrl || data.audioUrl || data.historia_audio_url || data.historia_audio_data_url || data.audio_url || "").trim(),
        contexto: data.contexto || null
    };
    return id;
}

function historiaTemConteudo(item) {
    return !!(String(item?.texto || "").trim() || String(item?.audioDataUrl || "").trim());
}

async function salvarAudioHistoriaManual(ctx, file) {
    if (!file) return {};
    if (!firebase.storage) throw new Error("Firebase Storage não está disponível para enviar áudio.");

    const nomeSeguro = normalizarDocId(file.name || "audio.mp3");
    const alvo = ctx?.tipo === "piloto"
        ? normalizarDocId(ctx?.piloto?.driver_id || ctx?.piloto?.id_piloto || ctx?.piloto?.driver_name || "piloto")
        : "corrida";
    const caminho = [
        "historias_audio",
        normalizarDocId(ctx?.campeonatoDocId || "campeonato"),
        normalizarDocId(ctx?.resultadoDocId || "resultado"),
        normalizarDocId(ctx?.tipo || "historia"),
        `${alvo}_${Date.now()}_${nomeSeguro}`
    ].join("/");

    const ref = firebase.storage().ref(caminho);
    await ref.put(file, {
        contentType: file.type || "audio/mpeg",
        customMetadata: {
            tipoHistoria: String(ctx?.tipo || ""),
            resultadoDocId: String(ctx?.resultadoDocId || ""),
            piloto: String(ctx?.piloto?.driver_name || ctx?.piloto?.nome || "")
        }
    });

    return {
        audioUrl: await ref.getDownloadURL(),
        audioPath: caminho,
        audioNome: file.name || "audio",
        audioTipo: file.type || "audio/mpeg",
        audioTamanho: file.size || 0
    };
}

async function salvarHistoriaManual(ctx, texto, audioInfo = {}) {
    if (!ctx?.campeonatoDocId || !ctx?.resultadoDocId) throw new Error("Vínculo da corrida não encontrado.");

    const agoraISO = new Date().toISOString();
    const resultadoDocRef = firestore
        .collection(COLLECTION_CAMPEONATOS)
        .doc(ctx.campeonatoDocId)
        .collection("resultado_final")
        .doc(ctx.resultadoDocId);

    if (ctx.tipo === "piloto") {
        const piloto = ctx.piloto || {};
        await salvarHistoriaPilotoFirestore({
            resultadoDocRef,
            piloto,
            historia: texto,
            modelo: "manual",
            agoraISO,
            idImportacaoHistoria: ctx.idImportacaoHistoria || ""
        });

        const itemId = normalizarDocId(piloto.driver_id || piloto.id_piloto || piloto.driver_name || "piloto");
        const payloadAudio = toFirestoreSafe({
            historia_audio_url: audioInfo.audioUrl || "",
            historia_audio_path: audioInfo.audioPath || "",
            historia_audio_nome: audioInfo.audioNome || "",
            historia_audio_tipo: audioInfo.audioTipo || "",
            historia_audio_tamanho: audioInfo.audioTamanho || 0,
            historia_audio_atualizada_em_iso: audioInfo.audioUrl ? agoraISO : "",
            historia_origem: "manual",
            atualizadoEmISO: agoraISO
        });
        const classificacaoRef = resultadoDocRef.collection("classificacao").doc(itemId);
        const corridaRef = resultadoDocRef.collection("pilotos_resultado").doc(itemId);
        const [classificacaoSnap, corridaSnap] = await Promise.all([classificacaoRef.get(), corridaRef.get()]);
        const writes = [
            resultadoDocRef.collection("historias_pilotos").doc(itemId).set(payloadAudio, { merge: true }),
            resultadoDocRef.collection("volta_a_volta_pilotos").doc(itemId).set(payloadAudio, { merge: true })
        ];
        if (corridaSnap.exists) writes.push(corridaRef.set(payloadAudio, { merge: true }));
        if (classificacaoSnap.exists) writes.push(classificacaoRef.set(payloadAudio, { merge: true }));
        await Promise.all(writes);
        return;
    }

    await resultadoDocRef.set(toFirestoreSafe({
        historia_geral: texto,
        historia_ia_geral: texto,
        historiaCorrida: { geral: texto, audioUrl: audioInfo.audioUrl || "", origem: "manual" },
        historia_audio_url: audioInfo.audioUrl || "",
        historia_audio_path: audioInfo.audioPath || "",
        historia_audio_nome: audioInfo.audioNome || "",
        historia_audio_tipo: audioInfo.audioTipo || "",
        historia_audio_tamanho: audioInfo.audioTamanho || 0,
        historiaAtualizadaEmISO: agoraISO,
        historiaModelo: "manual",
        historiaGeralStatus: "gerada",
        atualizadoEmISO: agoraISO
    }), { merge: true });
}

function abrirLancamentoHistoriaModal(ctx, onSaved) {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;";
    overlay.innerHTML = `
        <div style="width:100%;max-width:680px;max-height:86vh;overflow:auto;background:#1d2129;border:1px solid #394150;border-radius:14px;padding:16px;box-shadow:0 10px 40px rgba(0,0,0,.35);">
            <h3 style="margin:0 0 10px 0;color:#ffeb3b;">Lançar história</h3>
            <p class="hint">O lançamento ficará vinculado automaticamente à data/etapa selecionada${ctx?.tipo === "piloto" ? " e ao piloto" : ""}.</p>
            <label class="file-label">História em texto</label>
            <textarea id="historiaManualTexto" rows="8" placeholder="Digite a história completa..."></textarea>
            <label class="file-label">História em áudio</label>
            <input id="historiaManualAudio" type="file" accept="audio/*">
            <div class="inline-actions">
                <button id="historiaManualSalvar">Salvar história</button>
                <button id="historiaManualCancelar" style="background:#2b3240;border:1px solid #3a4252;">Cancelar</button>
            </div>
            <div id="historiaManualStatus" class="feedback"></div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("#historiaManualCancelar")?.addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", ev => { if (ev.target === overlay) overlay.remove(); });
    overlay.querySelector("#historiaManualSalvar")?.addEventListener("click", async () => {
        const status = overlay.querySelector("#historiaManualStatus");
        const texto = String(overlay.querySelector("#historiaManualTexto")?.value || "").trim();
        const audioFile = overlay.querySelector("#historiaManualAudio")?.files?.[0] || null;
        if (!texto && !audioFile) { alert("Informe a história em texto ou selecione um áudio."); return; }
        if (!await pedirSenhaAdmin()) return;
        try {
            if (status) status.textContent = audioFile ? "Enviando áudio..." : "Salvando história...";
            const audioInfo = await salvarAudioHistoriaManual(ctx, audioFile);
            if (status) status.textContent = "Salvando história...";
            await salvarHistoriaManual(ctx, texto, audioInfo);
            if (status) status.textContent = "✅ História salva.";
            setTimeout(() => { overlay.remove(); if (typeof onSaved === "function") onSaved(); }, 500);
        } catch (e) {
            console.error(e);
            if (status) status.innerHTML = `<span class="error">❌ ${htmlEscape(e.message || e)}</span>`;
        }
    });
}

function abrirHistoriaModal(titulo, historia) {
    const item = typeof historia === "object" && historia !== null ? historia : { texto: String(historia || "").trim() };
    if (!historiaTemConteudo(item)) {
        alert("sem história");
    }

    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;";
    const modal = document.createElement("div");
    modal.style.cssText = "width:100%;max-width:760px;max-height:82vh;overflow:auto;background:#1d2129;border:1px solid #394150;border-radius:14px;padding:16px;box-shadow:0 10px 40px rgba(0,0,0,.35);";
    modal.innerHTML = `<h3 style="margin:0 0 10px 0;color:#ffeb3b;">${htmlEscape(titulo || "História")}</h3>`;

    if (historiaTemConteudo(item)) {
        if (item.audioDataUrl) modal.innerHTML += `<audio controls style="width:100%;margin:6px 0 12px 0;" src="${htmlEscape(item.audioDataUrl)}"></audio>`;
        modal.innerHTML += `<div style="white-space:pre-wrap;line-height:1.45;color:white;font-size:14px;">${htmlEscape(item.texto || "")}</div>`;
    } else {
        modal.innerHTML += `<div style="background:#3a2814;border:1px solid #ff9800;color:#ffcc80;border-radius:10px;padding:12px;margin:10px 0;">sem história</div>`;
    }

    const actions = document.createElement("div");
    actions.className = "inline-actions";
    if (!historiaTemConteudo(item) && item.contexto) {
        const lancar = document.createElement("button");
        lancar.textContent = "Lançar história";
        lancar.addEventListener("click", () => abrirLancamentoHistoriaModal(item.contexto, () => { overlay.remove(); renderRankingCorridaFirestore(); }));
        actions.appendChild(lancar);
    }
    const btn = document.createElement("button");
    btn.textContent = "FECHAR";
    btn.style.cssText = "background:#2b3240;border:1px solid #3a4252;";
    btn.addEventListener("click", () => overlay.remove());
    actions.appendChild(btn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    overlay.addEventListener("click", ev => { if (ev.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

function abrirHistoriaCache(id, titulo) {
    abrirHistoriaModal(titulo || "História", HISTORIAS_UI_CACHE[id] || { texto: "" });
}

window.abrirHistoriaCache = abrirHistoriaCache;
window.abrirHistoriaModal = abrirHistoriaModal;

async function salvarSelecionadosNoFirestore({ campeonato, etapa, dataCorrida, cfg, selecionados, nomeArquivo, backupId = "" }) {
    const { campeonatoDocId, campRef } = await prepararDocumentoCampeonato(campeonato);

    const resultadoDocId = getResultadoFinalDocId(etapa, dataCorrida);
    const importId = backupId || `${dataCorrida}_${normalizarChave(campeonato)}_${cfg.tipo}_etapa_${etapa}_${Date.now()}`;
    const resultadoDocRef = campRef.collection("resultado_final").doc(resultadoDocId);
    const agoraISO = new Date().toISOString();
    const stageKey = StageIntegrity.createStageKey(campeonatoDocId, etapa, dataCorrida);

    await resultadoDocRef.set(toFirestoreSafe({
        campeonato,
        campeonato_id: campeonatoDocId,
        etapa: Number(etapa),
        dataCorrida,
        resultadoDocId,
        stageKey,
        atualizadoEmISO: agoraISO,
        caminhoBackup: backupId ? `${COLLECTION_BACKUPS}/${backupId}` : "",
        caminhoFirestore: `${COLLECTION_CAMPEONATOS}/${campeonatoDocId}/resultado_final/${resultadoDocId}`
    }), { merge: true });

    const vinculados = (selecionados || []).map(normalizarIdentidadePilotoVinculado);
    const resolucaoIdentidade = await resolverPersistirIdentidades(vinculados, null, { campeonato_id: campeonatoDocId, etapa_id: resultadoDocId, fase: cfg.tipo });
    const selecionadosCanonicos = resolucaoIdentidade.rows;

    await salvarPilotosImportadosNoFirestore({
        campeonato,
        selecionados: selecionadosCanonicos
    });

    const batch = firestore.batch();
    const subcollectionName = cfg.tipo === "classificacao" ? "classificacao" : "pilotos_resultado";
    const resumoField = cfg.tipo === "classificacao" ? "classificacaoResumo" : "resultadoFinalResumo";

    selecionadosCanonicos.forEach((p, idx) => {
        const itemId = FirestoreIntegrity.requireFirestoreId(p.pilot_uid, "pilot_uid", { campeonato_id: campeonatoDocId, etapa_id: resultadoDocId, fase: cfg.tipo, index: idx });
        const ref = resultadoDocRef.collection(subcollectionName).doc(itemId);

        batch.set(ref, toFirestoreSafe({
            ...selectEndFirebasePayload(p, { nomeArquivo }),
            campeonato,
            campeonato_id: campeonatoDocId,
            etapa: Number(etapa),
            dataCorrida,
            stageKey,
            tipoArquivo: cfg.tipo,
            tipoLabel: cfg.label,
            idImportacao: importId,
            nomeArquivo: nomeArquivo || "",
            id_piloto: p.driver_id || "",
            pilot_uid: p.pilot_uid,
            driver_name_display: p.driver_name_display || p.driver_name || "",
            driver_name_original: p.driver_name_original || p.driver_name || "",
            normalizationVersion: NORMALIZATION_VERSION,
            posicao_geral_arquivo: Number(p.posicao_final || p.pos || p.posicao_geral_arquivo || 0),
            kart_numero: p.kart_numero || "",
            melhor_tempo: p.melhor_tempo || "",
            melhor_tempo_segundos: p.melhor_tempo_segundos ?? null,
            melhor_tempo_ponto: Number(p.melhor_tempo_ponto || 0),
            total_tempo_segundos: p.total_tempo_segundos ?? null,
            voltas: p.voltas ?? null,
            classe: p.classe || "",
            comentarios: p.comentarios || "",
            s1_melhor_vlt: p.s1_melhor_vlt ?? null,
            s2_melhor_vlt: p.s2_melhor_vlt ?? null,
            s3_melhor_vlt: p.s3_melhor_vlt ?? null,
            sfspd_melhor_vlt: p.sfspd_melhor_vlt ?? null,
            caminhoBackup: backupId ? `${COLLECTION_BACKUPS}/${backupId}` : "",
            criadoEmISO: agoraISO,
            atualizadoEmISO: agoraISO
        }), { merge: true });
    });

    batch.set(resultadoDocRef, toFirestoreSafe({
        [resumoField]: {
            tipoArquivo: cfg.tipo,
            tipoLabel: cfg.label,
            idImportacao: importId,
            nomeArquivo: nomeArquivo || "",
            campeonato_id: campeonatoDocId,
            etapa: Number(etapa),
            dataCorrida,
            stageKey,
            qtdSelecionados: selecionadosCanonicos.length,
            atualizadoEmISO: agoraISO,
            pilotosSelecionados: selecionadosCanonicos.map((p, idx) => ({
                ordem: idx + 1,
                pilot_uid: p.pilot_uid,
                id_piloto: p.driver_id || "",
                driver_id: p.driver_id || "",
                driver_name: p.driver_name || "",
                posicao_geral_arquivo: Number(p.posicao_final || p.pos || p.posicao_geral_arquivo || 0),
                posicao_final2: Number(p.posicao_final2 || 0),
                pontos: Number(p.pontos || 0),
                melhor_tempo: p.melhor_tempo || "",
                melhor_tempo_ponto: Number(p.melhor_tempo_ponto || 0)
            }))
        },
        ultimoTipoArquivoImportado: cfg.tipo,
        ultimoIdImportacao: importId,
        atualizadoEmISO: agoraISO
    }), { merge: true });

    await batch.commit();
    await carregarDadosBaseFirestore();
    popularFiltros();
    renderGestao();

    return {
        importId,
        resultadoDocId,
        caminhoFirestore: `${COLLECTION_CAMPEONATOS}/${campeonatoDocId}/resultado_final/${resultadoDocId}`,
        subcollection: subcollectionName
    };
}

async function fazerBackupEProcessar() {
    if (!await pedirSenhaAdmin()) return;
    const campeonato = document.getElementById("imp_camp")?.value || "";
    const etapa = document.getElementById("imp_etapa")?.value || "";
    const dataCorrida = document.getElementById("imp_data")?.value || "";
    const status = document.getElementById("statusImport");
    const cfg = getTipoArquivoSelecionado();
    const file = document.getElementById("fileImportacaoUnico")?.files?.[0];
    const btn = event?.target;
    const textoOriginalBotao = btn?.innerText;

    if (!campeonato) return alert("Selecione o campeonato!");
    if (!etapa) return alert("Informe a etapa!");
    if (!dataCorrida) return alert("Informe a data da corrida!");
    if (!cfg) return alert("Selecione o tipo de arquivo!");
    if (!file) return alert("Selecione o arquivo que será importado!");

    try {
        if (btn) {
            btn.disabled = true;
            btn.innerText = "⏳ SALVANDO NO FIRESTORE...";
        }

        if (status) status.innerHTML = `⏳ Salvando ${cfg.label} no Firestore...`;

        const conteudoRaw = isArquivoTexto(file) ? await file.text() : "";
        const dataUrl = await arquivoParaDataUrl(file);
        const idUnico = `${dataCorrida}_${normalizarChave(campeonato)}_${cfg.tipo}_${Date.now()}`;
        const backupPayload = montarBackupPayload({ campeonato, etapa, dataCorrida, cfg, file, conteudoRaw, dataUrl, idUnico });
        const backupInfo = await salvarBackupImportacaoNoFirestore(backupPayload);

        if (!cfg.usaPreview) {
            const caminho = await salvarArquivoSemPreviewNoFirestore({
                campeonato,
                etapa,
                dataCorrida,
                cfg,
                backupPayload,
                backupId: idUnico
            });

            let historiaMsg = "";
            let pilotosSelecionadosHistoria = [];

            if (cfg.tipo === "volta_a_volta") {
                if (!IMPORTACAO_PREVIA.length && conteudoRaw) {
                    const voltas = extrairVoltaAVoltaHTMLTexto(conteudoRaw, file.name);
                    montarImportacaoPreviaVoltaAVolta(voltas, campeonato, true);
                }

                pilotosSelecionadosHistoria = obterPilotosSelecionadosHistoriaVoltaAVolta(campeonato);

                if (pilotosSelecionadosHistoria.length) {
                    await salvarPilotosSelecionadosVoltaAVoltaNoFirestore({
                        campeonato,
                        etapa,
                        dataCorrida,
                        selecionados: pilotosSelecionadosHistoria,
                        backupId: idUnico,
                        nomeArquivo: file.name
                    });
                }
            }

            try {
                if (cfg.tipo === "volta_a_volta" && obterConfigHistoriaIAImportacao().gerar && !pilotosSelecionadosHistoria.length) {
                    historiaMsg = "⚠️ Arquivo salvo, mas nenhuma história individual foi gerada porque nenhum piloto foi marcado ou vinculado manualmente na prévia do Volta a volta.";
                } else {
                    historiaMsg = await gerarHistoriasAposImportacao({
                        campeonato,
                        etapa,
                        dataCorrida,
                        cfg,
                        conteudoVoltaAtual: cfg.tipo === "volta_a_volta" ? conteudoRaw : "",
                        nomeArquivoAtual: file.name,
                        status,
                        pilotosSelecionadosHistoria: cfg.tipo === "volta_a_volta" ? pilotosSelecionadosHistoria : null,
                        idImportacaoHistoria: cfg.tipo === "volta_a_volta" ? idUnico : ""
                    });
                }
            } catch (historiaErro) {
                console.error(historiaErro);
                historiaMsg = `⚠️ Arquivo salvo, mas a história IA falhou: ${historiaErro.message || historiaErro}`;
            }

            if (status) {
                status.innerHTML = `✅ ${cfg.label} salvo no Firestore. Caminho: ${htmlEscape(caminho)}. Backup: ${htmlEscape(backupInfo.caminhoFirestore)}.${historiaMsg ? `<br>${htmlEscape(historiaMsg)}` : ""}`;
            }

            await recalcularEPersistirDashboardAposImportacao({
                campeonato,
                etapa,
                dataCorrida,
                conteudoVoltaAtual: cfg.tipo === "volta_a_volta" ? conteudoRaw : "",
                nomeArquivoVoltaAtual: cfg.tipo === "volta_a_volta" ? file.name : "",
                idImportacaoVoltaAtual: cfg.tipo === "volta_a_volta" ? idUnico : ""
            });

            document.getElementById("fileImportacaoUnico").value = "";
            await inicializarRankingFirestore();
            return;
        }

        if (!conteudoRaw && !IMPORTACAO_PYSCRIPT.length) {
            if (status) {
                status.innerHTML = `⚠️ Arquivo salvo em ${htmlEscape(backupInfo.caminhoFirestore)}, mas não foi possível gerar prévia. Para Resultado final/Classificação, use HTML, HTM ou XML.`;
            }
            return;
        }

        const registrosPyScript = Array.isArray(IMPORTACAO_PYSCRIPT) &&
            IMPORTACAO_PYSCRIPT.length &&
            IMPORTACAO_PYSCRIPT_ARQUIVO === file.name &&
            IMPORTACAO_PYSCRIPT_TIPO === cfg.tipo
            ? IMPORTACAO_PYSCRIPT
            : [];

        if (!IMPORTACAO_PREVIA.length) {
            if (registrosPyScript.length) {
                montarImportacaoPreviaDoArquivo(registrosPyScript, campeonato, cfg.tipo, false, false);
            } else {
                analisarHTML(conteudoRaw, campeonato, dataCorrida, cfg.tipo, false);
            }

            await marcarPilotosJaVinculadosAoCampeonato(campeonato, true);
        }

        const selecionadosAntesDoCalculo = IMPORTACAO_PREVIA.filter(i => i.checked && !i.conflitoId);

        if (!selecionadosAntesDoCalculo.length) {
            if (status) {
                status.innerHTML = `⚠️ ${cfg.label} salvo no backup global do Firestore. Marque ao menos um piloto no checkbox para salvar os selecionados.`;
            }
            recalcularPreviewImportacao(campeonato, true, false);
            const btnConfirmar = document.getElementById("btnConfirmarImportacao");
            if (btnConfirmar) btnConfirmar.style.display = "none";
            return;
        }

        const deveCalcularPontos = cfg.tipo === "resultado_final" || cfg.tipo === "classificacao";
        recalcularPreviewImportacao(campeonato, true, deveCalcularPontos);

        const selecionadosParaSalvar = IMPORTACAO_PREVIA
            .filter(i => i.checked && !i.conflitoId)
            .sort((a, b) => a.posGeral - b.posGeral);

        const saveInfo = await salvarSelecionadosNoFirestore({
            campeonato,
            etapa,
            dataCorrida,
            cfg,
            selecionados: selecionadosParaSalvar,
            nomeArquivo: file.name,
            backupId: idUnico
        });

        await recalcularEPersistirDashboardAposImportacao({
            campeonato,
            etapa,
            dataCorrida
        });

        let historiaMsg = "";

        try {
            historiaMsg = await gerarHistoriasAposImportacao({
                campeonato,
                etapa,
                dataCorrida,
                cfg,
                conteudoVoltaAtual: "",
                nomeArquivoAtual: file.name,
                status
            });
        } catch (historiaErro) {
            console.error(historiaErro);
            historiaMsg = `⚠️ Dados salvos, mas a história IA falhou: ${historiaErro.message || historiaErro}`;
        }

        if (status) {
            status.innerHTML = `✅ ${cfg.label} salvo no Firestore com ${selecionadosParaSalvar.length} piloto(s). Caminho: ${htmlEscape(saveInfo.caminhoFirestore)}.${historiaMsg ? `<br>${htmlEscape(historiaMsg)}` : ""}`;
        }

        const btnConfirmar = document.getElementById("btnConfirmarImportacao");
        if (btnConfirmar) btnConfirmar.style.display = "none";

        await inicializarRankingFirestore();
    } catch (e) {
        console.error(e);
        if (status) status.innerHTML = `❌ Erro ao gravar no Firestore: ${htmlEscape(e.message || e)}`;
        alert("Erro ao gravar no Firestore. Veja o console para detalhes.");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = textoOriginalBotao || "SALVAR ARQUIVO / GERAR PRÉVIA";
        }
    }
}

function normalizarRegistroImportacao(item) {
    const driverName = item.driver_name || item.nome || item.piloto || item.piloto_original || "";
    const driverId = item.driver_id || item.id_piloto || "";
    const posicaoFinal = item.posicao_final || item.pos || item.posicao || item.posicao_geral_arquivo || "";

    return {
        driver_id: String(driverId || "").trim(),
        driver_name: String(driverName || "").trim(),
        nome: String(driverName || "").trim(),
        id_piloto: String(driverId || "").trim(),
        pos: String(posicaoFinal || "").trim(),
        posicao_final: parseInt(posicaoFinal) || 0,
        posicao_geral_arquivo: parseInt(posicaoFinal) || 0,
        posGeral: parseInt(posicaoFinal) || 9999,
        arquivo_origem: item.arquivo_origem || "",
        evento: item.evento || "",
        kart_numero: item.kart_numero || "",
        classe: item.classe || "",
        melhor_tempo: item.melhor_tempo || "",
        melhor_tempo_segundos: item.melhor_tempo_segundos ?? tempoParaSegundosJS(item.melhor_tempo),
        melhor_tempo_ponto: 0,
        total_tempo: item.total_tempo || "",
        total_tempo_segundos: item.total_tempo_segundos ?? "",
        diff: item.diff || "",
        espaco: item.espaco || "",
        s1_melhor_vlt: item.s1_melhor_vlt ?? "",
        s2_melhor_vlt: item.s2_melhor_vlt ?? "",
        s3_melhor_vlt: item.s3_melhor_vlt ?? "",
        sfspd_melhor_vlt: item.sfspd_melhor_vlt ?? "",
        voltas: item.voltas ?? "",
        comentarios: item.comentarios || "",
        piloto_original: item.piloto_original || ""
    };
}

function montarImportacaoPreviaDoArquivo(registros, campeonato = "", tipoArquivo = "resultado_final", exibirHint = false, calcularPontos = false) {
    const encontrados = (registros || [])
        .map(normalizarRegistroImportacao)
        .filter(item => item.driver_name && item.posicao_final)
        .filter((r, i, arr) =>
            arr.findIndex(x =>
                x.driver_name === r.driver_name &&
                x.posicao_final === r.posicao_final &&
                String(x.driver_id) === String(r.driver_id)
            ) === i
        );

    IMPORTACAO_PREVIA = encontrados.map(item => aplicarSugestaoVinculoPilotoImportacao({
        ...item,
        tipoArquivo
    }, campeonato));

    recalcularPreviewImportacao(campeonato, exibirHint, calcularPontos);

    return IMPORTACAO_PREVIA;
}

function montarSelectVinculoPilotoImportacao(item, idx) {
    const candidatosIds = new Set([...(item.pilotosSugeridos || [])]);
    if (item.pilotoVinculadoDocId) candidatosIds.add(item.pilotoVinculadoDocId);

    const sugeridos = Array.from(candidatosIds)
        .map(id => DB.pilotos.find(p => String(p.id || "") === String(id || "")))
        .filter(Boolean);
    const demais = DB.pilotos
        .filter(p => !candidatosIds.has(p.id))
        .sort((a, b) => String(a.nome || a.driver_name || "").localeCompare(String(b.nome || b.driver_name || "")));
    const candidatos = [...sugeridos, ...demais];
    const options = [`<option value="">Criar novo cadastro</option>`];

    candidatos.forEach(p => {
        const sugerido = candidatosIds.has(p.id);
        const label = `${sugerido ? "★ " : ""}${p.nome || p.driver_name || p.id}${p.driver_id || p.id_piloto ? ` — ID ${p.driver_id || p.id_piloto}` : " — sem ID"}`;
        options.push(`<option value="${htmlEscape(p.id)}"${String(item.pilotoVinculadoDocId || "") === String(p.id || "") ? " selected" : ""}>${htmlEscape(label)}</option>`);
    });

    return `<select id="imp_piloto_link_${idx}" onchange="alterarVinculoPilotoImportacao(${idx})">${options.join("")}</select>`;
}

function alterarVinculoPilotoImportacao(idx) {
    const item = IMPORTACAO_PREVIA[idx];
    if (!item) return;

    const select = document.getElementById(`imp_piloto_link_${idx}`);
    const docId = String(select?.value || "").trim();
    const piloto = docId ? DB.pilotos.find(p => String(p.id || "") === docId) : null;

    item.pilotoVinculadoDocId = docId;
    item.criarNovoPiloto = !docId;
    item.conflitoId = false;
    item.checked = true;
    item.vinculoSelecionadoManualmente = true;

    if (piloto) {
        item.status = `Vincular ao cadastro: ${piloto.nome || piloto.driver_name || piloto.id}`;
    } else if (item.driver_id || item.id_piloto) {
        item.status = "Criar novo cadastro com o driver_id do arquivo";
    } else {
        item.status = "Criar novo cadastro sem id_piloto; o ID será preenchido em importação futura";
    }

    const campeonato = document.getElementById("imp_camp")?.value || "";
    const cfg = getTipoArquivoSelecionado();
    const tipoArquivo = cfg?.tipo || item.tipoArquivo || "";
    const deveRecalcularAutomatico = tipoArquivo === "resultado_final" || tipoArquivo === "classificacao" || IMPORTACAO_PREVIA_GERADA;

    recalcularPreviewImportacao(campeonato, true, deveRecalcularAutomatico);
}

window.alterarVinculoPilotoImportacao = alterarVinculoPilotoImportacao;

function analisarHTML(htmlText, campeonato = "", dataCorrida = "", tipoArquivo = "resultado_final", calcularPontos = false) {
    const doc = new DOMParser().parseFromString(htmlText, "text/html");
    const rows = doc.querySelectorAll("tr");
    const encontrados = [];

    rows.forEach(row => {
        const tds = row.querySelectorAll("td");
        if (!tds.length) return;

        const textos = Array.from(tds)
            .map(td => (td.innerText || "").trim())
            .filter(Boolean);

        const pos = textos.find(t => /^\d+$/.test(t));
        if (!pos) return;

        const pilotoOriginal = textos.find(t => /^\[\d+\]\s*.+/.test(t)) || "";
        const idDoNome = pilotoOriginal.match(/^\[(\d+)\]\s*(.+)$/);
        const possivelId = idDoNome
            ? idDoNome[1]
            : textos.find(t => /^\d{3,}$/.test(t) && t !== pos) || "";
        const nome = idDoNome
            ? idDoNome[2]
            : textos.find(t => /[a-zA-ZÀ-ÿ]/.test(t) && t !== possivelId) || "";
        const melhorTempo = textos.find(t => /^\d+:\d{2}([.,]\d+)?$/.test(t)) || "";

        if (!nome) return;

        encontrados.push({
            driver_name: nome,
            driver_id: possivelId,
            posicao_final: pos,
            posicao_geral_arquivo: Number(pos) || 0,
            melhor_tempo: melhorTempo,
            melhor_tempo_segundos: tempoParaSegundosJS(melhorTempo)
        });
    });

    return montarImportacaoPreviaDoArquivo(encontrados, campeonato, tipoArquivo, true, calcularPontos);
}

function recalcularPreviewImportacao(campeonato, exibirHint = false, calcularPontos = false) {
    IMPORTACAO_PREVIA = (IMPORTACAO_PREVIA.length ? IMPORTACAO_PREVIA : [])
        .sort((a, b) => (a.posGeral || 9999) - (b.posGeral || 9999));

    const cfg = getTipoArquivoSelecionado() || TIPOS_ARQUIVO.find(t => t.tipo === IMPORTACAO_PREVIA[0]?.tipoArquivo);
    const tipoArquivo = cfg?.tipo || IMPORTACAO_PREVIA[0]?.tipoArquivo || "";
    const selecionadosOrdenados = IMPORTACAO_PREVIA
        .filter(i => i.checked && !i.conflitoId)
        .sort((a, b) => a.posGeral - b.posGeral);
    const deveCalcularPontos = calcularPontos && selecionadosOrdenados.length > 0;

    IMPORTACAO_PREVIA.forEach(item => {
        item.melhor_tempo_ponto = 0;
    });

    if (tipoArquivo === "resultado_final" && deveCalcularPontos) {
        const rankPorItem = new Map();
        let ultimoPos = null;
        let rankAtual = 0;

        selecionadosOrdenados.forEach((item, idx) => {
            if (item.posGeral !== ultimoPos) {
                rankAtual = idx + 1;
                ultimoPos = item.posGeral;
            }

            rankPorItem.set(item, rankAtual);
        });

        IMPORTACAO_PREVIA.forEach(item => {
            item.posicao_final2 = item.checked && !item.conflitoId ? rankPorItem.get(item) || 0 : 0;
            item.posCampeonato = item.posicao_final2;
            item.pontos = item.posicao_final2 ? StageIntegrity.getPointsForChampionshipPosition(PONTOS_PADRAO, item.posicao_final2) : 0;
            item.origemPontuacao = item.posicao_final2 ? "Pontuação padrão da importação" : "-";
        });

        IMPORTACAO_PREVIA_GERADA = true;
    } else if (tipoArquivo === "classificacao" && deveCalcularPontos) {
        IMPORTACAO_PREVIA.forEach(item => {
            item.posicao_final2 = 0;
            item.posCampeonato = 0;
            item.pontos = 0;
            item.origemPontuacao = "Aguardando melhor tempo";
        });

        IMPORTACAO_PREVIA_GERADA = true;
    } else if (tipoArquivo === "volta_a_volta") {
        IMPORTACAO_PREVIA.forEach(item => {
            item.posicao_final2 = 0;
            item.posCampeonato = 0;
            item.pontos = 0;
            item.melhor_tempo_ponto = 0;
            item.origemPontuacao = "História individual";
        });

        IMPORTACAO_PREVIA_GERADA = true;
    } else {
        IMPORTACAO_PREVIA.forEach(item => {
            item.posicao_final2 = 0;
            item.posCampeonato = 0;
            item.pontos = 0;
            item.origemPontuacao = "Aguardando cálculo";
        });

        IMPORTACAO_PREVIA_GERADA = false;
    }

    if (deveCalcularPontos && selecionadosOrdenados.length) {
        const temposValidos = selecionadosOrdenados
            .map(item => ({ item, segundos: obterMelhorTempoSegundos(item) }))
            .filter(x => x.segundos !== null && Number.isFinite(x.segundos));

        if (temposValidos.length) {
            const menorTempo = Math.min(...temposValidos.map(x => x.segundos));

            temposValidos.forEach(({ item, segundos }) => {
                item.melhor_tempo_ponto = segundos === menorTempo ? 1 : 0;

                if (tipoArquivo === "classificacao" && item.melhor_tempo_ponto === 1) {
                    item.pontos = 1;
                    item.origemPontuacao = "1 ponto pelo melhor tempo";
                }

                if (tipoArquivo === "resultado_final" && item.melhor_tempo_ponto === 1) {
                    item.origemPontuacao = `${item.origemPontuacao || "Pontuação"} + melhor tempo`;
                }
            });
        }
    }

    const titulo = cfg?.tipo === "classificacao"
        ? "Classificação"
        : cfg?.tipo === "volta_a_volta"
            ? "Volta a volta / História IA"
            : "Resultado Final";
    const tituloEtapa = cfg?.tipo === "volta_a_volta"
        ? "Seleção de Pilotos para História"
        : IMPORTACAO_PREVIA_GERADA ? "Prévia de Importação" : "Seleção de Pilotos";

    let h = `<h3>${tituloEtapa} — ${htmlEscape(titulo)}</h3>`;

    if (!IMPORTACAO_PREVIA.length) {
        h += "<p class='muted'>Nenhum piloto identificado no arquivo.</p>";
    }

    if (tipoArquivo === "volta_a_volta") {
        h += `
            <div style="max-width:100%; overflow:auto;">
                <table>
                    <tr>
                        <th>Gerar história?</th>
                        <th>driver_id</th>
                        <th>driver_name</th>
                        <th>Cadastro vinculado</th>
                        <th>Kart</th>
                        <th>Melhor volta no arquivo</th>
                        <th>Voltas no arquivo</th>
                        <th>Status</th>
                    </tr>
        `;
    } else {
        h += `
            <div style="max-width:100%; overflow:auto;">
                <table>
                    <tr>
                        <th>Importar?</th>
                        <th>driver_id</th>
                        <th>driver_name</th>
                        <th>Cadastro vinculado</th>
                        <th>Pos. geral</th>
                        <th>Pos. importação</th>
                        <th>Pontos</th>
                        <th>Melhor tempo?</th>
                        <th>Kart</th>
                        <th>Melhor tempo</th>
                        <th>Voltas</th>
                        <th>Status</th>
                    </tr>
        `;
    }

    IMPORTACAO_PREVIA.forEach((i, idx) => {
        const disabled = i.conflitoId ? "disabled" : "";
        const posicaoCalculada = i.posicao_final2 ? i.posicao_final2 : "-";
        const pontosCalculados = i.pontos || i.pontos === 0 ? i.pontos : "-";
        const melhorTempoPonto = Number(i.melhor_tempo_ponto || 0);

        if (tipoArquivo === "volta_a_volta") {
            h += `
                <tr>
                    <td>
                        <input
                            type="checkbox"
                            id="imp_chk_${idx}"
                            ${i.checked ? "checked" : ""}
                            ${disabled}
                            onchange="toggleSelecionadoImport(${idx})"
                        >
                    </td>
                    <td>${htmlEscape(i.driver_id || "-")}</td>
                    <td>${htmlEscape(i.driver_name || "-")}</td>
                    <td>${montarSelectVinculoPilotoImportacao(i, idx)}</td>
                    <td>${htmlEscape(i.kart_numero || "-")}</td>
                    <td>${htmlEscape(i.melhor_tempo || "-")}</td>
                    <td>${htmlEscape(i.voltas || "-")}</td>
                    <td>${htmlEscape(i.status)}</td>
                </tr>
            `;
        } else {
            h += `
                <tr>
                    <td>
                        <input
                            type="checkbox"
                            id="imp_chk_${idx}"
                            ${i.checked ? "checked" : ""}
                            ${disabled}
                            onchange="toggleSelecionadoImport(${idx})"
                        >
                    </td>
                    <td>${htmlEscape(i.driver_id || "-")}</td>
                    <td>${htmlEscape(i.driver_name || "-")}</td>
                    <td>${montarSelectVinculoPilotoImportacao(i, idx)}</td>
                    <td>${htmlEscape(i.posicao_final || i.pos || "-")}</td>
                    <td>${posicaoCalculada}</td>
                    <td>${pontosCalculados}</td>
                    <td>${melhorTempoPonto}</td>
                    <td>${htmlEscape(i.kart_numero || "-")}</td>
                    <td>${htmlEscape(i.melhor_tempo || "-")}</td>
                    <td>${htmlEscape(i.voltas || "-")}</td>
                    <td>${htmlEscape(i.status)}</td>
                </tr>
            `;
        }
    });

    h += `
            </table>
        </div>
    `;

    if (exibirHint) {
        if (IMPORTACAO_PREVIA_GERADA) {
            h += `
                <p class='hint'>
                    Cálculo feito apenas com os pilotos marcados.
                    Selecionados: ${selecionadosOrdenados.length}.
                    O campo "Melhor tempo?" recebe 1 para o menor Melhor Tempo entre os selecionados e 0 para os demais.
                </p>
            `;
        } else if (tipoArquivo === "volta_a_volta") {
            h += `
                <p class='hint'>
                    Pilotos sem driver_id podem ser vinculados a um cadastro similar ou cadastrados pelo nome.
                    Os marcados serão cadastrados/vinculados ao campeonato e receberão história individual quando você salvar o Volta a volta com a opção de IA ligada.
                    Quando um arquivo futuro trouxer driver_id para um cadastro sem ID, o sistema preencherá esse campo no cadastro vinculado.
                </p>
            `;
        } else {
            h += `
                <p class='hint'>
                    Apenas vínculos encontrados por ID ou nome completo ficam marcados automaticamente.
                    Marque manualmente pilotos novos ou sugestões que devem ser cadastrados/vinculados.
                    Para Resultado Final/Classificação, posições, pontos e melhor tempo serão recalculados com base nos marcados.
                </p>
            `;
        }
    }

    const preview = document.getElementById("previewImportacao");
    if (preview) preview.innerHTML = h;
}

function toggleSelecionadoImport(idx) {
    const campeonato = document.getElementById("imp_camp")?.value || "";
    const cfg = getTipoArquivoSelecionado();

    if (!IMPORTACAO_PREVIA[idx]) return;

    IMPORTACAO_PREVIA[idx].checked = !!document.getElementById(`imp_chk_${idx}`)?.checked;

    const tipoArquivo = cfg?.tipo || IMPORTACAO_PREVIA[idx]?.tipoArquivo || "";
    const deveRecalcularAutomatico = tipoArquivo === "resultado_final" || tipoArquivo === "classificacao" || IMPORTACAO_PREVIA_GERADA;

    recalcularPreviewImportacao(campeonato, true, deveRecalcularAutomatico);

    const selecionados = IMPORTACAO_PREVIA.filter(i => i.checked && !i.conflitoId);
    const statusTexto = String(document.getElementById("statusImport")?.innerText || "").toLowerCase();
    const arquivoJaFoiSalvo = statusTexto.includes("salvo") || statusTexto.includes("prévia gerada") || statusTexto.includes("prévia gerada");

    const btnConfirmar = document.getElementById("btnConfirmarImportacao");
    if (btnConfirmar) {
        btnConfirmar.style.display = arquivoJaFoiSalvo && selecionados.length ? "block" : "none";
    }
}

async function confirmarImportacao() {
    const campeonato = document.getElementById("imp_camp")?.value || "";
    const etapa = document.getElementById("imp_etapa")?.value || "";
    const data = document.getElementById("imp_data")?.value || "";
    const cfg = getTipoArquivoSelecionado();
    const file = document.getElementById("fileImportacaoUnico")?.files?.[0];
    const status = document.getElementById("statusImport");

    if (!campeonato) return alert("Selecione o campeonato!");
    if (!etapa) return alert("Informe a etapa!");
    if (!data) return alert("Informe a data da corrida!");
    if (!cfg || !cfg.usaPreview) return alert("Selecione Resultado final ou Classificação para importar pilotos.");

    const deveCalcularPontos = cfg.tipo === "resultado_final" || cfg.tipo === "classificacao";
    recalcularPreviewImportacao(campeonato, true, deveCalcularPontos);

    const selecionados = IMPORTACAO_PREVIA
        .filter(i => i.checked && !i.conflitoId)
        .sort((a, b) => a.posGeral - b.posGeral);

    if (!selecionados.length) return alert("Selecione ao menos um piloto.");

    const nomeArquivo = file?.name || IMPORTACAO_PYSCRIPT_ARQUIVO || "";

    if (status) status.innerHTML = `⏳ Importando ${selecionados.length} piloto(s) para o Firestore...`;

    try {
        const saveInfo = await salvarSelecionadosNoFirestore({
            campeonato,
            etapa,
            dataCorrida: data,
            cfg,
            selecionados,
            nomeArquivo
        });

        await recalcularEPersistirDashboardAposImportacao({
            campeonato,
            etapa,
            dataCorrida: data
        });

        let historiaMsg = "";

        try {
            historiaMsg = await gerarHistoriasAposImportacao({
                campeonato,
                etapa,
                dataCorrida: data,
                cfg,
                conteudoVoltaAtual: "",
                nomeArquivoAtual: nomeArquivo,
                status
            });
        } catch (historiaErro) {
            console.error(historiaErro);
            historiaMsg = `⚠️ Dados salvos, mas a história IA falhou: ${historiaErro.message || historiaErro}`;
        }

        if (status) {
            status.innerHTML = `✅ Importação concluída e resumos atualizados. ${selecionados.length} piloto(s) processado(s).${historiaMsg ? `<br>${htmlEscape(historiaMsg)}` : ""}`;
        }

        alert(`✅ Importação concluída com ${selecionados.length} piloto(s).${historiaMsg ? " História IA processada." : ""}`);

        const btnConfirmar = document.getElementById("btnConfirmarImportacao");
        if (btnConfirmar) btnConfirmar.style.display = "none";

        await inicializarRankingFirestore();
    } catch (e) {
        console.error(e);
        if (status) status.innerHTML = `❌ Erro ao gravar no Firestore: ${htmlEscape(e.message || e)}`;
        alert("Erro ao gravar no Firestore. Veja o console para detalhes.");
    }
}

async function receberImportacaoPyScript(payloadJson) {
    try {
        const payload = typeof payloadJson === "string" ? JSON.parse(payloadJson || "{}") : (payloadJson || {});

        IMPORTACAO_PYSCRIPT = Array.isArray(payload.registros) ? payload.registros : [];
        IMPORTACAO_PYSCRIPT_ARQUIVO = payload.arquivo || "";
        IMPORTACAO_PYSCRIPT_TIPO = payload.tipo || "";

        const campeonato = document.getElementById("imp_camp")?.value || "";
        const tipoAtual = document.getElementById("imp_tipo_arquivo")?.value || "";

        IMPORTACAO_PREVIA_GERADA = false;

        if (IMPORTACAO_PYSCRIPT.length && IMPORTACAO_PYSCRIPT_TIPO === tipoAtual) {
            montarImportacaoPreviaDoArquivo(IMPORTACAO_PYSCRIPT, campeonato, IMPORTACAO_PYSCRIPT_TIPO, true, false);

            const btnConfirmar = document.getElementById("btnConfirmarImportacao");
            if (btnConfirmar) btnConfirmar.style.display = "none";

            if (campeonato) {
                await marcarPilotosJaVinculadosAoCampeonato(campeonato, true);
            } else {
                const status = document.getElementById("statusImport");
                if (status) status.innerHTML = "✅ Arquivo lido. Selecione o campeonato para marcar automaticamente pilotos já vinculados.";
            }
        }
    } catch (e) {
        console.error("Falha ao receber dados do PyScript:", e);
    }
}

window.receberImportacaoPyScript = receberImportacaoPyScript;
window.receberResultadoFinalPyScript = receberImportacaoPyScript;


async function carregarHistorico() {
    const lista = document.getElementById("listaHistorico");
    const detalhe = document.getElementById("arquivosDoDia");

    if (lista) lista.innerHTML = "Carregando dias...";
    if (detalhe) detalhe.innerHTML = "";

    try {
        const snapshot = await firestore
            .collection(COLLECTION_BACKUPS)
            .orderBy("dataUploadISO", "desc")
            .limit(100)
            .get();

        HISTORICO_CACHE = [];

        snapshot.forEach(doc => {
            HISTORICO_CACHE.push({
                key: doc.id,
                ...doc.data()
            });
        });

        if (!HISTORICO_CACHE.length) {
            if (lista) lista.innerHTML = "<p class='muted'>Nenhum arquivo encontrado.</p>";
            return;
        }

        const grupos = {};

        HISTORICO_CACHE.forEach(item => {
            const dia = extrairDataItem(item);
            if (!grupos[dia]) grupos[dia] = [];
            grupos[dia].push(item);
        });

        const dias = Object.keys(grupos).sort((a, b) => b.localeCompare(a));

        if (lista) {
            lista.innerHTML = dias.map(dia => {
                const itens = grupos[dia];
                const camps = [...new Set(itens.map(i => i.campeonato).filter(Boolean))].join(", ") || "Sem campeonato";

                return `<button class="btn-day" onclick="renderArquivosDoDia('${dia}')">
                    📅 ${formatarDataBR(dia)}<br>
                    <small>${htmlEscape(camps)} • ${itens.length} arquivo(s)</small>
                </button>`;
            }).join("");
        }
    } catch (e) {
        console.error(e);
        if (lista) lista.innerHTML = `<p class='muted error'>Erro ao carregar histórico do Firestore: ${htmlEscape(e.message || e)}</p>`;
    }
}

function renderArquivosDoDia(dia) {
    const detalhe = document.getElementById("arquivosDoDia");
    if (!detalhe) return;

    const ordem = {
        volta_a_volta: 1,
        classificacao: 2,
        resultado_final: 3
    };

    const itens = HISTORICO_CACHE
        .filter(item => extrairDataItem(item) === dia)
        .sort((a, b) =>
            (a.campeonato || "").localeCompare(b.campeonato || "") ||
            (ordem[a.tipoArquivo] || 9) - (ordem[b.tipoArquivo] || 9)
        );

    const arquivosHtml = itens.map(item => {
        const aviso = item.arquivoCompletoSalvoNoFirestore === false
            ? "<br><small class='muted'>Arquivo bruto grande: salvo como metadados.</small>"
            : "";

        return `<div class="arquivo-card">
            <div>
                <strong>${htmlEscape(item.tipoLabel || item.tipoArquivo || "Arquivo")}</strong><br>
                <small>${htmlEscape(item.campeonato || "Sem campeonato")} • ${htmlEscape(item.nomeArquivo || "-")}</small>
                ${aviso}
            </div>
            <span class="actions">
                <button class="btn-view" onclick="verConteudo('${item.key}')">VER</button>
                <button class="btn-view" style="background:#8b1f1f;" onclick="excluirImportacao('${item.key}')">EXCLUIR</button>
            </span>
        </div>`;
    }).join("");

    let html = `<h3>📅 Arquivos de ${formatarDataBR(dia)}</h3>`;
    html += `<div class="tabs">
        <button id="tabConsultaArquivos" class="tab-btn active-tab" onclick="trocarAbaConsulta('arquivos','${dia}')">Arquivos</button>
        <button id="tabConsultaCorrida" class="tab-btn" onclick="trocarAbaConsulta('corrida','${dia}')">Corrida</button>
        <button id="tabConsultaClassificacao" class="tab-btn" onclick="trocarAbaConsulta('classificacao','${dia}')">Classificação</button>
    </div>`;
    html += `<div id="consultaAbaArquivos">${arquivosHtml || "<p class='muted'>Nenhum arquivo para este dia.</p>"}</div><div id="consultaAbaResultado" style="display:none;"></div>`;

    detalhe.innerHTML = html;
    const resultado = document.getElementById("resultadoDoDia");
    if (resultado) resultado.innerHTML = "";
}

function popularPilotosFiltroDia(dia, tipoAba) {
    const camp = document.getElementById(`filtroCampDia_${tipoAba}`)?.value || "";
    const etapaSel = document.getElementById(`filtroEtapaDia_${tipoAba}`)?.value || "";
    const sel = document.getElementById(`filtroPilotosDia_${tipoAba}`);
    if (!sel) return;
    const itens = HISTORICO_CACHE.filter(item =>
        extrairDataItem(item) === dia &&
        (!camp || item.campeonato === camp) &&
        (!etapaSel || String(item.etapa || "") === String(etapaSel))
    );
    const pilotos = [...new Set(itens.flatMap(i => (i.pilotosImportadosResumo || []).map(p => p.driver_name).filter(Boolean)))].sort();
    sel.innerHTML = pilotos.map(p => `<option value="${htmlEscape(p)}">${htmlEscape(p)}</option>`).join("");
}

async function verConteudo(key) {
    try {
        const doc = await firestore.collection(COLLECTION_BACKUPS).doc(key).get();
        const item = doc.exists ? doc.data() : null;
        const win = window.open("", "_blank");

        if (!item) return win.document.write("Arquivo não encontrado no Firestore.");

        const mime = item.mimeType || "";
        const dataUrl = item.dataUrl || "";

        if (mime.includes("pdf") && dataUrl) {
            return win.document.write(`<iframe src="${dataUrl}" style="width:100%;height:100vh;border:0;"></iframe>`);
        }

        if (item.conteudo) {
            return win.document.write(item.conteudo);
        }

        if (dataUrl) {
            return win.document.write(`<iframe src="${dataUrl}" style="width:100%;height:100vh;border:0;"></iframe>`);
        }

        win.document.write(`<pre style="white-space:pre-wrap;font-family:monospace;">${htmlEscape(JSON.stringify(item, null, 2))}</pre>`);
    } catch (e) {
        console.error(e);
        alert(`Erro ao abrir arquivo do Firestore: ${e.message || e}`);
    }
}

function firestoreDeleteValue() {
    return firebase.firestore.FieldValue.delete();
}

function refPathFirestore(ref) {
    return ref?.path || "";
}

async function executarBatchFirestore(operacoes, tamanhoLote = 400) {
    const ops = (operacoes || []).filter(Boolean);
    let total = 0;

    for (let i = 0; i < ops.length; i += tamanhoLote) {
        const batch = firestore.batch();
        const lote = ops.slice(i, i + tamanhoLote);

        lote.forEach(op => {
            if (!op?.ref) return;

            if (op.tipo === "delete") {
                batch.delete(op.ref);
            } else if (op.tipo === "update") {
                batch.update(op.ref, op.payload || {});
            } else if (op.tipo === "set") {
                batch.set(op.ref, op.payload || {}, op.options || { merge: true });
            }
        });

        await batch.commit();
        total += lote.length;
    }

    return total;
}

async function coletarDocsPorQueryFirestore(query, mapaDocs) {
    try {
        const snap = await query.get();
        snap.forEach(doc => mapaDocs.set(refPathFirestore(doc.ref), doc));
    } catch (e) {
        console.warn("Não foi possível consultar documentos para exclusão:", e);
    }
}

function adicionarPilotoRelacionadoExclusao(mapaPilotos, data = {}, docId = "") {
    const driverId = String(data.driver_id || data.id_piloto || data.driverId || "").trim();
    const docIdSeguro = String(docId || "").trim();
    const chave = driverId || docIdSeguro;

    if (!chave) return;

    mapaPilotos.set(normalizarDocId(chave), {
        docId: normalizarDocId(chave),
        driver_id: driverId || docIdSeguro,
        driver_name: data.driver_name || data.nome || data.piloto || ""
    });
}

function importacaoVoltaAVoltaPertenceAoBackup(data = {}, key = "") {
    return String(data.ultimoVoltaAVoltaImportado || "") === String(key || "") ||
        String(data?.voltaAVoltaResumo?.idImportacao || "") === String(key || "") ||
        String(data.historiaIdImportacao || data.idImportacaoHistoria || "") === String(key || "") ||
        String(data?.historiaCorrida?.idImportacao || data?.historiaCorrida?.idImportacaoHistoria || "") === String(key || "");
}

function payloadLimpezaHistoriaVoltaAVolta() {
    const del = firestoreDeleteValue();

    return {
        historia_piloto: del,
        historia_ia_piloto: del,
        historia_status: del,
        historiaErro: del,
        historiaModelo: del,
        historiaPilotoAtualizadaEmISO: del,
        historiaIdImportacao: del,
        idImportacaoHistoria: del,
        selecionado_para_historia: del,
        ultimoVoltaAVoltaImportado: del,
        voltas_volta_a_volta: del,
        melhor_tempo_volta_a_volta: del,
        melhor_tempo_volta_a_volta_segundos: del,
        atualizadoEmISO: new Date().toISOString()
    };
}

function payloadLimpezaResumoVoltaAVolta() {
    const del = firestoreDeleteValue();

    return {
        historia_geral: del,
        historia_ia_geral: del,
        historiaCorrida: del,
        historiaAtualizadaEmISO: del,
        historiaModelo: del,
        historiaFonte: del,
        historiaPilotosSelecionados: del,
        historiaGeralStatus: del,
        historiaGeralErro: del,
        historiaIdImportacao: del,
        idImportacaoHistoria: del,
        ultimoVoltaAVoltaImportado: del,
        voltaAVoltaResumo: del,
        atualizadoEmISO: new Date().toISOString()
    };
}

function docPilotosResultadoFoiCriadoApenasPeloVoltaAVolta(data = {}, key = "") {
    const temResultadoFinal = data.tipoArquivo === "resultado_final" ||
        data.resultadoFinalResumo ||
        data.posicao_final2 !== undefined ||
        data.pontos !== undefined ||
        data.total_tempo !== undefined ||
        data.total_tempo_segundos !== undefined ||
        data.posicao_geral_arquivo !== undefined;

    const temClassificacao = data.tipoArquivo === "classificacao";

    return String(data.ultimoVoltaAVoltaImportado || "") === String(key || "") &&
        !data.idImportacao &&
        !temResultadoFinal &&
        !temClassificacao;
}

async function excluirDadosVoltaAVoltaRelacionados({ key, item, campRef, resultRef, resultadoDocId }) {
    const operacoes = [];
    const docsParaDeletar = new Map();
    const pilotosRelacionados = new Map();
    const campId = campRef.id;

    const resultadoDoc = await resultRef.get();
    const resultadoData = resultadoDoc.exists ? (resultadoDoc.data() || {}) : {};

    if (importacaoVoltaAVoltaPertenceAoBackup(resultadoData, key)) {
        (resultadoData?.voltaAVoltaResumo?.pilotosSelecionados || []).forEach(p => adicionarPilotoRelacionadoExclusao(pilotosRelacionados, p, p.driver_id || p.id_piloto));
        (resultadoData?.historiaPilotosSelecionados || []).forEach(p => adicionarPilotoRelacionadoExclusao(pilotosRelacionados, p, p.driver_id || p.id_piloto));
        operacoes.push({ tipo: "update", ref: resultRef, payload: payloadLimpezaResumoVoltaAVolta() });
    }

    await coletarDocsPorQueryFirestore(
        campRef.collection("volta_a_volta").where("idImportacao", "==", key),
        docsParaDeletar
    );
    await coletarDocsPorQueryFirestore(
        campRef.collection("volta_a_volta").where("caminhoBackup", "==", `${COLLECTION_BACKUPS}/${key}`),
        docsParaDeletar
    );

    const docVoltaEsperado = campRef.collection("volta_a_volta").doc(`${resultadoDocId}_${normalizarDocId(key)}`);
    const docVoltaEsperadoSnap = await docVoltaEsperado.get();
    if (docVoltaEsperadoSnap.exists) docsParaDeletar.set(refPathFirestore(docVoltaEsperado), docVoltaEsperadoSnap);

    await coletarDocsPorQueryFirestore(
        resultRef.collection("volta_a_volta_pilotos").where("idImportacao", "==", key),
        docsParaDeletar
    );
    await coletarDocsPorQueryFirestore(
        resultRef.collection("historias_pilotos").where("historiaIdImportacao", "==", key),
        docsParaDeletar
    );
    await coletarDocsPorQueryFirestore(
        resultRef.collection("historias_pilotos").where("idImportacaoHistoria", "==", key),
        docsParaDeletar
    );
    await coletarDocsPorQueryFirestore(
        resultRef.collection("historias_pilotos").where("idImportacao", "==", key),
        docsParaDeletar
    );

    docsParaDeletar.forEach(doc => {
        const data = doc.data() || {};
        adicionarPilotoRelacionadoExclusao(pilotosRelacionados, data, doc.id);
    });

    // Para importações antigas, a história individual pode ter sido salva em historias_pilotos
    // sem guardar o id da importação. Nesses casos, removemos pelo driver_id selecionado no volta_a_volta_pilotos.
    for (const piloto of pilotosRelacionados.values()) {
        const docId = normalizarDocId(piloto.driver_id || piloto.docId || "");
        if (!docId) continue;

        const historiaRef = resultRef.collection("historias_pilotos").doc(docId);
        const voltaPilotoRef = resultRef.collection("volta_a_volta_pilotos").doc(docId);

        const [historiaSnap, voltaSnap] = await Promise.all([
            historiaRef.get(),
            voltaPilotoRef.get()
        ]);

        if (historiaSnap.exists) docsParaDeletar.set(refPathFirestore(historiaRef), historiaSnap);
        if (voltaSnap.exists) docsParaDeletar.set(refPathFirestore(voltaPilotoRef), voltaSnap);

        const corridaRef = resultRef.collection("pilotos_resultado").doc(docId);
        const classificacaoRef = resultRef.collection("classificacao").doc(docId);
        const [corridaSnap, classificacaoSnap] = await Promise.all([
            corridaRef.get(),
            classificacaoRef.get()
        ]);

        if (corridaSnap.exists) {
            const dataCorridaDoc = corridaSnap.data() || {};
            if (docPilotosResultadoFoiCriadoApenasPeloVoltaAVolta(dataCorridaDoc, key)) {
                docsParaDeletar.set(refPathFirestore(corridaRef), corridaSnap);
            } else {
                operacoes.push({ tipo: "update", ref: corridaRef, payload: payloadLimpezaHistoriaVoltaAVolta() });
            }
        }

        if (classificacaoSnap.exists) {
            operacoes.push({
                tipo: "update",
                ref: classificacaoRef,
                payload: {
                    historia_piloto: firestoreDeleteValue(),
                    historia_ia_piloto: firestoreDeleteValue(),
                    historia_status: firestoreDeleteValue(),
                    historiaErro: firestoreDeleteValue(),
                    historiaModelo: firestoreDeleteValue(),
                    historiaPilotoAtualizadaEmISO: firestoreDeleteValue(),
                    historiaIdImportacao: firestoreDeleteValue(),
                    idImportacaoHistoria: firestoreDeleteValue(),
                    atualizadoEmISO: new Date().toISOString()
                }
            });
        }
    }

    docsParaDeletar.forEach(doc => {
        operacoes.push({ tipo: "delete", ref: doc.ref });
    });

    const totalOps = await executarBatchFirestore(operacoes);

    return {
        totalOps,
        pilotosAfetados: pilotosRelacionados.size,
        campId
    };
}

async function limparMetadadosDaImportacaoExcluida({ resultRef, tipoArquivo, key }) {
    const snap = await resultRef.get();
    if (!snap.exists) return;

    const data = snap.data() || {};
    const del = firestoreDeleteValue();
    const payload = { atualizadoEmISO: new Date().toISOString() };

    if (tipoArquivo === "resultado_final" && String(data?.resultadoFinalResumo?.idImportacao || "") === String(key || "")) {
        payload.resultadoFinalResumo = del;
    }

    if (tipoArquivo === "classificacao" && String(data?.classificacaoResumo?.idImportacao || "") === String(key || "")) {
        payload.classificacaoResumo = del;
    }

    // O fluxo específico do Volta a volta já remove estes campos quando o
    // backup excluído é o que estava ativo. Este fallback cobre registros
    // antigos que não passaram por aquela rotina.
    if (tipoArquivo === "volta_a_volta" && importacaoVoltaAVoltaPertenceAoBackup(data, key)) {
        Object.assign(payload, payloadLimpezaResumoVoltaAVolta());
    }

    if (String(data.ultimoIdImportacao || "") === String(key || "")) {
        payload.ultimoIdImportacao = del;
        payload.ultimoTipoArquivoImportado = del;
    }

    if (String(data.caminhoBackup || "").endsWith(`/${key}`)) {
        payload.caminhoBackup = del;
    }

    await resultRef.set(payload, { merge: true });
}

async function dashboardEtapaPossuiFontePersistida({ campRef, resultRef, etapa, dataCorrida }) {
    const [corridaSnap, classificacaoSnap, voltaPilotosSnap, voltaDocsSnap] = await Promise.all([
        resultRef.collection("pilotos_resultado").limit(1).get(),
        resultRef.collection("classificacao").limit(1).get(),
        resultRef.collection("volta_a_volta_pilotos").limit(1).get(),
        campRef.collection("volta_a_volta").get()
    ]);

    const etapaNumero = Number(etapa || 0);
    const dataEtapa = String(dataCorrida || "");
    const temVoltaRaw = voltaDocsSnap.docs.some(doc => {
        const data = doc.data() || {};
        const etapaDoc = Number(data.etapa || 0);
        const dataDoc = String(data.dataCorrida || "");
        if (etapaNumero && etapaDoc && etapaNumero !== etapaDoc) return false;
        if (dataEtapa && dataDoc && dataEtapa !== dataDoc) return false;
        return (etapaNumero && etapaDoc) || (dataEtapa && dataDoc);
    });

    return !corridaSnap.empty || !classificacaoSnap.empty || !voltaPilotosSnap.empty || temVoltaRaw;
}

async function atualizarDashboardAposExclusaoImportacao({ campeonato, etapa, dataCorrida, campRef, resultRef }) {
    const possuiFonte = await dashboardEtapaPossuiFontePersistida({
        campRef,
        resultRef,
        etapa,
        dataCorrida
    });

    if (possuiFonte) {
        await recalcularPersistirResumoEtapaDashboard({
            campeonato,
            etapa,
            dataCorrida,
            atualizarGeral: false
        });
    } else {
        const del = firestoreDeleteValue();
        await resultRef.set({
            dashboardResumo: del,
            dashboardResumoVersao: del,
            dashboardResumoAtualizadoEmISO: del,
            resultadoFinalResumo: del,
            classificacaoResumo: del,
            voltaAVoltaResumo: del,
            ultimoVoltaAVoltaImportado: del,
            dashboardOculto: true,
            atualizadoEmISO: new Date().toISOString()
        }, { merge: true });
    }

    await recalcularPersistirResumoGeralDashboard(campRef.id, campeonato);
    limparCacheDashboardCampeonato(campRef.id);
    return possuiFonte;
}

async function excluirImportacao(key) {
    if (!await pedirSenhaAdmin()) return;
    if (!confirm("Excluir importação e todos os dados relacionados nas collections/subcollections? O dashboard da etapa será recalculado automaticamente.")) return;

    const doc = await firestore.collection(COLLECTION_BACKUPS).doc(key).get();
    if (!doc.exists) return alert("Importação não encontrada.");

    const item = doc.data() || {};
    const campeonato = String(item.campeonato || "").trim();
    const campId = normalizarDocId(campeonato);
    const dataCorrida = item.dataCorrida || extrairDataItem(item);
    const etapa = item.etapa || "sem_etapa";
    const resultadoDocId = getResultadoFinalDocId(etapa, dataCorrida);
    const campRef = firestore.collection(COLLECTION_CAMPEONATOS).doc(campId);
    const resultRef = campRef.collection("resultado_final").doc(resultadoDocId);
    const tipoArquivo = String(item.tipoArquivo || item.tipo || "").trim();
    let totalOps = 0;

    try {
        if (tipoArquivo === "volta_a_volta") {
            const infoVolta = await excluirDadosVoltaAVoltaRelacionados({
                key,
                item,
                campRef,
                resultRef,
                resultadoDocId
            });
            totalOps += infoVolta.totalOps;
        } else {
            const operacoes = [];
            const subcollections = tipoArquivo === "classificacao"
                ? ["classificacao"]
                : (tipoArquivo === "resultado_final" ? ["pilotos_resultado"] : ["pilotos_resultado", "classificacao"]);

            for (const sub of subcollections) {
                const snap = await resultRef.collection(sub).where("idImportacao", "==", key).get();
                snap.forEach(d => operacoes.push({ tipo: "delete", ref: d.ref }));
            }

            totalOps += await executarBatchFirestore(operacoes);
        }

        await limparMetadadosDaImportacaoExcluida({
            resultRef,
            tipoArquivo,
            key
        });

        // O backup é removido somente depois dos dados derivados. Assim, se
        // alguma etapa falhar, ainda existe fonte para recuperação manual.
        await firestore.collection(COLLECTION_BACKUPS).doc(key).delete();

        const etapaAindaExiste = await atualizarDashboardAposExclusaoImportacao({
            campeonato,
            etapa,
            dataCorrida,
            campRef,
            resultRef
        });

        alert(
            `Importação excluída com sucesso. ${totalOps} registro(s) relacionado(s) foram removidos/limpos. ` +
            (etapaAindaExiste
                ? "O dashboard da etapa e o geral foram recalculados com os arquivos restantes."
                : "Como não restaram arquivos da etapa, ela foi removida da visualização do dashboard e o geral foi recalculado.")
        );

        await carregarHistorico();
        await inicializarRankingFirestore();
    } catch (e) {
        console.error(e);
        alert(`Erro ao excluir importação: ${e.message || e}`);
    }
}

async function renderResultadoDia(dia) {
    const tipoAba = window.CONSULTA_ABA_ATUAL || "corrida";
    const alvo = document.getElementById("consultaAbaResultado");
    if (!alvo) return;

    const camps = [...new Set(HISTORICO_CACHE.filter(item => extrairDataItem(item) === dia).map(i => i.campeonato).filter(Boolean))];
    const selectAnterior = document.getElementById(`filtroCampDia_${tipoAba}`);
    const campAtual = selectAnterior?.value || camps[0] || "";

    const camp = campAtual;
    const etapasDisponiveis = [...new Set(
        HISTORICO_CACHE
            .filter(item => extrairDataItem(item) === dia && item.campeonato === camp)
            .map(item => String(item.etapa || "").trim())
            .filter(Boolean)
    )]
        .sort((a, b) => Number(a) - Number(b));
    const selectEtapaAnterior = document.getElementById(`filtroEtapaDia_${tipoAba}`);
    const etapaAtual = etapasDisponiveis.includes(selectEtapaAnterior?.value || "")
        ? selectEtapaAnterior.value
        : (etapasDisponiveis.length === 1 ? etapasDisponiveis[0] : "");

    alvo.innerHTML = `<div class="consulta-subcard"><label class="file-label">Campeonato</label><select id="filtroCampDia_${tipoAba}" onchange="renderResultadoDia('${dia}')"><option value="">Selecione</option>${camps.map(c => `<option value="${htmlEscape(c)}"${c === campAtual ? " selected" : ""}>${htmlEscape(c)}</option>`).join("")}</select>${camp ? `<label class="file-label">Etapa</label><select id="filtroEtapaDia_${tipoAba}" onchange="renderResultadoDia('${dia}')"><option value="">${etapasDisponiveis.length > 1 ? "Selecione a etapa" : "Etapa"}</option>${etapasDisponiveis.map(e => `<option value="${htmlEscape(e)}"${e === etapaAtual ? " selected" : ""}>${htmlEscape(e)}</option>`).join("")}</select>` : ""}<label class="file-label">Pilotos (multi)</label><select id="filtroPilotosDia_${tipoAba}" multiple onchange="renderResultadoDia('${dia}')"></select><div id="consultaTabelaDia"></div></div>`;
    popularPilotosFiltroDia(dia, tipoAba);

    const campSelecionado = document.getElementById(`filtroCampDia_${tipoAba}`)?.value || "";
    const etapaSelecionada = document.getElementById(`filtroEtapaDia_${tipoAba}`)?.value || "";
    if (!campSelecionado) {
        document.getElementById("consultaTabelaDia").innerHTML = "<p class='muted'>Selecione um campeonato para visualizar os dados.</p>";
        return;
    }
    if (etapasDisponiveis.length > 1 && !etapaSelecionada) {
        document.getElementById("consultaTabelaDia").innerHTML = "<p class='muted'>Selecione a etapa para visualizar os dados sem duplicidade.</p>";
        return;
    }

    const pilotosSel = Array.from(document.getElementById(`filtroPilotosDia_${tipoAba}`)?.selectedOptions || []).map(o => o.value);
    const campId = normalizarDocId(campSelecionado);
    const resultados = await firestore.collection(COLLECTION_CAMPEONATOS).doc(campId).collection("resultado_final").where("dataCorrida", "==", dia).get();
    const docsFiltrados = etapaSelecionada
        ? resultados.docs.filter(r => String(r.data()?.etapa || "") === String(etapaSelecionada))
        : resultados.docs;
    const corrida = [];
    const classificacao = [];
    for (const r of docsFiltrados) {
        const [s1, s2] = await Promise.all([r.ref.collection("pilotos_resultado").get(), r.ref.collection("classificacao").get()]);
        s1.forEach(d => corrida.push(d.data()));
        s2.forEach(d => classificacao.push(d.data()));
    }
    const filtra = rows => rows.filter(x => !pilotosSel.length || pilotosSel.includes(x.driver_name));
    const colsResumo = tipoAba === "classificacao"
        ? [["posicao_geral_arquivo", "Pos"], ["driver_name", "Piloto"], ["melhor_tempo", "Melhor volta"]]
        : [["posicao_geral_arquivo", "Pos"], ["driver_name", "Piloto"], ["total_tempo", "T.Total"]];
    const detalhesCorrida = [["melhor_tempo", "Melhor Vlt"], ["s1_melhor_vlt", "S1 Melhor Vlt"], ["s2_melhor_vlt", "S2 Melhor Vlt"], ["s3_melhor_vlt", "S3 Melhor Vlt"], ["sfspd_melhor_vlt", "SFSpd Melhor Vlt"], ["kart_number", "Kart"], ["best_lap", "Volta"]];
    const detalhesClassificacao = [["melhor_tempo", "Melhor Vlt"], ["s1_melhor_vlt", "S1 Melhor Vlt"], ["s2_melhor_vlt", "S2 Melhor Vlt"], ["s3_melhor_vlt", "S3 Melhor Vlt"], ["sfspd_melhor_vlt", "SFSpd Melhor Vlt"], ["total_tempo", "T.Total"], ["kart_number", "Kart"], ["best_lap", "Volta"], ["pontos", "Pts"], ["melhor_tempo_ponto", "Bônus melhor volta"]];
    const baseRows = (tipoAba === "classificacao" ? classificacao : corrida).slice();
    baseRows.sort((a, b) => Number(a.posicao_geral_arquivo || 9999) - Number(b.posicao_geral_arquivo || 9999));

    const montarResumoCelula = (r, campo) => {
        if (campo === "driver_name") return htmlEscape(nomePilotoCurto(r.driver_name, r.driver_id || r.id_piloto));
        return htmlEscape(r[campo] ?? "-");
    };

    const montarDetalhesPiloto = (r, idx) => {
        const detalhes = tipoAba === "classificacao" ? detalhesClassificacao : detalhesCorrida;
        const linhas = detalhes
            .map(([campo, label]) => {
                const valor = r[campo];
                if (valor === undefined || valor === null || valor === "") return "";
                return `<tr><td style="color:#aaa;">${htmlEscape(label)}</td><td>${htmlEscape(valor)}</td></tr>`;
            })
            .filter(Boolean)
            .join("");

        const conteudo = linhas || '<tr><td colspan="2" class="muted">Sem detalhes adicionais.</td></tr>';
        return `<tr id="consulta_row_det_${idx}" data-open="0" style="display:none; background:#151a22;"><td colspan="${colsResumo.length}"><table class='pyscript-table' style='margin:0; font-size:12px;'><tbody>${conteudo}</tbody></table></td></tr>`;
    };

    const tabela = rows => `<div class='table-fit'><table class='pyscript-table'><tr>${colsResumo.map(c => `<th>${c[1]}</th>`).join("")}</tr>${rows.map((r, idx) => `
        <tr style="cursor:pointer;" onclick="toggleDetalheConsulta(${idx})">${colsResumo.map(c => `<td>${montarResumoCelula(r, c[0])}</td>`).join("")}</tr>
        ${montarDetalhesPiloto(r, idx)}
    `).join("")}</table></div>`;
    document.getElementById("consultaTabelaDia").innerHTML = baseRows.length
        ? tabela(filtra(baseRows))
        : "<p class='muted'>Sem dados para este dia/campeonato.</p>";
}

function toggleDetalheConsulta(idx) {
    const detalhe = document.getElementById(`consulta_row_det_${idx}`);
    if (!detalhe) return;
    const aberto = detalhe.getAttribute("data-open") === "1";
    detalhe.style.display = aberto ? "none" : "table-row";
    detalhe.setAttribute("data-open", aberto ? "0" : "1");
}

function trocarAbaConsulta(aba, dia) {
    window.CONSULTA_ABA_ATUAL = aba;
    const tabArquivos = document.getElementById("tabConsultaArquivos");
    const tabCorrida = document.getElementById("tabConsultaCorrida");
    const tabClassificacao = document.getElementById("tabConsultaClassificacao");
    if (tabArquivos) tabArquivos.classList.toggle("active-tab", aba === "arquivos");
    if (tabCorrida) tabCorrida.classList.toggle("active-tab", aba === "corrida");
    if (tabClassificacao) tabClassificacao.classList.toggle("active-tab", aba === "classificacao");
    const abaArquivos = document.getElementById("consultaAbaArquivos");
    const abaResultado = document.getElementById("consultaAbaResultado");
    if (aba === "arquivos") {
        if (abaArquivos) abaArquivos.style.display = "block";
        if (abaResultado) abaResultado.style.display = "none";
        return;
    }
    if (abaArquivos) abaArquivos.style.display = "none";
    if (abaResultado) abaResultado.style.display = "block";
    renderResultadoDia(dia);
}

function abrirGestao() {
    show("gestao");
    carregarDadosBaseFirestore().then(() => {
        popularFiltros();
        renderGestao();
    });
}

function trocarAbaGestao(aba) {
    abaGestaoAtual = aba;

    const secCampeonatos = document.getElementById("secCampeonatos");
    const secPilotos = document.getElementById("secPilotos");
    const tabCampeonatos = document.getElementById("tabCampeonatos");
    const tabPilotos = document.getElementById("tabPilotos");

    if (secCampeonatos) secCampeonatos.style.display = aba === "campeonatos" ? "block" : "none";
    if (secPilotos) secPilotos.style.display = aba === "pilotos" ? "block" : "none";
    if (tabCampeonatos) tabCampeonatos.classList.toggle("active-tab", aba === "campeonatos");
    if (tabPilotos) tabPilotos.classList.toggle("active-tab", aba === "pilotos");
}

function popularFiltros() {
    const optsCampeonatoNome = DB.campeonatos.map(c =>
        `<option value="${htmlEscape(c.nome)}">${htmlEscape(c.nome)}</option>`
    ).join("");

    const impCamp = document.getElementById("imp_camp");
    const selCamp = document.getElementById("sel_camp");

    if (impCamp) impCamp.innerHTML = '<option value="">Selecione o Campeonato</option>' + optsCampeonatoNome;
    if (selCamp) selCamp.innerHTML = '<option value="">Selecione o Campeonato</option>' + optsCampeonatoNome;

    const filtroRank = document.getElementById("filtro_rank_firebase_camp");
    if (filtroRank) {
        const valorAtual = filtroRank.value;
        filtroRank.innerHTML = '<option value="">Selecione o Campeonato</option>' + DB.campeonatos.map(c =>
            `<option value="${htmlEscape(c.id || normalizarDocId(c.nome))}">${htmlEscape(c.nome)}</option>`
        ).join("");

        if (valorAtual && DB.campeonatos.some(c => (c.id || normalizarDocId(c.nome)) === valorAtual)) {
            filtroRank.value = valorAtual;
        }
    }

    const pilotoCampeonatos = document.getElementById("piloto_campeonatos");
    if (pilotoCampeonatos) {
        pilotoCampeonatos.innerHTML = DB.campeonatos.map(c =>
            `<option value="${htmlEscape(c.nome)}">${htmlEscape(c.nome)}</option>`
        ).join("");
    }

    const impEtapa = document.getElementById("imp_etapa");
    const impData = document.getElementById("imp_data");
    const resData = document.getElementById("res_data");

    if (impEtapa && !impEtapa.value) impEtapa.value = "";
    if (impData && !impData.value) impData.value = hojeISO();
    if (resData && !resData.value) resData.value = hojeISO();

}

function renderGestao() {
    trocarAbaGestao(abaGestaoAtual);
    popularFiltros();

    const listaCampeonatos = document.getElementById("listaCampeonatos");
    if (listaCampeonatos) {
        listaCampeonatos.innerHTML = DB.campeonatos.map((c, idx) => `
            <div class='piloto-card'>
                <span>
                    <strong>${htmlEscape(c.nome || "")}</strong><br>
                    <small class='muted'>
                        id: ${htmlEscape(c.id || normalizarDocId(c.nome))}
                        ${c.descricao ? ` • ${htmlEscape(c.descricao)}` : ""}
                        ${c.data_inicio ? ` • ${htmlEscape(c.data_inicio)}` : ""}
                        ${c.data_fim ? ` até ${htmlEscape(c.data_fim)}` : ""}
                    </small>
                </span>
                <span class="actions">
                    <button class='btn-icon' title="Editar" aria-label="Editar" onclick="editarCampeonato(${idx})">✏️</button>
                </span>
            </div>
        `).join("") || "<p class='muted'>Nenhum campeonato cadastrado.</p>";
    }

    const listaPilotos = document.getElementById("listaPilotos");
    if (listaPilotos) {
        listaPilotos.innerHTML = DB.pilotos.map((p, idx) => {
            const nome = p.nome || p.driver_name || "";
            const idPiloto = p.id_piloto || p.driver_id || p.id || "";
            const apelido = p.apelido || "";
            const camps = vinculosPiloto(p).join(", ");

            return `<div class='piloto-card'>
                <span>
                    <strong>${htmlEscape(nome)}</strong><br>
                    <small class='muted'>
                        id_piloto: ${htmlEscape(idPiloto || "-")}
                        • apelido: ${htmlEscape(apelido || "-")}
                        • campeonatos: ${htmlEscape(camps || "-")}
                    </small>
                </span>
                <span class="actions">
                    <button class='btn-icon' title="Editar" aria-label="Editar" onclick="editarPiloto(${idx})">✏️</button>
                </span>
            </div>`;
        }).join("") || "<p class='muted'>Nenhum piloto cadastrado.</p>";
    }
}

function limparFormularioCampeonato() {
    campeonatoEditando = null;

    const nome = document.getElementById("camp_nome");
    const descricao = document.getElementById("camp_descricao");
    const dataInicio = document.getElementById("camp_data_inicio");
    const dataFim = document.getElementById("camp_data_fim");
    const feedback = document.getElementById("feedbackCampeonato");

    if (nome) {
        nome.disabled = false;
        nome.value = "";
    }
    if (descricao) descricao.value = "";
    if (dataInicio) dataInicio.value = "";
    if (dataFim) dataFim.value = "";
    if (feedback) feedback.innerHTML = "";
}

async function salvarCampeonato() {
    if (!await pedirSenhaAdmin()) return;
    const nomeInput = document.getElementById("camp_nome");
    const descricaoInput = document.getElementById("camp_descricao");
    const dataInicioInput = document.getElementById("camp_data_inicio");
    const dataFimInput = document.getElementById("camp_data_fim");
    const feedback = document.getElementById("feedbackCampeonato");

    const nome = (nomeInput?.value || "").trim();
    const descricao = (descricaoInput?.value || "").trim();
    const dataInicio = dataInicioInput?.value || "";
    const dataFim = dataFimInput?.value || "";

    if (!nome) {
        if (feedback) feedback.innerHTML = '<span class="error">Nome do campeonato é obrigatório.</span>';
        return;
    }

    const docId = campeonatoEditando?.id || normalizarDocId(nome);
    const ref = firestore.collection(COLLECTION_CAMPEONATOS).doc(docId);
    const snapshot = await ref.get();

    if (!campeonatoEditando && snapshot.exists) {
        alert("Este campeonato já existe no Firebase. Não será cadastrado por cima.");
        if (feedback) feedback.innerHTML = '<span class="error">Campeonato já existe no Firebase.</span>';
        return;
    }

    try {
        const dadosAtuais = snapshot.exists ? snapshot.data() || {} : {};

        await ref.set(toFirestoreSafe({
            ...dadosAtuais,
            id: docId,
            nome: campeonatoEditando ? (dadosAtuais.nome || campeonatoEditando.nome || nome) : nome,
            descricao,
            data_inicio: dataInicio,
            data_fim: dataFim,
            estrutura: `${COLLECTION_CAMPEONATOS}/${docId}`,
            atualizadoEmISO: new Date().toISOString(),
            criadoEmISO: dadosAtuais.criadoEmISO || new Date().toISOString()
        }), { merge: true });

        if (feedback) feedback.innerHTML = "✅ Campeonato salvo no Firebase.";

        await carregarDadosBaseFirestore();
        popularFiltros();
        renderGestao();
        await inicializarRankingFirestore();
        limparFormularioCampeonato();
    } catch (e) {
        console.error(e);
        if (feedback) feedback.innerHTML = `<span class="error">Erro ao salvar campeonato: ${htmlEscape(e.message || e)}</span>`;
    }
}

function editarCampeonato(idx) {
    const c = DB.campeonatos[idx];
    if (!c) return;

    campeonatoEditando = c;

    const nome = document.getElementById("camp_nome");
    const descricao = document.getElementById("camp_descricao");
    const dataInicio = document.getElementById("camp_data_inicio");
    const dataFim = document.getElementById("camp_data_fim");
    const feedback = document.getElementById("feedbackCampeonato");

    if (nome) {
        nome.value = c.nome || "";
        nome.disabled = true;
    }
    if (descricao) descricao.value = c.descricao || c["descrição"] || "";
    if (dataInicio) dataInicio.value = formatarDataISO(c.data_inicio || c["data de inicio"] || "");
    if (dataFim) dataFim.value = formatarDataISO(c.data_fim || c["data de fim"] || "");
    if (feedback) feedback.innerHTML = "Editando campeonato existente. A chave/ID não será alterada.";

    trocarAbaGestao("campeonatos");
}

function limparFormularioPiloto() {
    pilotoEditando = null;

    const id = document.getElementById("piloto_id");
    const nome = document.getElementById("piloto_nome");
    const apelido = document.getElementById("piloto_apelido");
    const foto = document.getElementById("piloto_foto");
    const campeonatos = document.getElementById("piloto_campeonatos");
    const feedback = document.getElementById("feedbackPiloto");

    if (id) {
        id.disabled = false;
        id.value = "";
    }
    if (nome) nome.value = "";
    if (apelido) apelido.value = "";
    if (foto) foto.value = "";
    if (campeonatos) Array.from(campeonatos.options).forEach(opt => opt.selected = false);
    if (feedback) feedback.innerHTML = "";
}

async function salvarPiloto() {
    if (!await pedirSenhaAdmin()) return;
    const idInput = document.getElementById("piloto_id");
    const nomeInput = document.getElementById("piloto_nome");
    const apelidoInput = document.getElementById("piloto_apelido");
    const fotoInput = document.getElementById("piloto_foto");
    const campeonatosSelect = document.getElementById("piloto_campeonatos");
    const feedback = document.getElementById("feedbackPiloto");

    const idPiloto = (idInput?.value || "").trim();
    const nome = (nomeInput?.value || "").trim();
    const apelido = (apelidoInput?.value || "").trim();
    const fotoUrl = (fotoInput?.value || "").trim();
    const campeonatos = campeonatosSelect
        ? Array.from(campeonatosSelect.selectedOptions).map(opt => opt.value).filter(Boolean)
        : [];

    if (!idPiloto) {
        if (feedback) feedback.innerHTML = '<span class="error">id_piloto é obrigatório.</span>';
        return;
    }

    if (!nome) {
        if (feedback) feedback.innerHTML = '<span class="error">Nome do piloto é obrigatório.</span>';
        return;
    }

    const docId = pilotoEditando?.id || normalizarDocId(idPiloto);
    const ref = firestore.collection(COLLECTION_PILOTOS).doc(docId);
    const snapshot = await ref.get();

    if (!pilotoEditando && snapshot.exists) {
        alert("Este piloto já existe no Firebase. Não será cadastrado por cima.");
        if (feedback) feedback.innerHTML = '<span class="error">Piloto já existe no Firebase.</span>';
        return;
    }

    try {
        const dadosAtuais = snapshot.exists ? snapshot.data() || {} : {};
        const idFinal = pilotoEditando ? (dadosAtuais.id_piloto || dadosAtuais.driver_id || pilotoEditando.id_piloto || idPiloto) : idPiloto;

        await ref.set(toFirestoreSafe({
            ...dadosAtuais,
            id_piloto: idFinal,
            driver_id: idFinal,
            nome,
            driver_name: nome,
            apelido,
            foto_url: fotoUrl,
            photoURL: fotoUrl,
            campeonatos,
            vinculos: campeonatos,
            origemCadastro: dadosAtuais.origemCadastro || "cadastro_manual",
            atualizadoEmISO: new Date().toISOString(),
            criadoEmISO: dadosAtuais.criadoEmISO || new Date().toISOString()
        }), { merge: true });

        if (feedback) feedback.innerHTML = "✅ Piloto salvo no Firebase.";

        await carregarDadosBaseFirestore();
        popularFiltros();
        renderGestao();
        await inicializarRankingFirestore();
        limparFormularioPiloto();
    } catch (e) {
        console.error(e);
        if (feedback) feedback.innerHTML = `<span class="error">Erro ao salvar piloto: ${htmlEscape(e.message || e)}</span>`;
    }
}

function editarPiloto(idx) {
    const p = DB.pilotos[idx];
    if (!p) return;

    pilotoEditando = p;

    const id = document.getElementById("piloto_id");
    const nome = document.getElementById("piloto_nome");
    const apelido = document.getElementById("piloto_apelido");
    const foto = document.getElementById("piloto_foto");
    const campeonatos = document.getElementById("piloto_campeonatos");
    const feedback = document.getElementById("feedbackPiloto");

    if (id) {
        id.value = p.id_piloto || p.driver_id || p.id || "";
        id.disabled = true;
    }
    if (nome) nome.value = p.nome || p.driver_name || "";
    if (apelido) apelido.value = p.apelido || "";
    if (foto) foto.value = p.foto_url || p.photoURL || p.foto || p.imagem || "";

    if (campeonatos) {
        Array.from(campeonatos.options).forEach(opt => {
            opt.selected = pilotoPertenceAoCampeonato(p, opt.value);
        });
    }

    if (feedback) feedback.innerHTML = "Editando piloto existente. O id_piloto não será alterado.";

    trocarAbaGestao("pilotos");
}

async function inicializarRankingFirestore() {
    await carregarCampeonatosRankingFirestore();
    await renderRankingFirestore();
}

async function carregarCampeonatosRankingFirestore() {
    const select = document.getElementById("filtro_rank_firebase_camp");
    const status = document.getElementById("rankingFirestoreStatus");

    if (!select) return;

    try {
        const valorAtual = select.value;

        select.innerHTML = '<option value="">Selecione o Campeonato</option>' + DB.campeonatos.map(c =>
            `<option value="${htmlEscape(c.id || normalizarDocId(c.nome))}">${htmlEscape(c.nome)}</option>`
        ).join("");

        if (!DB.campeonatos.length) {
            select.innerHTML = '<option value="">Nenhum campeonato encontrado no Firebase</option>';
            if (status) status.innerHTML = `Nenhum campeonato encontrado na collection ${COLLECTION_CAMPEONATOS}.`;
            return;
        }

        if (valorAtual && DB.campeonatos.some(c => (c.id || normalizarDocId(c.nome)) === valorAtual)) {
            select.value = valorAtual;
        } else if (!select.value) {
            select.value = DB.campeonatos[0].id || normalizarDocId(DB.campeonatos[0].nome);
        }

        if (status && !select.value) status.innerHTML = "Selecione um campeonato para carregar o ranking do Firestore.";
    } catch (e) {
        console.error(e);
        select.innerHTML = '<option value="">Erro ao carregar campeonatos</option>';
        if (status) status.innerHTML = `❌ Erro ao carregar campeonatos do Firestore: ${htmlEscape(e.message || e)}`;
    }
}

function criarLinhaRankingFirestoreBase(driverId, driverName) {
    return {
        driver_id: driverId || "",
        driver_name: driverName || "-",
        pontos_posicao_corrida: 0,
        pontos_melhor_tempo_corrida: 0,
        pontos_melhor_tempo_classificacao: 0,
        pontos_total: 0,
        etapas: []
    };
}

function somarResultadoFinalRankingFirestore(rankingMap, item, etapaInfo) {
    const driverId = String(item.driver_id || item.id_piloto || "").trim();
    const driverName = item.driver_name || item.nome || "-";

    if (!driverId && !driverName) return;

    const key = driverId || normalizarDocId(driverName);

    if (!rankingMap.has(key)) {
        rankingMap.set(key, criarLinhaRankingFirestoreBase(driverId, driverName));
    }

    const linha = rankingMap.get(key);
    const pontosPosicao = Number(item.pontos || 0);
    const bonusMelhorTempoCorrida = Number(item.melhor_tempo_ponto || 0);
    const posicaoGrafico = Number(item.posicao_final2 || item.posicao_geral_arquivo || 0);

    linha.driver_id = linha.driver_id || driverId;
    linha.driver_name = linha.driver_name !== "-" ? linha.driver_name : driverName;
    linha.pontos_posicao_corrida += pontosPosicao;
    linha.pontos_melhor_tempo_corrida += bonusMelhorTempoCorrida;
    linha.pontos_total += pontosPosicao + bonusMelhorTempoCorrida;

    linha.etapas.push({
        tipo: "Resultado Final",
        etapa: etapaInfo.etapa || "-",
        dataCorrida: etapaInfo.dataCorrida || "-",
        posicao_final2: item.posicao_final2 || "-",
        posicao_grafico: posicaoGrafico,
        pontos: pontosPosicao,
        melhor_tempo: item.melhor_tempo || "-",
        melhor_tempo_ponto: bonusMelhorTempoCorrida
    });
}

function somarClassificacaoRankingFirestore(rankingMap, item, etapaInfo) {
    const driverId = String(item.driver_id || item.id_piloto || "").trim();
    const driverName = item.driver_name || item.nome || "-";

    if (!driverId && !driverName) return;

    const key = driverId || normalizarDocId(driverName);

    if (!rankingMap.has(key)) {
        rankingMap.set(key, criarLinhaRankingFirestoreBase(driverId, driverName));
    }

    const linha = rankingMap.get(key);
    const bonusMelhorTempoClassificacao = Math.max(Number(item.melhor_tempo_ponto || 0), Number(item.pontos || 0));
    const posicaoLargadaCampeonato = Number(
        item.posicao_largada_campeonato ||
        item.posicao_classificacao_campeonato ||
        item.posicao_final2 ||
        item.posicao_geral_arquivo ||
        0
    );

    linha.driver_id = linha.driver_id || driverId;
    linha.driver_name = linha.driver_name !== "-" ? linha.driver_name : driverName;
    linha.pontos_melhor_tempo_classificacao += bonusMelhorTempoClassificacao;
    linha.pontos_total += bonusMelhorTempoClassificacao;

    linha.etapas.push({
        tipo: "Classificação",
        etapa: etapaInfo.etapa || "-",
        dataCorrida: etapaInfo.dataCorrida || "-",
        posicao_final2: posicaoLargadaCampeonato || "-",
        posicao_grafico: posicaoLargadaCampeonato,
        pontos: bonusMelhorTempoClassificacao,
        melhor_tempo: item.melhor_tempo || "-",
        melhor_tempo_ponto: bonusMelhorTempoClassificacao
    });
}

async function buscarPilotosDoCampeonatoRankingFirestore(campeonato) {
    const oficiais = getChampionshipDrivers(campeonato);
    // aliases são preservados para os documentos antigos usados pelo ranking.
    const ids = new Set(oficiais.ids);
    const nomes = new Set();
    oficiais.pilotos.forEach(p => {
        if (p.driver_id) {
            ids.add(normalizarDocId(p.driver_id));
            ids.add(normalizarChave(p.driver_id));
        }
        if (p.driver_name) {
            nomes.add(normalizarNomeComparacao(p.driver_name));
            nomes.add(normalizarDocId(p.driver_name));
            nomes.add(normalizarChave(p.driver_name));
        }
    });
    return { ...oficiais, ids, nomes };
}

function linhaPertenceAoCampeonatoRanking(item, docId, pilotosCampeonato) {
    const ids = pilotosCampeonato?.ids || new Set();
    const nomes = pilotosCampeonato?.nomes || new Set();

    if (!ids.size && !nomes.size) return true;

    const driverId = normalizarDriverId(item?.driver_id || item?.id_piloto);
    const driverName = String(item?.driver_name || item?.nome || item?.piloto || "").trim();

    if (driverId) {
        return ids.has(driverId) || ids.has(normalizarDocId(driverId)) || ids.has(normalizarChave(driverId));
    }
    if (docId && (ids.has(docId) || ids.has(normalizarDocId(docId)) || ids.has(normalizarChave(docId)))) return true;
    return !!driverName && (
        nomes.has(normalizarNomeComparacao(driverName)) ||
        nomes.has(normalizarDocId(driverName)) ||
        nomes.has(normalizarChave(driverName))
    );
}

function extrairLinhasResumoRankingFirestore(etapaInfo, campos) {
    for (const campo of campos) {
        const valor = campo.split(".").reduce((acc, key) => acc?.[key], etapaInfo);

        if (Array.isArray(valor) && valor.length) {
            return valor;
        }
    }

    return [];
}

function montarLinhasComFallbackResumoRankingFirestore(snapshot, etapaInfo, camposResumo) {
    if (snapshot.docs.length) {
        return snapshot.docs.map(doc => ({
            docId: doc.id,
            data: doc.data() || {}
        }));
    }

    return extrairLinhasResumoRankingFirestore(etapaInfo, camposResumo).map((data, idx) => ({
        docId: normalizarDocId(data.driver_id || data.id_piloto || data.driver_name || data.nome || `piloto_${idx + 1}`),
        data: data || {}
    }));
}

function obterPosicaoArquivo(item) {
    const candidatos = [
        item.posicao_geral_arquivo,
        item.posicao_final,
        item.pos,
        item.posicao,
        item.posicao_final2
    ];

    for (const valor of candidatos) {
        const n = Number(valor);

        if (Number.isFinite(n) && n > 0) {
            return n;
        }
    }

    return 999999;
}

async function buscarRankingFirestorePorCampeonato(campeonatoDocId) {
    const campRef = firestore.collection(COLLECTION_CAMPEONATOS).doc(campeonatoDocId);
    const campDoc = await campRef.get();
    const campData = campDoc.exists ? campDoc.data() || {} : {};
    const campeonatoNome = campData.nome || campData.nome_exibicao || campeonatoDocId;
    const pilotosCampeonato = await buscarPilotosDoCampeonatoRankingFirestore(campeonatoNome || campeonatoDocId);
    const resultadosSnapshot = await campRef.collection("resultado_final").get();
    const rankingMap = new Map();

    for (const resultadoDoc of resultadosSnapshot.docs) {
        const etapaInfo = resultadoDoc.data() || {};
        const resultadoRef = resultadoDoc.ref;
        const pilotosResultadoSnapshot = await resultadoRef.collection("pilotos_resultado").get();
        const pilotosResultadoDocs = montarLinhasComFallbackResumoRankingFirestore(
            pilotosResultadoSnapshot,
            etapaInfo,
            [
                "resultadoFinalResumo.pilotosSelecionados",
                "resultado_final.pilotosSelecionados",
                "pilotos_resultado",
                "pilotosSelecionados",
                "pilotos"
            ]
        );

        pilotosResultadoDocs.forEach(({ docId, data }) => {
            if (!linhaPertenceAoCampeonatoRanking(data, docId, pilotosCampeonato)) return;
            somarResultadoFinalRankingFirestore(rankingMap, data, etapaInfo);
        });

        const classificacaoSnapshot = await resultadoRef.collection("classificacao").get();
        let classificacaoDocs = montarLinhasComFallbackResumoRankingFirestore(
            classificacaoSnapshot,
            etapaInfo,
            [
                "classificacaoResumo.pilotosSelecionados",
                "classificacao.pilotosSelecionados",
                "classificacao"
            ]
        ).map(item => {
            const data = item.data || {};
            const driverId = String(data.driver_id || data.id_piloto || item.docId || "").trim();

            return {
                docId: item.docId,
                driverId,
                data
            };
        });

        classificacaoDocs = classificacaoDocs.filter(item =>
            linhaPertenceAoCampeonatoRanking(item.data, item.docId, pilotosCampeonato)
        );

        classificacaoDocs
            .sort((a, b) =>
                obterPosicaoArquivo(a.data) - obterPosicaoArquivo(b.data) ||
                String(a.data.driver_name || "").localeCompare(String(b.data.driver_name || ""))
            )
            .forEach((item, idx) => {
                somarClassificacaoRankingFirestore(
                    rankingMap,
                    {
                        ...item.data,
                        posicao_largada_campeonato: idx + 1,
                        posicao_classificacao_campeonato: idx + 1
                    },
                    etapaInfo
                );
            });
    }

    return Array.from(rankingMap.values())
        .sort((a, b) =>
            b.pontos_total - a.pontos_total ||
            b.pontos_posicao_corrida - a.pontos_posicao_corrida ||
            a.driver_name.localeCompare(b.driver_name)
        );
}

function setRankingTabVisual() {
    const tabPilotos = document.getElementById("rankTabPilotos");
    const tabCorrida = document.getElementById("rankTabCorrida");

    if (tabPilotos) tabPilotos.classList.toggle("active-tab", RANKING_ABA_ATUAL === "pilotos");
    if (tabCorrida) tabCorrida.classList.toggle("active-tab", RANKING_ABA_ATUAL === "corrida");
}

function onCampeonatoRankingChange() {
    RANKING_CORRIDA_ABA_ATUAL = "corrida";
    renderRankingFirestore();
}

function trocarAbaRanking(aba) {
    RANKING_ABA_ATUAL = aba === "corrida" ? "corrida" : "pilotos";
    renderRankingFirestore();
}

async function renderRankingFirestore() {
    setRankingTabVisual();

    if (RANKING_ABA_ATUAL === "corrida") {
        return renderRankingCorridaFirestore();
    }

    return renderRankingPilotosFirestore();
}

function obterCampoPrimeiroValor(obj, campos, fallback = "-") {
    for (const campo of campos) {
        const valor = obj?.[campo];

        if (valor !== undefined && valor !== null && valor !== "") {
            return valor;
        }
    }

    return fallback;
}

function obterPosicaoExibicaoRankingCorrida(row) {
    return obterCampoPrimeiroValor(
        row,
        ["posicao_geral_arquivo", "posicao_final", "posicao_final2", "posicao", "pos"],
        "-"
    );
}

function montarTabelaRankingCorrida(rows, tipoAba, contextoBase = {}) {
    const linhas = Array.isArray(rows) ? [...rows] : [];

    if (!linhas.length) {
        return `<p class="muted">Nenhum dado de ${tipoAba === "classificacao" ? "classificação" : "corrida"} encontrado para esta etapa.</p>`;
    }

    linhas.sort((a, b) =>
        Number(obterPosicaoExibicaoRankingCorrida(a) || 999999) - Number(obterPosicaoExibicaoRankingCorrida(b) || 999999) ||
        String(a.driver_name || "").localeCompare(String(b.driver_name || ""))
    );

    const colsResumo = tipoAba === "classificacao"
        ? [["posicao", "Pos"], ["driver_name", "Piloto"], ["melhor_tempo", "Melhor volta"]]
        : [["posicao", "Pos"], ["driver_name", "Piloto"], ["total_tempo", "T.Total"]];

    const detalhesCorrida = [
        [["melhor_tempo"], "Melhor Vlt"],
        [["s1_melhor_vlt"], "S1 Melhor Vlt"],
        [["s2_melhor_vlt"], "S2 Melhor Vlt"],
        [["s3_melhor_vlt"], "S3 Melhor Vlt"],
        [["sfspd_melhor_vlt"], "SFSpd Melhor Vlt"],
        [["voltas"], "Voltas"],
        [["kart_numero", "kart_number", "kart"], "Kart"],
        [["pontos"], "Pts"],
        [["melhor_tempo_ponto"], "Bônus MV"]
    ];

    const detalhesClassificacao = [
        [["melhor_tempo"], "Melhor Vlt"],
        [["s1_melhor_vlt"], "S1 Melhor Vlt"],
        [["s2_melhor_vlt"], "S2 Melhor Vlt"],
        [["s3_melhor_vlt"], "S3 Melhor Vlt"],
        [["sfspd_melhor_vlt"], "SFSpd Melhor Vlt"],
        [["total_tempo"], "T.Total"],
        [["voltas"], "Voltas"],
        [["kart_numero", "kart_number", "kart"], "Kart"],
        [["pontos"], "Pts"],
        [["melhor_tempo_ponto"], "Bônus MV"]
    ];

    const detalhes = tipoAba === "classificacao" ? detalhesClassificacao : detalhesCorrida;

    const montarResumoCelula = (row, campo) => {
        if (campo === "posicao") return htmlEscape(obterPosicaoExibicaoRankingCorrida(row));
        if (campo === "driver_name") return htmlEscape(nomePilotoCurto(row.driver_name, row.driver_id || row.id_piloto));
        return htmlEscape(obterCampoPrimeiroValor(row, [campo], "-"));
    };

    const montarDetalhesPiloto = (row, idx) => {
        const linhasDetalhe = detalhes
            .map(([campos, label]) => {
                const valor = obterCampoPrimeiroValor(row, campos, "");
                if (valor === undefined || valor === null || valor === "") return "";
                return `<tr><td style="color:#aaa;">${htmlEscape(label)}</td><td>${htmlEscape(valor)}</td></tr>`;
            })
            .filter(Boolean)
            .join("");

        const historiaPiloto = row.historia_piloto || row.historia_ia_piloto || row.historiaPiloto || "";
        const historiaId = registrarHistoriaUICache({
            texto: historiaPiloto,
            audioDataUrl: row.historia_audio_url || row.historiaAudioUrl || row.historia_audio_data_url || row.historiaAudioDataUrl || "",
            contexto: {
                ...contextoBase,
                tipo: "piloto",
                piloto: {
                    driver_id: row.driver_id || row.id_piloto || "",
                    id_piloto: row.id_piloto || row.driver_id || "",
                    driver_name: row.driver_name || row.nome || row.piloto || "piloto",
                    nome: row.nome || row.driver_name || row.piloto || "piloto"
                },
                idImportacaoHistoria: row.historiaIdImportacao || row.idImportacaoHistoria || ""
            }
        });
        const linhaHistoria = `
            <tr>
                <td style="color:#aaa;">História</td>
                <td>
                    <button class="btn-view" onclick="event.stopPropagation(); abrirHistoriaCache('${historiaId}', 'História de ${htmlEscape(row.driver_name || 'piloto')}')">
                        📖 Ver história
                    </button>
                </td>
            </tr>
        `;

        const conteudo = (linhasDetalhe || '<tr><td colspan="2" class="muted">Sem detalhes adicionais.</td></tr>') + linhaHistoria;
        return `<tr id="ranking_corrida_det_${tipoAba}_${idx}" data-open="0" style="display:none; background:#151a22;"><td colspan="${colsResumo.length}"><table class="pyscript-table" style="margin:0; font-size:12px;"><tbody>${conteudo}</tbody></table></td></tr>`;
    };

    return `
        <div class="table-fit">
            <table class="pyscript-table">
                <tr>${colsResumo.map(c => `<th>${c[1]}</th>`).join("")}</tr>
                ${linhas.map((row, idx) => `
                    <tr style="cursor:pointer;" onclick="toggleDetalheRankingCorrida('${tipoAba}', ${idx})">
                        ${colsResumo.map(c => `<td>${montarResumoCelula(row, c[0])}</td>`).join("")}
                    </tr>
                    ${montarDetalhesPiloto(row, idx)}
                `).join("")}
            </table>
        </div>
    `;
}

function toggleDetalheRankingCorrida(tipoAba, idx) {
    const detalhe = document.getElementById(`ranking_corrida_det_${tipoAba}_${idx}`);
    if (!detalhe) return;

    const aberto = detalhe.getAttribute("data-open") === "1";
    detalhe.style.display = aberto ? "none" : "table-row";
    detalhe.setAttribute("data-open", aberto ? "0" : "1");
}

function trocarAbaRankingCorrida(aba) {
    RANKING_CORRIDA_ABA_ATUAL = aba === "classificacao" ? "classificacao" : "corrida";
    renderRankingCorridaFirestore();
}

async function listarEtapasRankingCorrida(campeonatoDocId) {
    const campRef = firestore.collection(COLLECTION_CAMPEONATOS).doc(campeonatoDocId);
    const snapshot = await campRef.collection("resultado_final").get();

    return snapshot.docs
        .map(doc => ({
            docId: doc.id,
            ref: doc.ref,
            ...(doc.data() || {})
        }))
        .sort((a, b) =>
            Number(a.etapa || 0) - Number(b.etapa || 0) ||
            String(a.dataCorrida || "").localeCompare(String(b.dataCorrida || "")) ||
            String(a.docId || "").localeCompare(String(b.docId || ""))
        );
}

async function renderRankingCorridaFirestore() {
    const selectCampeonato = document.getElementById("filtro_rank_firebase_camp");
    const content = document.getElementById("rankingFirestoreContent");
    const status = document.getElementById("rankingFirestoreStatus");

    if (!selectCampeonato || !content) return;

    const campeonatoDocId = selectCampeonato.value;
    const campeonatoNome = selectCampeonato.options[selectCampeonato.selectedIndex]?.text || "";

    if (!campeonatoDocId) {
        content.innerHTML = "";
        if (status) status.innerHTML = "Selecione um campeonato para visualizar as corridas.";
        return;
    }

    try {
        if (status) status.innerHTML = `⏳ Carregando etapas de ${htmlEscape(campeonatoNome)}...`;

        const etapaSelectAnterior = document.getElementById("ranking_corrida_etapa");
        const etapaDocIdAnterior = etapaSelectAnterior?.value || "";

        const etapas = await listarEtapasRankingCorrida(campeonatoDocId);

        if (!etapas.length) {
            content.innerHTML = "<p class='muted'>Nenhuma etapa encontrada para este campeonato no Firestore.</p>";
            if (status) status.innerHTML = "Nenhuma etapa encontrada.";
            return;
        }

        const etapaSelecionada = etapas.find(e => e.docId === etapaDocIdAnterior) || etapas[0];
        const dataCorrida = etapaSelecionada.dataCorrida || "";
        const etapaLabel = etapaSelecionada.etapa || etapaSelecionada.docId || "-";

        const optionsEtapas = etapas.map(etapa => {
            const data = etapa.dataCorrida ? ` — ${formatarDataBR(etapa.dataCorrida)}` : "";
            const selected = etapa.docId === etapaSelecionada.docId ? " selected" : "";

            return `<option value="${htmlEscape(etapa.docId)}"${selected}>Etapa ${htmlEscape(etapa.etapa || etapa.docId)}${data}</option>`;
        }).join("");

        const [corridaSnapshot, classificacaoSnapshot, historiasSnapshot, voltaPilotosSnapshot] = await Promise.all([
            etapaSelecionada.ref.collection("pilotos_resultado").get(),
            etapaSelecionada.ref.collection("classificacao").get(),
            etapaSelecionada.ref.collection("historias_pilotos").get(),
            etapaSelecionada.ref.collection("volta_a_volta_pilotos").get()
        ]);

        const historiasMap = new Map();
        historiasSnapshot.docs.forEach(doc => {
            const data = { docId: doc.id, ...(doc.data() || {}) };
            const key = chavePilotoHistoriaMap(data);
            if (key) historiasMap.set(key, data);
        });

        const voltaPilotosMap = new Map();
        voltaPilotosSnapshot.docs.forEach(doc => {
            const data = { docId: doc.id, ...(doc.data() || {}) };
            const key = chavePilotoHistoriaMap(data);
            if (key) voltaPilotosMap.set(key, data);
        });

        let corrida = corridaSnapshot.docs.map(doc => ({ docId: doc.id, ...(doc.data() || {}) }));
        let classificacao = classificacaoSnapshot.docs.map(doc => ({ docId: doc.id, ...(doc.data() || {}) }));

        corrida = aplicarHistoriasNasLinhasRanking(corrida, historiasMap, voltaPilotosMap);
        classificacao = aplicarHistoriasNasLinhasRanking(classificacao, historiasMap, voltaPilotosMap);

        const tabCorridaAtiva = RANKING_CORRIDA_ABA_ATUAL !== "classificacao";
        const contextoHistoriaBase = {
            campeonatoDocId,
            resultadoDocId: etapaSelecionada.docId,
            dataCorrida,
            etapa: etapaSelecionada.etapa || etapaSelecionada.docId || ""
        };
        const tabela = tabCorridaAtiva
            ? montarTabelaRankingCorrida(corrida, "corrida", contextoHistoriaBase)
            : montarTabelaRankingCorrida(classificacao, "classificacao", contextoHistoriaBase);
        const historiaGeral = etapaSelecionada.historia_geral || etapaSelecionada.historia_ia_geral || etapaSelecionada.historiaCorrida?.geral || "";
        const historiaGeralId = registrarHistoriaUICache({
            texto: historiaGeral,
            audioDataUrl: etapaSelecionada.historia_audio_url || etapaSelecionada.historiaCorrida?.audioUrl || etapaSelecionada.historia_audio_data_url || etapaSelecionada.historiaCorrida?.audioDataUrl || "",
            contexto: { ...contextoHistoriaBase, tipo: "corrida" }
        });

        content.innerHTML = `
            <div class="form-card">
                <div class="rank-corrida-head">
                    <div>
                        <label class="file-label" for="ranking_corrida_etapa">Etapa</label>
                        <select id="ranking_corrida_etapa" onchange="renderRankingCorridaFirestore()">
                            ${optionsEtapas}
                        </select>
                    </div>
                </div>

                <div class="tabs rank-corrida-tabs" style="margin-top: 12px;">
                    <button id="rankingCorridaTabCorrida" class="tab-btn ${tabCorridaAtiva ? "active-tab" : ""}" onclick="trocarAbaRankingCorrida('corrida')">Corrida</button>
                    <button id="rankingCorridaTabClassificacao" class="tab-btn ${!tabCorridaAtiva ? "active-tab" : ""}" onclick="trocarAbaRankingCorrida('classificacao')">Classificação</button>
                    <button class="tab-btn" onclick="abrirHistoriaCache('${historiaGeralId}', 'História geral da corrida')">História</button>
                </div>

                <div id="rankingCorridaTabela">${tabela}</div>
            </div>
        `;

        if (status) {
            status.innerHTML = `✅ Etapa ${htmlEscape(etapaLabel)} carregada. Corrida: ${corrida.length} piloto(s). Classificação: ${classificacao.length} piloto(s).`;
        }
    } catch (e) {
        console.error(e);

        content.innerHTML = "";
        if (status) status.innerHTML = `❌ Erro ao carregar corrida do Firestore: ${htmlEscape(e.message || e)}`;
    }
}


async function renderRankingPilotosFirestore() {
    const select = document.getElementById("filtro_rank_firebase_camp");
    const content = document.getElementById("rankingFirestoreContent");
    const status = document.getElementById("rankingFirestoreStatus");

    if (!select || !content) return;

    const campeonatoDocId = select.value;
    const campeonatoNome = select.options[select.selectedIndex]?.text || "";

    if (!campeonatoDocId) {
        content.innerHTML = "";
        if (status) status.innerHTML = "Selecione um campeonato para carregar o ranking do Firestore.";
        return;
    }

    try {
        content.innerHTML = "";
        if (status) status.innerHTML = `⏳ Carregando ranking de ${htmlEscape(campeonatoNome)} no Firestore...`;

        const ranking = await buscarRankingFirestorePorCampeonato(campeonatoDocId);
        RANKING_FIRESTORE_CACHE = ranking;

        if (!ranking.length) {
            content.innerHTML = "<p class='muted'>Nenhum resultado encontrado para este campeonato no Firestore.</p>";
            if (status) status.innerHTML = "Nenhum dado encontrado.";
            return;
        }

        const totalGeral = ranking.reduce((acc, item) => acc + Number(item.pontos_total || 0), 0);

        let h = `
            <div style="width:100%; max-width:100%; overflow:hidden;">
                <table style="width:100%; table-layout:fixed;">
                    <colgroup>
                        <col style="width:18%;">
                        <col style="width:52%;">
                        <col style="width:30%;">
                    </colgroup>
                    <tr>
                        <th>Pos</th>
                        <th>Piloto</th>
                        <th>Pts</th>
                    </tr>
        `;

        ranking.forEach((p, i) => {
            const percentual = totalGeral
                ? ((Number(p.pontos_total || 0) / totalGeral) * 100).toFixed(1)
                : "0.0";

            h += `
                <tr onclick="toggleHistoricoLinhaFirestore(${i})" style="cursor:pointer;">
                    <td style="word-break:break-word;">${i + 1}º</td>
                    <td style="word-break:break-word;">${htmlEscape(p.driver_name || "-")}</td>
                    <td style="word-break:break-word;">
                        ${p.pontos_total}
                        <small style="color:#aaa; font-size:11px;">(${percentual}%)</small>
                    </td>
                </tr>
                <tr id="hist_firestore_row_${i}" class="hist-detalhe" data-open="0" style="display:none;"></tr>
            `;
        });

        h += `
                </table>
            </div>
        `;

        content.innerHTML = h;

        if (status) {
            status.innerHTML = "✅ Ranking carregado do Firestore.";
        }
    } catch (e) {
        console.error(e);

        content.innerHTML = "";
        if (status) status.innerHTML = `❌ Erro ao carregar ranking do Firestore: ${htmlEscape(e.message || e)}`;
    }
}

function montarTabelaResumoRankingFirestore(item) {
    return `
        <div style="width:100%; max-width:100%; overflow:hidden; margin-bottom:10px;">
            <table style="width:100%; table-layout:fixed; font-size:11px;">
                <colgroup>
                    <col style="width:33.33%;">
                    <col style="width:33.33%;">
                    <col style="width:33.33%;">
                </colgroup>
                <tr>
                    <th style="white-space:normal; word-break:break-word;">Pts corrida</th>
                    <th style="white-space:normal; word-break:break-word;">MV corrida</th>
                    <th style="white-space:normal; word-break:break-word;">MV classif.</th>
                </tr>
                <tr>
                    <td style="white-space:normal; word-break:break-word;">${Number(item.pontos_posicao_corrida || 0)}</td>
                    <td style="white-space:normal; word-break:break-word;">${Number(item.pontos_melhor_tempo_corrida || 0)}</td>
                    <td style="white-space:normal; word-break:break-word;">${Number(item.pontos_melhor_tempo_classificacao || 0)}</td>
                </tr>
            </table>
        </div>
    `;
}

function montarTabelaDetalhesRankingFirestore(detalhes) {
    if (!detalhes.length) return "<p class='muted'>Sem detalhes para exibir.</p>";

    const detalhesOrdenados = [...detalhes].sort((a, b) => {
        const dataA = String(a.dataCorrida || "");
        const dataB = String(b.dataCorrida || "");
        const etapaA = Number(a.etapa || 0);
        const etapaB = Number(b.etapa || 0);
        const tipoA = String(a.tipo || "");
        const tipoB = String(b.tipo || "");

        return dataA.localeCompare(dataB) || etapaA - etapaB || tipoA.localeCompare(tipoB);
    });

    return `
        <div style="width:100%; max-width:100%; overflow:hidden;">
            <table style="width:100%; table-layout:fixed; margin-top:10px; font-size:10.5px;">
                <colgroup>
                    <col style="width:28%;">
                    <col style="width:12%;">
                    <col style="width:16%;">
                    <col style="width:30%;">
                    <col style="width:14%;">
                </colgroup>
                <tr>
                    <th style="white-space:normal; word-break:break-word;">Tipo</th>
                    <th style="white-space:normal; word-break:break-word;">Et.</th>
                    <th style="white-space:normal; word-break:break-word;">Pos.</th>
                    <th style="white-space:normal; word-break:break-word;">Melhor tempo</th>
                    <th style="white-space:normal; word-break:break-word;">Pts</th>
                </tr>
                ${detalhesOrdenados.map(d => `
                    <tr>
                        <td style="white-space:normal; word-break:break-word;">${htmlEscape(d.tipo || "-")}</td>
                        <td style="white-space:normal; word-break:break-word;">${htmlEscape(d.etapa || "-")}</td>
                        <td style="white-space:normal; word-break:break-word;">${htmlEscape(d.posicao_final2 || d.posicao_grafico || "-")}</td>
                        <td style="white-space:normal; word-break:break-word;">${htmlEscape(d.melhor_tempo || "-")}</td>
                        <td style="white-space:normal; word-break:break-word;">${Number(d.pontos || 0)}</td>
                    </tr>
                `).join("")}
            </table>
        </div>
    `;
}

function gerarGraficoHistoricoFirestoreSVG(detalhes) {
    const pontosPorEtapa = new Map();

    (detalhes || []).forEach(item => {
        const etapa = String(item.etapa || "-");
        const dataCorrida = String(item.dataCorrida || "-");
        const key = `${dataCorrida}_${etapa}`;

        if (!pontosPorEtapa.has(key)) {
            pontosPorEtapa.set(key, { key, etapa, dataCorrida, resultado: null, classificacao: null });
        }

        const linha = pontosPorEtapa.get(key);
        const posicao = Number(item.posicao_grafico || item.posicao_final2 || 0);

        if (!posicao) return;

        if (String(item.tipo || "").toLowerCase().includes("resultado")) linha.resultado = posicao;

        if (String(item.tipo || "").toLowerCase().includes("classificação") ||
            String(item.tipo || "").toLowerCase().includes("classificacao")) {
            linha.classificacao = posicao;
        }
    });

    const pontos = Array.from(pontosPorEtapa.values())
        .sort((a, b) => String(a.dataCorrida).localeCompare(String(b.dataCorrida)) || Number(a.etapa || 0) - Number(b.etapa || 0));

    const posicoes = pontos
        .flatMap(p => [p.resultado, p.classificacao])
        .filter(v => v !== null && Number.isFinite(Number(v)));

    if (!pontos.length || !posicoes.length) return "<p class='muted'>Sem posições suficientes para gerar o gráfico.</p>";

    const w = 620;
    const h = 240;
    const ml = 40;
    const mr = 14;
    const mt = 34;
    const mb = 38;
    const maxPos = Math.max(...posicoes, 1);
    const stepX = (w - ml - mr) / Math.max(pontos.length - 1, 1);
    const stepY = (h - mt - mb) / Math.max(maxPos - 1, 1);
    const x = i => ml + (i * stepX);
    const y = pos => mt + ((Number(pos) - 1) * stepY);

    function montarPolyline(campo) {
        return pontos
            .map((p, i) => {
                const valor = p[campo];
                if (valor === null || !Number.isFinite(Number(valor))) return null;
                return `${x(i)},${y(valor)}`;
            })
            .filter(Boolean)
            .join(" ");
    }

    function montarCirculos(campo, cor) {
        return pontos.map((p, i) => {
            const valor = p[campo];
            if (valor === null || !Number.isFinite(Number(valor))) return "";
            return `<circle cx="${x(i)}" cy="${y(valor)}" r="3.6" fill="${cor}"><title>${campo === "resultado" ? "Resultado Final" : "Classificação"} • Etapa ${p.etapa} • P${valor}</title></circle>`;
        }).join("");
    }

    let linhasGrade = "";
    for (let p = 1; p <= maxPos; p++) {
        linhasGrade += `<line x1="${ml}" y1="${y(p)}" x2="${w - mr}" y2="${y(p)}" stroke="#2e3542" stroke-width="1"/>`;
        linhasGrade += `<text x="7" y="${y(p) + 4}" fill="#aaa" font-size="10">P${p}</text>`;
    }

    const labels = pontos.map((p, i) => `
        <text x="${x(i)}" y="${h - 17}" fill="#aaa" font-size="10" text-anchor="middle">E${htmlEscape(p.etapa)}</text>
        <text x="${x(i)}" y="${h - 5}" fill="#777" font-size="8.5" text-anchor="middle">${htmlEscape(String(p.dataCorrida).slice(5))}</text>
    `).join("");

    const linhaResultado = montarPolyline("resultado");
    const linhaClassificacao = montarPolyline("classificacao");

    return `
        <div style="width:100%; max-width:100%; overflow:hidden;">
            <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet"
                 style="display:block; width:100%; max-width:100%; height:auto; background:#141923; border-radius:8px;">
                ${linhasGrade}
                <text x="${ml}" y="18" fill="#ff4b4b" font-size="11">● Resultado</text>
                <text x="${ml + 115}" y="18" fill="#42a5f5" font-size="11">● Classificação</text>
                ${linhaResultado ? `<polyline points="${linhaResultado}" fill="none" stroke="#ff4b4b" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>` : ""}
                ${linhaClassificacao ? `<polyline points="${linhaClassificacao}" fill="none" stroke="#42a5f5" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>` : ""}
                ${montarCirculos("resultado", "#ff4b4b")}
                ${montarCirculos("classificacao", "#42a5f5")}
                ${labels}
            </svg>
        </div>
    `;
}

function setRankingFirestoreDetalheTab(idx, aba) {
    const relacao = document.getElementById(`ranking_fb_relacao_${idx}`);
    const grafico = document.getElementById(`ranking_fb_grafico_${idx}`);
    const btnRelacao = document.getElementById(`ranking_fb_btn_relacao_${idx}`);
    const btnGrafico = document.getElementById(`ranking_fb_btn_grafico_${idx}`);

    if (!relacao || !grafico || !btnRelacao || !btnGrafico) return;

    const mostrarRelacao = aba === "relacao";
    relacao.style.display = mostrarRelacao ? "block" : "none";
    grafico.style.display = mostrarRelacao ? "none" : "block";
    btnRelacao.style.background = mostrarRelacao ? "#ff4b4b" : "#252a34";
    btnGrafico.style.background = mostrarRelacao ? "#252a34" : "#ff4b4b";
}

function toggleHistoricoLinhaFirestore(idx) {
    const row = document.getElementById(`hist_firestore_row_${idx}`);
    const item = RANKING_FIRESTORE_CACHE[idx];

    if (!row || !item) return;

    const aberto = row.dataset.open === "1";

    document.querySelectorAll("tr.hist-detalhe").forEach(el => {
        el.style.display = "none";
        el.dataset.open = "0";
    });

    if (aberto) return;

    const detalhes = item.etapas || [];
    const tabelaResumo = montarTabelaResumoRankingFirestore(item);
    const tabelaDetalhes = montarTabelaDetalhesRankingFirestore(detalhes);
    const grafico = gerarGraficoHistoricoFirestoreSVG(detalhes);

    row.innerHTML = `
        <td colspan="3" style="width:100%; max-width:100%; overflow:hidden; box-sizing:border-box;">
            <div style="width:100%; max-width:100%; padding:10px 4px; overflow:hidden; box-sizing:border-box;">
                <div class="hint" style="margin-bottom:8px; white-space:normal; word-break:break-word;"><strong>${htmlEscape(item.driver_name || "-")}</strong></div>
                ${tabelaResumo}
                <div style="display:flex; gap:8px; margin:10px 0; flex-wrap:wrap; width:100%; max-width:100%; overflow:hidden;">
                    <button id="ranking_fb_btn_relacao_${idx}" onclick="event.stopPropagation(); setRankingFirestoreDetalheTab(${idx}, 'relacao')" style="width:auto; max-width:48%; padding:8px 12px; margin:0; background:#ff4b4b;">Relação</button>
                    <button id="ranking_fb_btn_grafico_${idx}" onclick="event.stopPropagation(); setRankingFirestoreDetalheTab(${idx}, 'grafico')" style="width:auto; max-width:48%; padding:8px 12px; margin:0; background:#252a34; border:1px solid #3a4252;">Gráfico</button>
                </div>
                <div id="ranking_fb_relacao_${idx}" style="display:block; width:100%; max-width:100%; overflow:hidden;">${tabelaDetalhes}</div>
                <div id="ranking_fb_grafico_${idx}" style="display:none; width:100%; max-width:100%; overflow:hidden;">${grafico}</div>
            </div>
        </td>
    `;

    row.style.display = "table-row";
    row.dataset.open = "1";
}


/* ============================================================================
   CENTRAL DO CAMPEONATO — tela inicial inspirada em páginas de resultados
   Mantém o fluxo de importação atual e usa os dados já gravados no Firestore.
   ============================================================================ */

let DASHBOARD_CAMPEONATO_CACHE = new Map();

function limparCacheDashboardCampeonato(campeonatoDocId = "") {
    if (campeonatoDocId) DASHBOARD_CAMPEONATO_CACHE.delete(campeonatoDocId);
    else DASHBOARD_CAMPEONATO_CACHE.clear();
}

function dashboardPilotoKey(item) {
    const pilotUid = getPilotUid(item);
    if (pilotUid) return `pilot:${pilotUid}`;
    const id = String(item?.driver_id || item?.id_piloto || item?.driverId || item?.docId || "").trim();
    if (id) return `id:${id}`;
    const nome = normalizarNomeComparacao(item?.driver_name || item?.nome || item?.piloto || "");
    return nome ? `nome:${nome}` : "";
}

function getDriverFullDisplayName(driver) {
    if (typeof driver !== "string") {
        const id = getDriverId(driver);
        if (id && Array.isArray(DB?.pilotos)) {
            const cadastro = DB.pilotos.find(p => getDriverId(p) === id);
            const nomeCadastro = cadastro ? DriverIdentity.getDriverDisplayName(cadastro) : "";
            if (nomeCadastro) return nomeCadastro;
        }
    }

    const limpo = DriverIdentity.getDriverDisplayName(driver);
    return limpo || "-";
}

function getDriverShortName(driver) {
    const full = getDriverFullDisplayName(driver);
    if (!full || full === "-") return "-";
    return full.split(/\s+/u).slice(0, 2).join(" ");
}

function dashboardNomePiloto(item) {
    // A home usa no máximo nome + sobrenome para não quebrar tabelas/cards no mobile.
    return getDriverShortName(item);
}

function dashboardCadastroPiloto(item) {
    const id = String(item?.driver_id || item?.id_piloto || item?.driverId || "").trim();
    const nome = normalizarNomeComparacao(item?.driver_name || item?.nome || item?.piloto || "");

    return DB.pilotos.find(p => {
        const pid = String(p.id_piloto || p.driver_id || p.id || "").trim();
        const pnome = normalizarNomeComparacao(p.nome || p.driver_name || "");
        return (id && pid === id) || (nome && pnome === nome);
    }) || null;
}

function dashboardFotoPiloto(item) {
    const p = dashboardCadastroPiloto(item) || item || {};
    const valor = String(p.foto_url || p.photoURL || p.foto || p.imagem || p.avatar || "").trim();
    return /^https?:\/\//i.test(valor) || /^data:image\//i.test(valor) ? valor : "";
}

function dashboardIniciais(nome) {
    const partes = String(nome || "?").trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return "?";
    const letras = partes.length === 1
        ? partes[0].slice(0, 2)
        : `${partes[0][0] || ""}${partes[partes.length - 1][0] || ""}`;
    return letras.toUpperCase();
}

function dashboardAvatar(item, classe = "dashboard-avatar") {
    const nome = dashboardNomePiloto(item);
    const foto = dashboardFotoPiloto(item);
    return foto
        ? `<div class="${classe}"><img src="${htmlEscape(foto)}" alt="${htmlEscape(nome)}" loading="lazy"></div>`
        : `<div class="${classe}">${htmlEscape(dashboardIniciais(nome))}</div>`;
}

function dashboardMiniAvatar(item) {
    const nome = dashboardNomePiloto(item);
    const foto = dashboardFotoPiloto(item);
    return foto
        ? `<span class="dashboard-mini-avatar"><img src="${htmlEscape(foto)}" alt=""></span>`
        : `<span class="dashboard-mini-avatar">${htmlEscape(dashboardIniciais(nome))}</span>`;
}

function dashboardTempoSegundos(item) {
    const valorNumerico = Number(item?.melhor_tempo_segundos);
    if (Number.isFinite(valorNumerico) && valorNumerico > 0) return valorNumerico;
    return tempoParaSegundosJS(item?.melhor_tempo);
}

function dashboardFormatarTempoSegundos(segundos) {
    const n = Number(segundos);
    if (!Number.isFinite(n) || n <= 0) return "-";
    const min = Math.floor(n / 60);
    const sec = n - min * 60;
    return min > 0 ? `${min}:${sec.toFixed(3).padStart(6, "0")}` : `${sec.toFixed(3)}s`;
}

function dashboardNumero(valor, casas = 0) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return "-";
    return n.toFixed(casas);
}

function dashboardPosicaoCampeonato(item) {
    const candidatos = [
        item?.posicao_final2,
        item?.posicao_largada_campeonato,
        item?.posicao_classificacao_campeonato,
        item?.posicao_final,
        item?.posicao_geral_arquivo,
        item?.posicao,
        item?.pos
    ];

    for (const valor of candidatos) {
        const n = Number(valor);
        if (Number.isFinite(n) && n > 0) return n;
    }
    return 999999;
}

function dashboardOrdenarResultado(rows) {
    return [...(rows || [])].sort((a, b) =>
        dashboardPosicaoCampeonato(a) - dashboardPosicaoCampeonato(b) ||
        String(dashboardNomePiloto(a)).localeCompare(String(dashboardNomePiloto(b)))
    );
}

function dashboardOrdenarGeral(rows) {
    const positionOverall = item => {
        for (const value of [item?.posicao_geral_arquivo, item?.positionOverall, item?.posicao_final, item?.posicao, item?.pos]) {
            const position = Number(value);
            if (Number.isFinite(position) && position > 0) return position;
        }
        return Infinity;
    };
    return [...(rows || [])].sort((a, b) => positionOverall(a) - positionOverall(b) || dashboardNomePiloto(a).localeCompare(dashboardNomePiloto(b)));
}

function dashboardCanonicalizarVoltasEtapa(voltas, corrida, classificacao, pilotosCampeonato = [], vinculosVolta = []) {
    // buscarPilotosDoCampeonatoRankingFirestore retorna um objeto com Sets
    // (ids/nomes) e, a partir da V4, também a lista canônica de pilotos.
    // Não podemos fazer spread diretamente no objeto, pois isso gera
    // "(pilotosCampeonato || []) is not iterable" durante o reprocessamento.
    const pilotosLista = Array.isArray(pilotosCampeonato)
        ? pilotosCampeonato
        : (Array.isArray(pilotosCampeonato?.pilotos) ? pilotosCampeonato.pilotos : []);

    const stageDriverMap = DriverIdentity.createStageDriverMap(corrida || []);

    return (voltas || []).map(v => {
        const resolution = DriverIdentity.resolveStageLapParticipant(v, stageDriverMap, vinculosVolta);
        const match = resolution.resolved;
        if (!match) {
            console.warn("UNRESOLVED VOLTA A VOLTA DRIVER", {
                kart: resolution.kartNumber,
                rawName: String(v.driver_name || v.nome || ""),
                normalizedName: resolution.normalizedName,
                possibleStageDrivers: (stageDriverMap.byKartNumber.get(resolution.kartNumber) || []).map(p => ({ driverId: p.driverId, name: p.name }))
            });
            return { ...v, driver_id_arquivo: resolution.fileId, isChampionship: false, identityResolution: "unresolved" };
        }

        const driverId = getDriverId(match);
        const driverName = String(match.driver_name || match.nome || "").trim() || String(v.driver_name || "").trim();

        return {
            ...v,
            pilot_uid: getPilotUid(match),
            driver_id_arquivo: String(v.driver_id || v.id_piloto || "").trim(),
            driver_name_arquivo: String(v.driver_name || v.nome || "").trim(),
            driver_id: driverId,
            id_piloto: driverId,
            driver_name: driverName,
            nome: driverName,
            isChampionship: stageDriverMap.uids?.has(getPilotUid(match)) || stageDriverMap.ids.has(driverId),
            identityResolution: resolution.resolution,
            piloto_doc_id: match.piloto_doc_id || match.pilotoVinculadoDocId || ""
        };
    });
}

function dashboardDesvioPadrao(valores) {
    const nums = (valores || []).map(Number).filter(Number.isFinite);
    if (nums.length < 2) return null;
    const media = nums.reduce((a, b) => a + b, 0) / nums.length;
    const variancia = nums.reduce((acc, v) => acc + ((v - media) ** 2), 0) / nums.length;
    return Math.sqrt(variancia);
}

function dashboardMediana(valores) {
    const nums = (valores || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!nums.length) return null;
    const m = Math.floor(nums.length / 2);
    return nums.length % 2 ? nums[m] : (nums[m - 1] + nums[m]) / 2;
}

function dashboardHoraSegundos(valor) {
    const texto = String(valor || "").trim().replace(",", ".");
    if (!texto) return null;
    const p = texto.split(":");
    let h = 0, m = 0, s = 0;

    if (p.length === 3) {
        h = Number(p[0]);
        m = Number(p[1]);
        s = Number(p[2]);
    } else if (p.length === 2) {
        m = Number(p[0]);
        s = Number(p[1]);
    } else if (p.length === 1) {
        s = Number(p[0]);
    } else {
        return null;
    }

    if (![h, m, s].every(Number.isFinite)) return null;
    return h * 3600 + m * 60 + s;
}

function dashboardVoltasComHorarioAjustado(voltas) {
    const preparadas = (voltas || []).map(v => ({
        ...v,
        _horaSeg: dashboardHoraSegundos(v.hora),
        _volta: Number(v.volta || 0),
        _voltaLider: Number(v.volta_lider || 0),
        _tempoSeg: Number.isFinite(Number(v.tempo_volta_segundos))
            ? Number(v.tempo_volta_segundos)
            : tempoParaSegundosJS(v.tempo_volta)
    }));

    const temFimDoDia = preparadas.some(v => Number.isFinite(v._horaSeg) && v._horaSeg >= 20 * 3600);

    return preparadas.map(v => {
        if (!Number.isFinite(v._horaSeg)) return v;
        const ajustada = temFimDoDia && v._horaSeg < 6 * 3600 ? v._horaSeg + 86400 : v._horaSeg;
        return { ...v, _horaSeg: ajustada };
    });
}

function dashboardMetricasVoltaAVolta(voltas, classificacao, officialPilotUids = new Set()) {
    const preparadas = dashboardVoltasComHorarioAjustado(voltas)
        .filter(v => dashboardPilotoKey(v) && v._volta > 0 && Number.isFinite(v._tempoSeg) && v._tempoSeg > 0);

    const porPiloto = new Map();
    preparadas.forEach(v => {
        const key = dashboardPilotoKey(v);
        if (!porPiloto.has(key)) porPiloto.set(key, { piloto: v, voltas: [] });
        porPiloto.get(key).voltas.push(v);
    });

    const regularidade = new Map();
    porPiloto.forEach((grupo, key) => {
        const calculada = KartAnalytics.calcularRegularidade(grupo.voltas.map(v => ({
            ...v, volta: v._volta, tempo_volta_segundos: v._tempoSeg
        }))).items[0];
        regularidade.set(key, {
            piloto: grupo.piloto,
            desvio: calculada?.regularidade ?? null,
            limpas: Number(calculada?.cleanLapsCount || 0),
            pace: calculada?.pace ?? null,
            bestLapValid: calculada?.bestLapValid ?? null,
            status: calculada?.status || "voltas_insuficientes"
        });
    });

    const grid = new Map();
    dashboardOrdenarGeral(classificacao).forEach((p, idx) => grid.set(dashboardPilotoKey(p), idx + 1));

    const voltasPorNumero = new Map();
    preparadas.forEach(v => {
        if (!voltasPorNumero.has(v._volta)) voltasPorNumero.set(v._volta, []);
        voltasPorNumero.get(v._volta).push(v);
    });

    const ordemPorVolta = new Map();
    [...voltasPorNumero.entries()].sort((a, b) => a[0] - b[0]).forEach(([n, rows]) => {
        const ordem = [...rows]
            .filter(v => Number.isFinite(v._horaSeg))
            .sort((a, b) => a._horaSeg - b._horaSeg)
            .map((v, idx) => ({ key: dashboardPilotoKey(v), piloto: v, pos: idx + 1 }));
        if (ordem.length) ordemPorVolta.set(n, ordem);
    });

    const ultrapassagens = new Map();
    const lideradas = new Map();
    let melhorLargada = null;

    [...ordemPorVolta.entries()].sort((a, b) => a[0] - b[0]).forEach(([numeroVolta, ordem]) => {
        if (ordem[0]) {
            const keyLider = ordem[0].key;
            const atual = lideradas.get(keyLider) || { piloto: ordem[0].piloto, total: 0 };
            atual.total += 1;
            lideradas.set(keyLider, atual);
        }

        ordem.forEach(item => {
            if (numeroVolta === 1) {
                const posGrid = grid.get(item.key);
                if (posGrid) {
                    const ganho = posGrid - item.pos;
                    if (officialPilotUids.has(getPilotUid(item.piloto)) && ganho > 0 && (!melhorLargada || ganho > melhorLargada.ganho || (ganho === melhorLargada.ganho && item.pos < melhorLargada.posVolta1))) {
                        melhorLargada = {
                            piloto: item.piloto,
                            ganho,
                            grid: posGrid,
                            posVolta1: item.pos
                        };
                    }
                }
            }
        });
    });

    // Fonte canônica das ultrapassagens: inversões relativas entre cada par de
    // snapshots, começando uma única vez em Grid -> V1.
    const gridOrder = dashboardOrdenarGeral(classificacao).map((piloto, index) => ({
        ...piloto, positionOverall: index + 1
    }));
    const lapOrders = [...ordemPorVolta.values()].map(ordem => ordem.map(item => ({
        ...item.piloto, positionOverall: item.pos
    })));
    const transitionOrders = gridOrder.length ? [gridOrder, ...lapOrders] : lapOrders;
    transitionOrders.flat().forEach(piloto => {
        const pilotKey = dashboardPilotoKey(piloto);
        if (pilotKey && !ultrapassagens.has(pilotKey)) ultrapassagens.set(pilotKey, { piloto, total: 0, tomadas: 0 });
    });
    for (let index = 1; index < transitionOrders.length; index += 1) {
        KartAnalytics.calculatePositionChangesBetweenSnapshots(transitionOrders[index - 1], transitionOrders[index]).forEach(change => {
            const pilotKey = dashboardPilotoKey(change);
            const atual = ultrapassagens.get(pilotKey) || { piloto: change, total: 0, tomadas: 0 };
            atual.total += Number(change.madeOverall || 0);
            atual.tomadas += Number(change.takenOverall || 0);
            ultrapassagens.set(pilotKey, atual);
        });
    }

    const official = values => [...values].filter(v => officialPilotUids.has(getPilotUid(v.piloto)));
    const topUltrapassagens = official(ultrapassagens.values()).filter(v => v.total > 0).sort((a, b) => b.total - a.total || dashboardNomePiloto(a.piloto).localeCompare(dashboardNomePiloto(b.piloto)))[0] || null;
    const topLideradas = official(lideradas.values()).filter(v => v.total > 0).sort((a, b) => b.total - a.total || dashboardNomePiloto(a.piloto).localeCompare(dashboardNomePiloto(b.piloto)))[0] || null;
    const topRegularidade = official(regularidade.values()).filter(v => Number.isFinite(v.desvio) && v.desvio >= 0 && v.status === "ok" && v.limpas >= KartAnalytics.MIN_CLEAN_LAPS).sort((a, b) => a.desvio - b.desvio)[0] || null;

    return {
        regularidade,
        ultrapassagens,
        lideradas,
        melhorLargada,
        topUltrapassagens,
        topLideradas,
        topRegularidade,
        totalVoltasLider: ordemPorVolta.size
    };
}

function dashboardEstatisticasEtapa(etapa) {
    const corrida = dashboardOrdenarGeral(etapa.corrida);
    const classificacao = dashboardOrdenarGeral(etapa.classificacao);
    const officialPilotUids = etapa.officialPilotUids instanceof Set ? etapa.officialPilotUids : new Set(etapa.officialPilotUids || []);
    const officialCandidates = KartAnalytics.getOfficialHighlightCandidates({ analytics: corrida, officialPilotUids });
    const officialQualifying = KartAnalytics.getOfficialHighlightCandidates({ analytics: classificacao, officialPilotUids });
    const vencedor = officialCandidates[0] || null;
    const pole = officialQualifying[0] || null;

    const candidatosMelhorVolta = [];
    if (etapa.voltas?.length) {
        const porPiloto = new Map();
        etapa.voltas.forEach(v => {
            const tempo = Number.isFinite(Number(v.tempo_volta_segundos)) ? Number(v.tempo_volta_segundos) : tempoParaSegundosJS(v.tempo_volta);
            const key = dashboardPilotoKey(v);
            if (!key || !Number.isFinite(tempo) || tempo <= 0) return;
            if (!porPiloto.has(key) || tempo < porPiloto.get(key).tempo) porPiloto.set(key, { piloto: v, tempo });
        });
        candidatosMelhorVolta.push(...[...porPiloto.values()].sort((a, b) => a.tempo - b.tempo));
    }
    if (!candidatosMelhorVolta.length) candidatosMelhorVolta.push(...corrida
        .map(p => ({ piloto: p, tempo: dashboardTempoSegundos(p) }))
        .filter(v => Number.isFinite(v.tempo) && v.tempo > 0)
        .sort((a, b) => a.tempo - b.tempo));

    const melhorVolta = candidatosMelhorVolta.find(v => officialPilotUids.has(getPilotUid(v.piloto))) || null;
    const metricas = dashboardMetricasVoltaAVolta(etapa.voltas, classificacao, officialPilotUids);
    const vencedorKey = dashboardPilotoKey(vencedor);
    const poleKey = dashboardPilotoKey(pole);
    const mvKey = dashboardPilotoKey(melhorVolta?.piloto);
    const liderKey = dashboardPilotoKey(metricas.topLideradas?.piloto);
    const totalLideradasVencedor = metricas.lideradas.get(vencedorKey)?.total || 0;
    const totalVoltasLider = metricas.totalVoltasLider || 0;
    const venceuGeral = Number(vencedor?.posicao_geral_arquivo || vencedor?.posicao_final) === 1;
    const poleGeral = Number(pole?.posicao_geral_arquivo || pole?.posicao_final || pole?.posicao) === 1;
    const melhorVoltaGeral = candidatosMelhorVolta.findIndex(x => dashboardPilotoKey(x.piloto) === vencedorKey) === 0;
    const hatTrick = !!vencedorKey && venceuGeral && poleGeral && melhorVoltaGeral && vencedorKey === poleKey && vencedorKey === mvKey ? vencedor : null;
    const grandChelem = hatTrick && liderKey === vencedorKey && totalVoltasLider > 0 && totalLideradasVencedor === totalVoltasLider ? vencedor : null;

    return {
        etapa,
        officialPilotUids,
        corrida,
        classificacao,
        podium: officialCandidates.slice(0, 3),
        vencedor,
        pole,
        melhorVolta,
        metricas,
        hatTrick,
        grandChelem
    };
}

async function dashboardConteudoVoltaDoc(doc) {
    const data = doc?.data || {};
    if (String(data.conteudo || "").trim()) return data.conteudo;

    const caminho = String(data.caminhoBackup || "").trim();
    const idImportacao = String(data.idImportacao || "").trim();
    const backupId = idImportacao || (caminho.includes("/") ? caminho.split("/").pop() : "");
    if (!backupId) return "";

    try {
        const snap = await firestore.collection(COLLECTION_BACKUPS).doc(backupId).get();
        return snap.exists ? String(snap.data()?.conteudo || "") : "";
    } catch (e) {
        console.warn("Não foi possível abrir o backup do volta a volta:", e);
        return "";
    }
}

function dashboardDocumentoVoltaPertenceEtapa(doc, etapa) {
    const data = doc.data || {};
    const etapaA = Number(data.etapa || 0);
    const etapaB = Number(etapa.meta.etapa || 0);
    const dataA = String(data.dataCorrida || "");
    const dataB = String(etapa.meta.dataCorrida || "");

    if (dataA && dataB && dataA !== dataB) return false;
    if (etapaA && etapaB && etapaA !== etapaB) return false;
    return (dataA && dataB) || (etapaA && etapaB);
}

async function carregarDashboardCampeonato(campeonatoDocId, force = false) {
    if (!force && DASHBOARD_CAMPEONATO_CACHE.has(campeonatoDocId)) {
        return DASHBOARD_CAMPEONATO_CACHE.get(campeonatoDocId);
    }

    const campRef = firestore.collection(COLLECTION_CAMPEONATOS).doc(campeonatoDocId);
    const [campSnap, resultadosSnapshot, voltaSnapshot] = await Promise.all([
        campRef.get(),
        campRef.collection("resultado_final").get(),
        campRef.collection("volta_a_volta").get()
    ]);

    const campData = campSnap.exists ? campSnap.data() || {} : {};
    const campeonatoNome = campData.nome || campData.nome_exibicao || campeonatoDocId;
    const pilotosCampeonato = await buscarPilotosDoCampeonatoRankingFirestore(campeonatoNome || campeonatoDocId);
    const voltaDocs = voltaSnapshot.docs.map(doc => ({ id: doc.id, ref: doc.ref, data: doc.data() || {} }));

    const etapasBase = resultadosSnapshot.docs.map(doc => ({
        docId: doc.id,
        ref: doc.ref,
        meta: doc.data() || {}
    })).sort((a, b) =>
        Number(a.meta.etapa || 0) - Number(b.meta.etapa || 0) ||
        String(a.meta.dataCorrida || "").localeCompare(String(b.meta.dataCorrida || ""))
    );

    const etapas = await Promise.all(etapasBase.map(async etapa => {
        const [corridaSnap, classificacaoSnap] = await Promise.all([
            etapa.ref.collection("pilotos_resultado").get(),
            etapa.ref.collection("classificacao").get()
        ]);

        const corrida = montarLinhasComFallbackResumoRankingFirestore(
            corridaSnap,
            etapa.meta,
            ["resultadoFinalResumo.pilotosSelecionados", "resultado_final.pilotosSelecionados", "pilotos_resultado", "pilotosSelecionados", "pilotos"]
        ).map(({ docId, data }) => ({ docId, ...data }));

        const classificacao = montarLinhasComFallbackResumoRankingFirestore(
            classificacaoSnap,
            etapa.meta,
            ["classificacaoResumo.pilotosSelecionados", "classificacao.pilotosSelecionados", "classificacao"]
        ).map(({ docId, data }) => ({ docId, ...data }));

        const docsVoltaCandidatos = voltaDocs.filter(doc => dashboardDocumentoVoltaPertenceEtapa(doc, etapa));
        const ultimoImportado = String(etapa.meta.ultimoVoltaAVoltaImportado || etapa.meta.voltaAVoltaResumo?.idImportacao || "").trim();
        let docsVoltaEtapa = docsVoltaCandidatos;

        if (ultimoImportado) {
            const exato = docsVoltaCandidatos.find(doc => String(doc.data.idImportacao || "") === ultimoImportado || String(doc.id || "").includes(normalizarDocId(ultimoImportado)));
            if (exato) docsVoltaEtapa = [exato];
        }

        if (docsVoltaEtapa.length > 1) {
            docsVoltaEtapa = [...docsVoltaEtapa].sort((a, b) => {
                const ta = String(a.data.dataUploadISO || a.data.atualizadoEmISO || a.data.criadoEmISO || "");
                const tb = String(b.data.dataUploadISO || b.data.atualizadoEmISO || b.data.criadoEmISO || "");
                return tb.localeCompare(ta);
            }).slice(0, 1);
        }

        const conteudos = await Promise.all(docsVoltaEtapa.map(dashboardConteudoVoltaDoc));
        let voltas = [];
        conteudos.forEach((conteudo, idx) => {
            if (!conteudo) return;
            voltas.push(...extrairVoltaAVoltaHTMLTexto(conteudo, docsVoltaEtapa[idx]?.data?.nomeArquivo || docsVoltaEtapa[idx]?.id || "volta_a_volta.html"));
        });
        const officialPilotUids = new Set([...corrida, ...classificacao, ...voltas]
            .filter(item => linhaPertenceAoCampeonatoRanking(item, item.docId || "", pilotosCampeonato))
            .map(getPilotUid).filter(Boolean));

        return { ...etapa, corrida, classificacao, voltas, officialPilotUids };
    }));

    const payload = {
        campeonatoDocId,
        campeonatoNome,
        campData,
        etapas,
        etapasStats: etapas.map(dashboardEstatisticasEtapa)
    };

    DASHBOARD_CAMPEONATO_CACHE.set(campeonatoDocId, payload);
    return payload;
}

function dashboardSomarContador(mapa, piloto, campo = "total", incremento = 1, extras = {}) {
    const key = dashboardPilotoKey(piloto);
    if (!key) return;
    if (!mapa.has(key)) mapa.set(key, { piloto, [campo]: 0, ...extras });
    const item = mapa.get(key);
    item[campo] = Number(item[campo] || 0) + Number(incremento || 0);
    Object.assign(item, extras);
}

function dashboardTopContador(mapa, campo = "total") {
    return [...mapa.values()].sort((a, b) => Number(b[campo] || 0) - Number(a[campo] || 0) || dashboardNomePiloto(a.piloto).localeCompare(dashboardNomePiloto(b.piloto)))[0] || null;
}

function dashboardEstatisticasGeral(payload, ranking) {
    const vitorias = new Map();
    const poles = new Map();
    const mvs = new Map();
    const podios = new Map();
    const ultrapassagens = new Map();
    const lideradas = new Map();
    const grand = new Map();
    const hat = new Map();
    const regularidade = new Map();
    let melhorLargada = null;
    let melhorVoltaAbsoluta = null;

    payload.etapasStats.forEach(stat => {
        if (stat.vencedor) dashboardSomarContador(vitorias, stat.vencedor);
        if (stat.pole) dashboardSomarContador(poles, stat.pole);
        if (stat.melhorVolta?.piloto) dashboardSomarContador(mvs, stat.melhorVolta.piloto);
        stat.podium.forEach(p => dashboardSomarContador(podios, p));
        if (stat.grandChelem) dashboardSomarContador(grand, stat.grandChelem);
        if (stat.hatTrick) dashboardSomarContador(hat, stat.hatTrick);

        if (stat.melhorVolta && (!melhorVoltaAbsoluta || stat.melhorVolta.tempo < melhorVoltaAbsoluta.tempo)) {
            melhorVoltaAbsoluta = { ...stat.melhorVolta, etapa: stat.etapa };
        }

        const official = item => stat.officialPilotUids?.has(getPilotUid(item.piloto));
        stat.metricas.ultrapassagens.filter(official).forEach(item => dashboardSomarContador(ultrapassagens, item.piloto, "total", item.total));
        stat.metricas.lideradas.filter(official).forEach(item => dashboardSomarContador(lideradas, item.piloto, "total", item.total));
        stat.metricas.regularidade.filter(official).forEach(item => {
            if (!Number.isFinite(item.desvio) || item.desvio < 0 || item.status !== "ok" || item.limpas < KartAnalytics.MIN_CLEAN_LAPS) return;
            const key = dashboardPilotoKey(item.piloto);
            if (!regularidade.has(key)) regularidade.set(key, { piloto: item.piloto, valores: [] });
            regularidade.get(key).valores.push(item.desvio);
        });

        const largada = stat.metricas.melhorLargada;
        if (largada && (!melhorLargada || largada.ganho > melhorLargada.ganho)) {
            melhorLargada = { ...largada, etapa: stat.etapa };
        }
    });

    const topRegularidade = [...regularidade.values()].map(item => ({
        ...item,
        media: item.valores.reduce((a, b) => a + b, 0) / item.valores.length
    })).sort((a, b) => a.media - b.media)[0] || null;

    return {
        ranking,
        vitorias,
        poles,
        mvs,
        podios,
        ultrapassagens,
        lideradas,
        grand,
        hat,
        melhorLargada,
        melhorVoltaAbsoluta,
        topVitorias: dashboardTopContador(vitorias),
        topPoles: dashboardTopContador(poles),
        topMvs: dashboardTopContador(mvs),
        topPodios: dashboardTopContador(podios),
        topUltrapassagens: dashboardTopContador(ultrapassagens),
        topLideradas: [...lideradas.values()].filter(item => item.total > 0).sort((a, b) => b.total - a.total)[0] || null,
        topGrand: dashboardTopContador(grand),
        topHat: dashboardTopContador(hat),
        topRegularidade
    };
}

function dashboardCard({ titulo, piloto = null, valor = "-", descricao = "", vazio = false, indisponivel = false }) {
    const nome = piloto ? dashboardNomePiloto(piloto) : (indisponivel ? "Dados indisponíveis" : "Meta não atingida");
    if (indisponivel) console.warn("[Kart/Highlights] métrica sem dados", { titulo, descricao });
    return `
        <div class="dashboard-card">
            <div class="dashboard-card-title">${titulo}</div>
            ${vazio || !piloto ? '<div class="dashboard-empty-mark">–</div>' : dashboardAvatar(piloto)}
            <div class="dashboard-card-name">${htmlEscape(nome)}</div>
            <div class="dashboard-card-value">${htmlEscape(valor || "-")}</div>
            <div class="dashboard-card-desc">${htmlEscape(descricao || "")}</div>
        </div>
    `;
}

function dashboardCardsEtapa(stat) {
    const m = stat.metricas;
    const officialPilotUids = stat.officialPilotUids instanceof Set ? stat.officialPilotUids : new Set(stat.officialPilotUids || []);
    const officialHighlight = (candidate, type) => {
        const pilot = candidate?.piloto || candidate;
        if (!pilot || officialPilotUids.has(getPilotUid(pilot))) return candidate;
        console.error("[Kart/Highlights] piloto externo selecionado", { type, pilot_uid: getPilotUid(pilot) });
        return null;
    };
    stat.grandChelem = officialHighlight(stat.grandChelem, "grandChelem");
    stat.hatTrick = officialHighlight(stat.hatTrick, "hatTrick");
    stat.melhorVolta = officialHighlight(stat.melhorVolta, "bestLap");
    stat.pole = officialHighlight(stat.pole, "pole");
    m.topUltrapassagens = officialHighlight(m.topUltrapassagens, "overtakes");
    m.melhorLargada = officialHighlight(m.melhorLargada, "start");
    m.topLideradas = officialHighlight(m.topLideradas, "leadership");
    m.topRegularidade = officialHighlight(m.topRegularidade, "regularity");
    return [
        dashboardCard({
            titulo: "🏆 Grand Chelem",
            piloto: stat.grandChelem,
            valor: stat.grandChelem ? "Completo" : "-",
            descricao: stat.grandChelem ? "Pole + vitória + melhor volta + todas as voltas lideradas" : "Ninguém completou todos os requisitos nesta etapa",
            vazio: !stat.grandChelem
        }),
        dashboardCard({
            titulo: "🎩 Hat-trick",
            piloto: stat.hatTrick,
            valor: stat.hatTrick ? "Pole + vitória + MV" : "-",
            descricao: stat.hatTrick ? "Dominou classificação, resultado e melhor volta" : "Ninguém fez pole + vitória + melhor volta nesta etapa",
            vazio: !stat.hatTrick
        }),
        dashboardCard({
            titulo: "⏱️ Melhor Volta",
            piloto: stat.melhorVolta?.piloto,
            valor: stat.melhorVolta ? dashboardFormatarTempoSegundos(stat.melhorVolta.tempo) : "-",
            descricao: "Volta mais rápida da etapa",
            vazio: !stat.melhorVolta,
            indisponivel: !stat.melhorVolta && !stat.completo?.volta_a_volta
        }),
        dashboardCard({
            titulo: "🎯 Pole Position",
            piloto: stat.pole,
            valor: stat.pole?.melhor_tempo || "-",
            descricao: "Melhor posição da classificação",
            vazio: !stat.pole,
            indisponivel: !stat.pole && !stat.completo?.classificacao
        }),
        dashboardCard({
            titulo: "🚀 + Ultrapassagens",
            piloto: m.topUltrapassagens?.piloto,
            valor: m.topUltrapassagens ? `${m.topUltrapassagens.total} ${m.topUltrapassagens.total === 1 ? "ultrapassagem" : "ultrapassagens"}` : "-",
            descricao: "Maior total de ultrapassagens feitas na etapa",
            vazio: !m.topUltrapassagens,
            indisponivel: !m.topUltrapassagens && !stat.completo?.volta_a_volta
        }),
        dashboardCard({
            titulo: "🏁 Melhor Largada",
            piloto: m.melhorLargada?.piloto,
            valor: m.melhorLargada ? `${m.melhorLargada.ganho >= 0 ? "+" : ""}${m.melhorLargada.ganho} posições` : "-",
            descricao: m.melhorLargada ? `De ${m.melhorLargada.grid}º no grid para ${m.melhorLargada.posVolta1}º após a 1ª volta` : "Nenhum piloto do campeonato ganhou posições na 1ª volta",
            vazio: !m.melhorLargada
        }),
        dashboardCard({
            titulo: "🏴 Liderou mais voltas",
            piloto: m.topLideradas?.piloto,
            valor: m.topLideradas ? `${m.topLideradas.total} voltas` : "-",
            descricao: m.topLideradas ? "Maior número de passagens em primeiro" : "Nenhum piloto do campeonato liderou voltas nesta etapa",
            vazio: !m.topLideradas
        }),
        dashboardCard({
            titulo: "📏 Top Regularidade",
            piloto: m.topRegularidade?.piloto,
            valor: m.topRegularidade ? `±${m.topRegularidade.desvio.toFixed(3)}s` : "-",
            descricao: m.topRegularidade ? `Desvio das voltas limpas · pace ${dashboardFormatarTempoSegundos(m.topRegularidade.pace)}` : "São necessárias ao menos 5 voltas limpas",
            vazio: !m.topRegularidade,
            indisponivel: !m.topRegularidade && !stat.completo?.volta_a_volta
        })
    ].join("");
}

function dashboardCardsGeral(geral) {
    return [
        dashboardCard({
            titulo: "🏆 Grand Chelem",
            piloto: geral.topGrand?.piloto,
            valor: geral.topGrand ? `${geral.topGrand.total} vez(es)` : "-",
            descricao: "Pole + vitória + melhor volta + todas as voltas lideradas",
            vazio: !geral.topGrand
        }),
        dashboardCard({
            titulo: "🎩 Hat-trick",
            piloto: geral.topHat?.piloto,
            valor: geral.topHat ? `${geral.topHat.total} vez(es)` : "-",
            descricao: "Pole + vitória + melhor volta na mesma etapa",
            vazio: !geral.topHat
        }),
        dashboardCard({
            titulo: "⏱️ Melhor Volta",
            piloto: geral.melhorVoltaAbsoluta?.piloto,
            valor: geral.melhorVoltaAbsoluta ? dashboardFormatarTempoSegundos(geral.melhorVoltaAbsoluta.tempo) : "-",
            descricao: geral.melhorVoltaAbsoluta ? `Melhor marca do campeonato · Etapa ${geral.melhorVoltaAbsoluta.etapa.meta.etapa || "-"}` : "Sem tempo válido",
            vazio: !geral.melhorVoltaAbsoluta
        }),
        dashboardCard({
            titulo: "🎯 Pole Position",
            piloto: geral.topPoles?.piloto,
            valor: geral.topPoles ? `${geral.topPoles.total} pole(s)` : "-",
            descricao: "Piloto com mais poles no campeonato",
            vazio: !geral.topPoles
        }),
        dashboardCard({
            titulo: "🚀 + Ultrapassagens",
            piloto: geral.topUltrapassagens?.piloto,
            valor: geral.topUltrapassagens ? `${geral.topUltrapassagens.total} ${geral.topUltrapassagens.total === 1 ? "ultrapassagem" : "ultrapassagens"}` : "-",
            descricao: "Total de ultrapassagens feitas nas etapas",
            vazio: !geral.topUltrapassagens
        }),
        dashboardCard({
            titulo: "🏁 Melhor Largada",
            piloto: geral.melhorLargada?.piloto,
            valor: geral.melhorLargada ? `${geral.melhorLargada.ganho >= 0 ? "+" : ""}${geral.melhorLargada.ganho} posições` : "-",
            descricao: geral.melhorLargada ? `Melhor ganho em uma etapa · Etapa ${geral.melhorLargada.etapa.meta.etapa || "-"}` : "Nenhum piloto do campeonato ganhou posições na 1ª volta",
            vazio: !geral.melhorLargada
        }),
        dashboardCard({
            titulo: "🏴 Liderou mais voltas",
            piloto: geral.topLideradas?.piloto,
            valor: geral.topLideradas ? `${geral.topLideradas.total} voltas` : "-",
            descricao: geral.topLideradas ? "Total de voltas lideradas no campeonato" : "Nenhum piloto do campeonato liderou voltas no período",
            vazio: !geral.topLideradas
        }),
        dashboardCard({
            titulo: "📏 Top Regularidade",
            piloto: geral.topRegularidade?.piloto,
            valor: geral.topRegularidade ? `±${geral.topRegularidade.media.toFixed(3)}s` : "-",
            descricao: "Média do desvio das voltas limpas nas etapas com dados",
            vazio: !geral.topRegularidade
        })
    ].join("");
}

function dashboardPodium(items, modoGeral = false) {
    const medalhas = ["🥇", "🥈", "🥉"];
    if (!items?.length) return "<p class='muted'>Sem pódio disponível.</p>";

    return `<div class="podium-grid">${items.slice(0, 3).map((p, idx) => `
        <div class="podium-card">
            <div class="podium-pos">${medalhas[idx]}</div>
            ${dashboardAvatar(p, "dashboard-avatar")}
            <div class="podium-info">
                <div class="podium-name">${htmlEscape(dashboardNomePiloto(p))}</div>
                <div class="podium-meta">${modoGeral ? `${Number(p.pontos_total || 0)} pts` : `${idx + 1}º na etapa${p.pontos !== undefined ? ` · ${Number(p.pontos || 0) + Number(p.melhor_tempo_ponto || 0)} pts` : ""}`}</div>
            </div>
        </div>
    `).join("")}</div>`;
}

function dashboardTabelaGeral(ranking, geral) {
    const statsPorKey = new Map();
    ranking.forEach(item => statsPorKey.set(dashboardPilotoKey(item), item));

    return `
        <div class="dashboard-table-card">
            <div class="dashboard-section-title" style="margin-top:0;"><h3>🏆 Classificação do Campeonato</h3><span>${ranking.length} piloto(s)</span></div>
            <div class="dashboard-table-wrap">
                <table class="dashboard-table">
                    <tr><th class="dashboard-sticky-identity">Pos&nbsp;&nbsp;Piloto</th><th>Nome</th><th>Pts</th><th>Vit</th><th>Pódios</th><th>Poles</th><th>MV</th><th>Ações</th></tr>
                    ${ranking.map((p, idx) => {
                        const key = dashboardPilotoKey(p);
                        const medalha = ["🥇", "🥈", "🥉"][idx] || "";
                        return `<tr class="${idx < 3 ? `stage-result-top stage-result-top-${idx + 1}` : ""}">
                            <td class="dashboard-sticky-identity"><div class="dashboard-identity-cell"><strong>${medalha} ${idx + 1}º</strong>${dashboardMiniAvatar(p)}</div></td>
                            <td><strong>${htmlEscape(dashboardNomePiloto(p))}</strong></td>
                            <td><strong>${Number(p.pontos_total || 0)}</strong></td>
                            <td>${geral.vitorias.get(key)?.total || 0}</td>
                            <td>${geral.podios.get(key)?.total || 0}</td>
                            <td>${geral.poles.get(key)?.total || 0}</td>
                            <td>${geral.mvs.get(key)?.total || 0}</td>
                            <td><button class="btn-view" onclick="openPilotDashboard({ pilotUid: '${htmlEscape(getPilotUid(p))}', campeonatoId: '${htmlEscape(DASHBOARD_STAGE_STATE.campeonatoId || document.getElementById("filtro_rank_firebase_camp")?.value || "")}', etapaId: null })">Detalhes</button></td>
                        </tr>`;
                    }).join("")}
                </table>
            </div>
        </div>
    `;
}

function dashboardTabelaEtapa(stat) {
    const classMap = new Map(stat.classificacao.map((p, idx) => [dashboardPilotoKey(p), {
        piloto: p,
        positionChampionship: Number(p.positionChampionship || p.posicao_final2 || idx + 1),
        positionOverall: Number(p.positionOverall || p.posicao_geral_arquivo || p.posicao_final || p.posicao || idx + 1),
        bestLap: p.qualifying?.bestLap ?? p.melhor_tempo ?? null,
        poleBonus: Number(p.scoring?.poleBonus ?? p.melhor_tempo_ponto ?? p.pontos ?? 0)
    }]));
    return `
        <div class="dashboard-table-card">
            <div class="dashboard-section-title" style="margin-top:0;"><h3>🏁 Resultado da Etapa</h3><span>${stat.corrida.length} piloto(s)</span></div>
            <div class="dashboard-table-wrap">
                <table class="dashboard-table stage-table">
                    <tr><th class="dashboard-sticky-pos">Pos</th><th>Piloto</th><th>Nome</th><th>Grid</th><th>Kart</th><th>Voltas</th><th>Melhor Volta</th><th>Total</th><th>Pts Base</th><th>Bônus MV</th><th>Bônus Grid</th><th>Pts</th><th>Ações</th></tr>
                    ${stat.corrida.map((p, idx) => {
                        const qualifying = classMap.get(dashboardPilotoKey(p));
                        const grid = qualifying?.positionChampionship || "-";
                        const base = Number(p.scoring?.base ?? p.pontos ?? 0);
                        const fastestLapBonus = Number(p.scoring?.fastestLapBonus ?? p.melhor_tempo_ponto ?? 0);
                        const poleBonus = Number(p.scoring?.poleBonus ?? qualifying?.poleBonus ?? 0);
                        const pts = Number(p.scoring?.total ?? (base + fastestLapBonus + poleBonus));
                        const known = base + fastestLapBonus + poleBonus;
                        const otherBonus = pts - known;
                        const pointsTitle = otherBonus ? `Outros bônus persistidos: ${otherBonus > 0 ? "+" : ""}${otherBonus}` : "Pontos base + bônus MV + bônus Grid";
                        const medalha = ["🥇", "🥈", "🥉"][idx] || "";
                        return `<tr class="${idx < 3 ? `stage-result-top stage-result-top-${idx + 1}` : ""}">
                            <td class="dashboard-sticky-pos"><strong>${medalha} ${idx + 1}º</strong></td>
                            <td>${dashboardMiniAvatar(p)}</td>
                            <td><button class="dashboard-name-link" onclick="openPilotDashboard({ pilotUid: '${htmlEscape(getPilotUid(p))}', campeonatoId: '${htmlEscape(DASHBOARD_STAGE_STATE.campeonatoId)}', etapaId: null })">${htmlEscape(dashboardNomePiloto(p))}</button></td>
                            <td><div class="grid-result grid-info" title="Grid campeonato: P${grid} · Grid geral: P${qualifying?.positionOverall || "-"} · Tempo: ${htmlEscape(qualifying?.bestLap || "—")}"><strong class="grid-championship">${grid}</strong><small class="grid-overall">Geral: P${qualifying?.positionOverall || "-"}</small><small class="grid-time">${htmlEscape(qualifying?.bestLap || "—")}</small></div></td>
                            <td>${htmlEscape(p.kart_numero || "-")}</td>
                            <td>${htmlEscape(p.voltas ?? "-")}</td>
                            <td>${htmlEscape(p.melhor_tempo || "-")}</td>
                            <td>${htmlEscape(p.total_tempo || "-")}</td>
                            <td>${base}</td>
                            <td>${fastestLapBonus ? `+${fastestLapBonus}` : "—"}</td>
                            <td>${poleBonus ? `+${poleBonus}` : "—"}</td>
                            <td title="${htmlEscape(pointsTitle)}"><strong>${pts}</strong>${otherBonus ? `<small class="other-bonus">outros ${otherBonus > 0 ? "+" : ""}${otherBonus}</small>` : ""}</td>
                            <td><button class="btn-view" onclick="openRaceDetails({ pilotUid: '${htmlEscape(getPilotUid(p))}', campeonatoId: '${htmlEscape(DASHBOARD_STAGE_STATE.campeonatoId)}', etapaId: '${htmlEscape(DASHBOARD_STAGE_STATE.etapaId)}' })">Detalhes</button></td>
                        </tr>`;
                    }).join("")}
                </table>
            </div>
        </div>
    `;
}

function dashboardHero(payload, ranking, statSelecionada = null) {
    const etapa = statSelecionada?.etapa?.meta || null;
    const destaque = statSelecionada ? statSelecionada.vencedor : ranking[0];
    const meta = [];
    if (etapa) {
        meta.push(`Etapa ${etapa.etapa || "-"}`);
        if (etapa.dataCorrida) meta.push(formatarDataBR(etapa.dataCorrida));
    } else {
        meta.push(`${payload.etapas.length} etapa(s)`);
        if (payload.campData.data_inicio || payload.campData["data de inicio"]) meta.push(`Início ${formatarDataBR(payload.campData.data_inicio || payload.campData["data de inicio"])}`);
    }

    return `
        <div class="champ-hero">
            <div class="champ-hero-main">
                <div class="home-kicker">${statSelecionada ? "ETAPA SELECIONADA" : "VISÃO GERAL"}</div>
                <h2 class="champ-title">${htmlEscape(payload.campeonatoNome)}</h2>
                <div class="champ-meta">${meta.map(m => `<span class="champ-pill">${htmlEscape(m)}</span>`).join("")}</div>
                ${destaque ? `<div class="hero-leader">
                    ${dashboardAvatar(destaque, "hero-avatar")}
                    <div>
                        <div class="hero-leader-label">${statSelecionada ? "Vencedor da etapa" : "Líder do campeonato"}</div>
                        <div class="hero-leader-name">${htmlEscape(dashboardNomePiloto(destaque))}</div>
                        <div class="hero-leader-score">${statSelecionada ? `${Number(destaque.pontos || 0) + Number(destaque.melhor_tempo_ponto || 0)} pts na etapa` : `${Number(destaque.pontos_total || 0)} pontos`}</div>
                    </div>
                </div>` : ""}
            </div>
            <div class="champ-hero-side">
                <div class="hero-side-number">${statSelecionada ? statSelecionada.corrida.length : ranking.length}</div>
                <div class="hero-side-label">Pilotos com dados nesta visualização</div>
                <div class="hero-side-divider"></div>
                <div class="hero-side-number">${statSelecionada ? (statSelecionada.metricas.totalVoltasLider || statSelecionada.vencedor?.voltas || "-") : payload.etapas.length}</div>
                <div class="hero-side-label">${statSelecionada ? "Voltas analisadas" : "Etapas cadastradas"}</div>
            </div>
        </div>
    `;
}

async function carregarFiltroEtapasDashboard(campeonatoDocId, payload = null) {
    const select = document.getElementById("filtro_rank_etapa");
    if (!select) return;

    const valorAtual = select.value || "geral";
    if (!campeonatoDocId) {
        select.innerHTML = '<option value="geral">🏆 Geral do campeonato</option>';
        return;
    }

    const dados = payload || await carregarDashboardCampeonato(campeonatoDocId);
    const opts = dados.etapas.map(etapa => {
        const numero = etapa.meta.etapa || etapa.docId;
        const data = etapa.meta.dataCorrida ? ` — ${formatarDataBR(etapa.meta.dataCorrida)}` : "";
        return `<option value="${htmlEscape(etapa.docId)}">🏁 Etapa ${htmlEscape(numero)}${data}</option>`;
    }).join("");

    select.innerHTML = `<option value="geral">🏆 Geral do campeonato</option>${opts}`;
    if (valorAtual === "geral" || dados.etapas.some(e => e.docId === valorAtual)) select.value = valorAtual;
    else select.value = "geral";
}

async function onEtapaDashboardChange() {
    limparPilotosCampeonatoEtapa();
    await renderDashboardCampeonato();
}

async function onCampeonatoRankingChange() {
    limparPilotosCampeonatoEtapa();
    const campId = document.getElementById("filtro_rank_firebase_camp")?.value || "";
    const etapaSelect = document.getElementById("filtro_rank_etapa");
    if (etapaSelect) etapaSelect.value = "geral";
    if (campId) limparCacheDashboardCampeonato(campId);
    await carregarFiltroEtapasDashboard(campId);
    await renderDashboardCampeonato();
}

async function renderDashboardCampeonato() {
    const renderToken = ++DASHBOARD_STAGE_RENDER_TOKEN;
    const select = document.getElementById("filtro_rank_firebase_camp");
    const etapaSelect = document.getElementById("filtro_rank_etapa");
    const content = document.getElementById("rankingFirestoreContent");
    const status = document.getElementById("rankingFirestoreStatus");
    if (!select || !content) return;

    const campId = select.value;
    if (!campId) {
        limparPilotosCampeonatoEtapa();
        content.innerHTML = "";
        if (status) status.innerHTML = "Selecione um campeonato para carregar os dados.";
        return;
    }

    try {
        if (status) status.innerHTML = "⏳ Montando resumo do campeonato...";
        const payload = await carregarDashboardCampeonato(campId);
        if (renderToken !== DASHBOARD_STAGE_RENDER_TOKEN) return;
        await carregarFiltroEtapasDashboard(campId, payload);
        if (renderToken !== DASHBOARD_STAGE_RENDER_TOKEN) return;
        const filtroEtapa = etapaSelect?.value || "geral";
        const ranking = await buscarRankingFirestorePorCampeonato(campId);

        if (filtroEtapa === "geral") {
            const geral = dashboardEstatisticasGeral(payload, ranking);
            content.innerHTML = `
                ${dashboardHero(payload, ranking)}
                <div class="dashboard-section-title"><h3>⭐ Destaques do Campeonato</h3><span>acumulado de todas as etapas</span></div>
                <div class="dashboard-cards">${dashboardCardsGeral(geral)}</div>
                ${dashboardTabelaGeral(ranking, geral)}
                <div class="dashboard-note">Ultrapassagens, largada, voltas lideradas e regularidade são calculadas quando o arquivo Volta a volta está disponível. Regularidade usa voltas limpas: exclui a volta 1, voltas muito lentas e possíveis voltas anormalmente rápidas.</div>
            `;
            if (status) status.innerHTML = `✅ Visão geral carregada · ${payload.etapas.length} etapa(s) · ${ranking.length} piloto(s).`;
            return;
        }

        const idx = payload.etapas.findIndex(e => e.docId === filtroEtapa);
        const stat = idx >= 0 ? payload.etapasStats[idx] : null;
        if (!stat) {
            content.innerHTML = "<p class='muted'>Etapa não encontrada.</p>";
            if (status) status.innerHTML = "Etapa não encontrada.";
            return;
        }

        content.innerHTML = `
            ${dashboardHero(payload, ranking, stat)}
            <div class="dashboard-section-title"><h3>⭐ Destaques da Etapa</h3><span>estatísticas da corrida selecionada</span></div>
            <div class="dashboard-cards">${dashboardCardsEtapa(stat)}</div>
            ${dashboardTabelaEtapa(stat)}
            <div class="dashboard-note">As posições ganhas volta a volta são uma estimativa baseada na ordem de passagem registrada no arquivo. Quando o Volta a volta não está salvo com conteúdo, esses cartões aparecem sem dados, mas resultado, pole e melhor volta continuam disponíveis.</div>
        `;
        if (status) status.innerHTML = `✅ Etapa ${htmlEscape(stat.etapa.meta.etapa || stat.etapa.docId)} carregada · ${stat.corrida.length} piloto(s).`;
    } catch (e) {
        console.error(e);
        content.innerHTML = "";
        if (status) status.innerHTML = `❌ Erro ao montar o dashboard: ${htmlEscape(e.message || e)}`;
    }
}

/* Sobrescreve somente a renderização da primeira tela. As telas de importação,
   consulta e gestão continuam usando o mesmo fluxo/código já existente. */
async function inicializarRankingFirestore() {
    limparCacheDashboardCampeonato();
    await carregarCampeonatosRankingFirestore();
    const campId = document.getElementById("filtro_rank_firebase_camp")?.value || "";
    await carregarFiltroEtapasDashboard(campId);
    await renderDashboardCampeonato();
}

async function renderRankingFirestore() {
    const campId = document.getElementById("filtro_rank_firebase_camp")?.value || "";
    if (campId) limparCacheDashboardCampeonato(campId);
    return renderDashboardCampeonato();
}



/* ============================================================================
   DASHBOARD PERSISTIDO V2
   Os cálculos acontecem durante a importação/reprocessamento. A tela inicial
   apenas consulta dashboardResumo (etapa) e dashboardGeral (campeonato).
   ============================================================================ */

const DASHBOARD_RESUMO_VERSION = 5;

function dashboardPilotoPersistivel(item) {
    if (!item) return null;
    return toFirestoreSafe({
        pilot_uid: getPilotUid(item),
        driver_id: item.driver_id || item.id_piloto || "",
        id_piloto: item.id_piloto || item.driver_id || "",
        driver_name_display: item.driver_name_display || item.name || item.driver_name || item.nome || item.piloto || "-",
        driver_name: item.driver_name_display || item.name || item.driver_name || item.nome || item.piloto || "-",
        nome: item.driver_name_display || item.name || item.nome || item.driver_name || item.piloto || "-",
        kart_numero: item.kart_numero || item.kart_number || "",
        classe: item.classe || "",
        posicao_final2: Number(item.posicao_final2 || 0),
        posicao_final: Number(item.posicao_final || 0),
        posicao_geral_arquivo: Number(item.posicao_geral_arquivo || 0),
        posicao_largada_campeonato: Number(item.posicao_largada_campeonato || item.posicao_classificacao_campeonato || 0),
        pontos: Number(item.pontos || 0),
        melhor_tempo_ponto: Number(item.melhor_tempo_ponto || 0),
        voltas: item.voltas ?? null,
        total_tempo: item.total_tempo || "",
        total_tempo_segundos: item.total_tempo_segundos ?? null,
        melhor_tempo: item.melhor_tempo || "",
        melhor_tempo_segundos: item.melhor_tempo_segundos ?? null,
        diff: item.diff || "",
        espaco: item.espaco || "",
        s1_melhor_vlt: item.s1_melhor_vlt ?? null,
        s2_melhor_vlt: item.s2_melhor_vlt ?? null,
        s3_melhor_vlt: item.s3_melhor_vlt ?? null,
        sfspd_melhor_vlt: item.sfspd_melhor_vlt ?? null
    });
}

function dashboardPilotoMetricaPersistivel(item) {
    if (!item) return null;
    return toFirestoreSafe({
        pilot_uid: getPilotUid(item),
        driver_id: item.driver_id || item.id_piloto || "",
        id_piloto: item.id_piloto || item.driver_id || "",
        driver_name_display: item.driver_name_display || item.name || item.driver_name || item.nome || item.piloto || "-",
        driver_name: item.driver_name_display || item.name || item.driver_name || item.nome || item.piloto || "-",
        nome: item.driver_name_display || item.name || item.nome || item.driver_name || item.piloto || "-",
        kart_numero: item.kart_numero || ""
    });
}

function dashboardListaMapaPersistivel(mapa, camposExtras = []) {
    if (!mapa) return [];
    const valores = mapa instanceof Map ? [...mapa.values()] : (Array.isArray(mapa) ? mapa : []);
    return valores.map(item => {
        const base = { piloto: dashboardPilotoMetricaPersistivel(item.piloto) };
        camposExtras.forEach(campo => { base[campo] = item[campo] ?? null; });
        return toFirestoreSafe(base);
    });
}

function dashboardSerializarEstatisticasEtapa(stat, fontes = {}) {
    const m = stat.metricas || {};
    return toFirestoreSafe({
        versao: DASHBOARD_RESUMO_VERSION,
        atualizadoEmISO: new Date().toISOString(),
        completo: {
            resultado_final: !!stat.corrida?.length,
            classificacao: !!stat.classificacao?.length,
            volta_a_volta: Number(m.totalVoltasLider || 0) > 0
        },
        fontes,
        qtdPilotosCorrida: stat.corrida?.length || 0,
        qtdPilotosClassificacao: stat.classificacao?.length || 0,
        qtdVoltasAnalisadas: Number(m.totalVoltasLider || 0),
        officialPilotUids: [...(stat.officialPilotUids || [])],
        corrida: (stat.corrida || []).map(dashboardPilotoPersistivel),
        classificacao: (stat.classificacao || []).map(dashboardPilotoPersistivel),
        podium: (stat.podium || []).map(dashboardPilotoPersistivel),
        vencedor: dashboardPilotoPersistivel(stat.vencedor),
        pole: dashboardPilotoPersistivel(stat.pole),
        melhorVolta: stat.melhorVolta ? {
            piloto: dashboardPilotoMetricaPersistivel(stat.melhorVolta.piloto),
            tempo: Number(stat.melhorVolta.tempo || 0)
        } : null,
        hatTrick: dashboardPilotoPersistivel(stat.hatTrick),
        grandChelem: dashboardPilotoPersistivel(stat.grandChelem),
        metricas: {
            ultrapassagens: dashboardListaMapaPersistivel(m.ultrapassagens, ["total"]),
            lideradas: dashboardListaMapaPersistivel(m.lideradas, ["total"]),
            regularidade: dashboardListaMapaPersistivel(m.regularidade, ["desvio", "limpas", "pace", "status"]),
            melhorLargada: m.melhorLargada ? {
                piloto: dashboardPilotoMetricaPersistivel(m.melhorLargada.piloto),
                ganho: Number(m.melhorLargada.ganho || 0),
                grid: Number(m.melhorLargada.grid || 0),
                posVolta1: Number(m.melhorLargada.posVolta1 || 0)
            } : null,
            topUltrapassagens: m.topUltrapassagens ? {
                piloto: dashboardPilotoMetricaPersistivel(m.topUltrapassagens.piloto),
                total: Number(m.topUltrapassagens.total || 0)
            } : null,
            topLideradas: m.topLideradas ? {
                piloto: dashboardPilotoMetricaPersistivel(m.topLideradas.piloto),
                total: Number(m.topLideradas.total || 0)
            } : null,
            topRegularidade: m.topRegularidade ? {
                piloto: dashboardPilotoMetricaPersistivel(m.topRegularidade.piloto),
                desvio: Number.isFinite(m.topRegularidade.desvio) ? m.topRegularidade.desvio : null,
                limpas: Number(m.topRegularidade.limpas || 0),
                pace: Number.isFinite(m.topRegularidade.pace) ? m.topRegularidade.pace : null
            } : null,
            totalVoltasLider: Number(m.totalVoltasLider || 0)
        }
    });
}

function dashboardHidratarEstatisticasEtapa(meta, resumo, docId = "") {
    const r = resumo || {};
    const m = r.metricas || {};
    return {
        persistido: !!r.versao,
        officialPilotUids: new Set(r.officialPilotUids || []),
        etapa: { docId, meta: { ...(meta || {}), resultadoDocId: docId } },
        corrida: Array.isArray(r.corrida) ? r.corrida : [],
        classificacao: Array.isArray(r.classificacao) ? r.classificacao : [],
        podium: Array.isArray(r.podium) ? r.podium : [],
        vencedor: r.vencedor || null,
        pole: r.pole || null,
        melhorVolta: r.melhorVolta || null,
        hatTrick: r.hatTrick || null,
        grandChelem: r.grandChelem || null,
        completo: r.completo || {},
        metricas: {
            ultrapassagens: Array.isArray(m.ultrapassagens) ? m.ultrapassagens : [],
            lideradas: Array.isArray(m.lideradas) ? m.lideradas : [],
            regularidade: Array.isArray(m.regularidade) ? m.regularidade : [],
            melhorLargada: m.melhorLargada || null,
            topUltrapassagens: m.topUltrapassagens || null,
            topLideradas: m.topLideradas || null,
            topRegularidade: m.topRegularidade || null,
            totalVoltasLider: Number(m.totalVoltasLider || r.qtdVoltasAnalisadas || 0)
        }
    };
}

function dashboardRankingDasEtapasPersistidas(etapasStats) {
    const mapa = new Map();
    const garantir = piloto => {
        const key = dashboardPilotoKey(piloto);
        if (!key) return null;
        if (!mapa.has(key)) mapa.set(key, {
            ...dashboardPilotoMetricaPersistivel(piloto),
            pontos_posicao_corrida: 0,
            pontos_melhor_tempo_corrida: 0,
            pontos_melhor_tempo_classificacao: 0,
            pontos_total: 0,
            etapas: []
        });
        return mapa.get(key);
    };

    (etapasStats || []).forEach(stat => {
        const etapaNumero = stat.etapa?.meta?.etapa || "-";
        const dataCorrida = stat.etapa?.meta?.dataCorrida || "-";

        (stat.corrida || []).forEach(p => {
            const linha = garantir(p);
            if (!linha) return;
            const pontos = Number(p.pontos || 0);
            const bonus = Number(p.melhor_tempo_ponto || 0);
            linha.pontos_posicao_corrida += pontos;
            linha.pontos_melhor_tempo_corrida += bonus;
            linha.pontos_total += pontos + bonus;
            linha.etapas.push({ tipo: "Resultado Final", etapa: etapaNumero, dataCorrida, pontos, melhor_tempo_ponto: bonus, posicao_final2: dashboardPosicaoCampeonato(p), melhor_tempo: p.melhor_tempo || "-" });
        });

        (stat.classificacao || []).forEach(p => {
            const linha = garantir(p);
            if (!linha) return;
            const bonus = Math.max(Number(p.melhor_tempo_ponto || 0), Number(p.pontos || 0));
            linha.pontos_melhor_tempo_classificacao += bonus;
            linha.pontos_total += bonus;
            linha.etapas.push({ tipo: "Classificação", etapa: etapaNumero, dataCorrida, pontos: bonus, melhor_tempo_ponto: bonus, posicao_final2: dashboardPosicaoCampeonato(p), melhor_tempo: p.melhor_tempo || "-" });
        });
    });

    return [...mapa.values()].sort((a, b) =>
        Number(b.pontos_total || 0) - Number(a.pontos_total || 0) ||
        dashboardNomePiloto(a).localeCompare(dashboardNomePiloto(b))
    );
}

function dashboardMapaGeralPersistivel(mapa) {
    if (!(mapa instanceof Map)) return [];
    return [...mapa.values()].map(item => toFirestoreSafe({
        piloto: dashboardPilotoMetricaPersistivel(item.piloto),
        total: Number(item.total || 0)
    }));
}

function dashboardSerializarGeral(geral, ranking, etapasStats) {
    return toFirestoreSafe({
        versao: DASHBOARD_RESUMO_VERSION,
        atualizadoEmISO: new Date().toISOString(),
        qtdEtapas: etapasStats.length,
        qtdPilotos: ranking.length,
        ranking,
        vitorias: dashboardMapaGeralPersistivel(geral.vitorias),
        poles: dashboardMapaGeralPersistivel(geral.poles),
        mvs: dashboardMapaGeralPersistivel(geral.mvs),
        podios: dashboardMapaGeralPersistivel(geral.podios),
        ultrapassagens: dashboardMapaGeralPersistivel(geral.ultrapassagens),
        lideradas: dashboardMapaGeralPersistivel(geral.lideradas),
        grand: dashboardMapaGeralPersistivel(geral.grand),
        hat: dashboardMapaGeralPersistivel(geral.hat),
        melhorLargada: geral.melhorLargada ? {
            piloto: dashboardPilotoMetricaPersistivel(geral.melhorLargada.piloto),
            ganho: Number(geral.melhorLargada.ganho || 0),
            grid: Number(geral.melhorLargada.grid || 0),
            posVolta1: Number(geral.melhorLargada.posVolta1 || 0),
            etapa: {
                docId: geral.melhorLargada.etapa?.docId || "",
                meta: geral.melhorLargada.etapa?.meta || {}
            }
        } : null,
        melhorVoltaAbsoluta: geral.melhorVoltaAbsoluta ? {
            piloto: dashboardPilotoMetricaPersistivel(geral.melhorVoltaAbsoluta.piloto),
            tempo: Number(geral.melhorVoltaAbsoluta.tempo || 0),
            etapa: {
                docId: geral.melhorVoltaAbsoluta.etapa?.docId || "",
                meta: geral.melhorVoltaAbsoluta.etapa?.meta || {}
            }
        } : null,
        topVitorias: geral.topVitorias || null,
        topPoles: geral.topPoles || null,
        topMvs: geral.topMvs || null,
        topPodios: geral.topPodios || null,
        topUltrapassagens: geral.topUltrapassagens || null,
        topLideradas: geral.topLideradas || null,
        topGrand: geral.topGrand || null,
        topHat: geral.topHat || null,
        topRegularidade: geral.topRegularidade ? {
            piloto: dashboardPilotoMetricaPersistivel(geral.topRegularidade.piloto),
            media: Number.isFinite(geral.topRegularidade.media) ? geral.topRegularidade.media : null,
            valores: geral.topRegularidade.valores || []
        } : null
    });
}

function dashboardArrayParaMapa(arr) {
    const mapa = new Map();
    (Array.isArray(arr) ? arr : []).forEach(item => {
        const key = dashboardPilotoKey(item.piloto);
        if (key) mapa.set(key, item);
    });
    return mapa;
}

function dashboardHidratarGeral(resumo) {
    if (!resumo?.versao) return null;
    return {
        ranking: Array.isArray(resumo.ranking) ? resumo.ranking : [],
        vitorias: dashboardArrayParaMapa(resumo.vitorias),
        poles: dashboardArrayParaMapa(resumo.poles),
        mvs: dashboardArrayParaMapa(resumo.mvs),
        podios: dashboardArrayParaMapa(resumo.podios),
        ultrapassagens: dashboardArrayParaMapa(resumo.ultrapassagens),
        lideradas: dashboardArrayParaMapa(resumo.lideradas),
        grand: dashboardArrayParaMapa(resumo.grand),
        hat: dashboardArrayParaMapa(resumo.hat),
        melhorLargada: resumo.melhorLargada || null,
        melhorVoltaAbsoluta: resumo.melhorVoltaAbsoluta || null,
        topVitorias: resumo.topVitorias || null,
        topPoles: resumo.topPoles || null,
        topMvs: resumo.topMvs || null,
        topPodios: resumo.topPodios || null,
        topUltrapassagens: resumo.topUltrapassagens || null,
        topLideradas: resumo.topLideradas || null,
        topGrand: resumo.topGrand || null,
        topHat: resumo.topHat || null,
        topRegularidade: resumo.topRegularidade || null
    };
}

async function dashboardBuscarVoltasEtapaParaPersistir(campRef, meta, conteudoVoltaAtual = "", nomeArquivoAtual = "", idImportacaoAtual = "") {
    if (String(conteudoVoltaAtual || "").trim()) {
        return {
            voltas: extrairVoltaAVoltaHTMLTexto(conteudoVoltaAtual, nomeArquivoAtual || "volta_a_volta.html"),
            fonte: { idImportacao: idImportacaoAtual || "", nomeArquivo: nomeArquivoAtual || "", origem: "importacao_atual" }
        };
    }

    const snapshot = await campRef.collection("volta_a_volta").get();
    const candidatos = snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() || {} })).filter(doc => {
        const etapaA = Number(doc.data.etapa || 0);
        const etapaB = Number(meta.etapa || 0);
        const dataA = String(doc.data.dataCorrida || "");
        const dataB = String(meta.dataCorrida || "");
        if (dataA && dataB && dataA !== dataB) return false;
        if (etapaA && etapaB && etapaA !== etapaB) return false;
        return (dataA && dataB) || (etapaA && etapaB);
    }).sort((a, b) => String(b.data.dataUploadISO || b.data.atualizadoEmISO || b.data.criadoEmISO || "").localeCompare(String(a.data.dataUploadISO || a.data.atualizadoEmISO || a.data.criadoEmISO || "")));

    for (const doc of candidatos) {
        const conteudo = await dashboardConteudoVoltaDoc(doc);
        if (!String(conteudo || "").trim()) continue;
        return {
            voltas: extrairVoltaAVoltaHTMLTexto(conteudo, doc.data.nomeArquivo || doc.id || "volta_a_volta.html"),
            fonte: { idImportacao: doc.data.idImportacao || doc.id || "", nomeArquivo: doc.data.nomeArquivo || "", origem: "firestore" }
        };
    }

    return { voltas: [], fonte: { idImportacao: "", nomeArquivo: "", origem: "ausente" } };
}

async function dashboardLimparLinhasFantasmaVoltaAVolta(resultadoDocRef) {
    const snap = await resultadoDocRef.collection("pilotos_resultado").get();
    const fantasmas = snap.docs.filter(doc => linhaResultadoEhFantasmaVoltaAVolta(doc.data() || {}));
    if (!fantasmas.length) return 0;

    const batch = firestore.batch();
    fantasmas.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    return fantasmas.length;
}

async function persistirEstruturaNormalizadaEtapa(resultadoDocRef, corrida, classificacao, voltas) {
    const collections = ["pilotos_resultado_v2", "classificacao_v2", "voltas_processadas_v2"];
    const old = await Promise.all(collections.map(name => resultadoDocRef.collection(name).get()));
    const ops = old.flatMap(snapshot => snapshot.docs.map(doc => ({ tipo: "delete", ref: doc.ref })));
    const add = (collection, row) => {
        const pilotUid = FirestoreIntegrity.requireFirestoreId(getPilotUid(row), "pilot_uid", { collection });
        ops.push({ tipo: "set", ref: resultadoDocRef.collection(collection).doc(pilotUid), payload: toFirestoreSafe({ ...row, pilot_uid: pilotUid, driver_id: getDriverId(row) || null, normalizationVersion: NORMALIZATION_VERSION }) });
    };
    (corrida || []).forEach(row => add("pilotos_resultado_v2", row));
    (classificacao || []).forEach(row => add("classificacao_v2", row));
    const byPilot = new Map();
    (voltas || []).forEach(lap => {
        const pilotUid = FirestoreIntegrity.requireFirestoreId(getPilotUid(lap), "pilot_uid", { collection: "voltas_processadas_v2" });
        if (!byPilot.has(pilotUid)) byPilot.set(pilotUid, []);
        byPilot.get(pilotUid).push(lap);
    });
    byPilot.forEach((laps, pilotUid) => ops.push({ tipo: "set", ref: resultadoDocRef.collection("voltas_processadas_v2").doc(pilotUid), payload: toFirestoreSafe({ pilot_uid: pilotUid, driver_id: getDriverId(laps[0]) || null, laps, normalizationVersion: NORMALIZATION_VERSION }) }));
    await executarBatchFirestore(ops);
}

async function recalcularPersistirResumoEtapaDashboard({ campeonato, etapa, dataCorrida, conteudoVoltaAtual = "", nomeArquivoVoltaAtual = "", idImportacaoVoltaAtual = "", atualizarGeral = true }) {
    const { campeonatoDocId, campRef } = await prepararDocumentoCampeonato(campeonato);
    const resultadoDocId = FirestoreIntegrity.requireFirestoreId(getResultadoFinalDocId(etapa, dataCorrida), "etapaId", { campeonato, etapa, dataCorrida });
    const resultadoDocRef = campRef.collection("resultado_final").doc(resultadoDocId);
    await dashboardLimparLinhasFantasmaVoltaAVolta(resultadoDocRef);
    const [resultadoSnap, corridaSnap, classificacaoSnap, vinculosVoltaSnap] = await Promise.all([
        resultadoDocRef.get(),
        resultadoDocRef.collection("pilotos_resultado").get(),
        resultadoDocRef.collection("classificacao").get(),
        resultadoDocRef.collection("volta_a_volta_pilotos").get()
    ]);

    const meta = {
        ...(resultadoSnap.exists ? resultadoSnap.data() || {} : {}),
        campeonato,
        campeonato_id: campeonatoDocId,
        etapa: Number(etapa),
        dataCorrida,
        resultadoDocId
    };
    const pilotosCadastrados = await buscarPilotosDoCampeonatoRankingFirestore(campeonato);
    const latestResultId = String(meta.resultadoFinalResumo?.idImportacao || "");
    const latestQualifyingId = String(meta.classificacaoResumo?.idImportacao || "");
    const somenteImportacao = (docs, importId) => docs.map(doc => ({ docId: doc.id, ...(doc.data() || {}) }))
        .filter(row => !importId || String(row.idImportacao || "") === importId);
    const corridaCollection = somenteImportacao(corridaSnap.docs, latestResultId);
    const classificacaoCollection = somenteImportacao(classificacaoSnap.docs, latestQualifyingId);
    // Usa literalmente a origem que hidrata "Resultado da Etapa". Analytics
    // antigos podem ter apenas parte dos oficiais na subcollection, enquanto
    // dashboardResumo.corrida preserva o resultado completo exibido (11 x 6).
    const registry = await carregarIdentidadesPilotos();
    const corridaFallback = corridaCollection.length ? corridaCollection : (meta.resultadoFinalResumo?.pilotosSelecionados || []);
    const classificacaoFallback = classificacaoCollection.length ? classificacaoCollection : (meta.classificacaoResumo?.pilotosSelecionados || []);
    // A importação ativa da própria etapa é canônica; dashboardResumo é apenas
    // fallback legado e nunca pode substituir um Resultado Final mais novo.
    const corridaRaw = corridaFallback.length ? corridaFallback : DriverIdentity.getStageReferenceRows(meta, [], classificacaoFallback);
    const corridaResolvida = await resolverPersistirIdentidades(corridaRaw, registry, { campeonato_id: campeonatoDocId, etapa_id: resultadoDocId, fase: "resultado_final" });
    const officialFromResult = DriverIdentity.getOfficialStageDriverIds(corridaResolvida.rows, pilotosCadastrados.pilotos);
    const corridaOrdenada = StageIntegrity.buildChampionshipResult(corridaResolvida.rows, officialFromResult.uids);
    const corrida = StageIntegrity.applyChampionshipScoring(corridaOrdenada, PONTOS_PADRAO).map(row => ({
        ...row, posicao_geral_arquivo: row.positionOverall
    }));
    StageIntegrity.validateScoringBeforePersist(corrida, PONTOS_PADRAO);
    const classificacaoResolvida = await resolverPersistirIdentidades(classificacaoFallback, corridaResolvida.identities, { campeonato_id: campeonatoDocId, etapa_id: resultadoDocId, fase: "classificacao" });
    const oficiaisEtapa = DriverIdentity.getOfficialStageDriverIds(corrida, pilotosCadastrados.pilotos);
    const pilotosCampeonato = {
        pilotos: oficiaisEtapa.drivers,
        ids: oficiaisEtapa.ids,
        uids: oficiaisEtapa.uids,
        nomesLegados: oficiaisEtapa.legacyNames,
        nomes: oficiaisEtapa.legacyNames
    };
    const classificacao = DriverIdentity.filterStageQualifying(classificacaoResolvida.rows, oficiaisEtapa);
    const classificacaoUids = new Set(classificacao.map(getPilotUid));
    oficiaisEtapa.uids.forEach(pilotUid => {
        if (!classificacaoUids.has(pilotUid)) console.warn("[Kart] piloto oficial ausente na classificação", { campeonatoId: campeonatoDocId, etapaId: resultadoDocId, pilot_uid: pilotUid });
    });
    const voltaInfo = await dashboardBuscarVoltasEtapaParaPersistir(campRef, meta, conteudoVoltaAtual, nomeArquivoVoltaAtual, idImportacaoVoltaAtual);
    const sourceMeta = (summary, fallback = {}) => summary?.idImportacao ? summary : fallback;
    const sources = {
        resultadoFinal: sourceMeta(meta.resultadoFinalResumo),
        classificacao: sourceMeta(meta.classificacaoResumo),
        voltaAVolta: voltaInfo.fonte?.idImportacao ? voltaInfo.fonte : null
    };
    Object.values(sources).filter(Boolean).forEach(source => Object.assign(source, {
        campeonato_id: source.campeonato_id || campeonatoDocId,
        etapa: source.etapa || Number(etapa), dataCorrida: source.dataCorrida || dataCorrida
    }));
    const stageKey = StageIntegrity.validateStageSources({ campeonatoId: campeonatoDocId, etapa, dataCorrida }, sources);
    const vinculosVolta = vinculosVoltaSnap.docs.map(doc => ({ docId: doc.id, ...(doc.data() || {}) }));
    const voltasPreCanonicas = dashboardCanonicalizarVoltasEtapa(
        voltaInfo.voltas || [],
        corrida,
        classificacao,
        pilotosCampeonato,
        vinculosVolta
    );
    const voltasResolvidas = await resolverPersistirIdentidades(voltasPreCanonicas, classificacaoResolvida.identities, { campeonato_id: campeonatoDocId, etapa_id: resultadoDocId, fase: "volta_a_volta" });
    const voltasCanonicas = voltasResolvidas.rows.map(row => ({ ...row, isChampionship: oficiaisEtapa.uids.has(getPilotUid(row)) }));
    // Preserve the complete race. Championship membership is persisted as a
    // flag and filtering is exclusively a presentation concern.
    const etapaObj = { docId: resultadoDocId, ref: resultadoDocRef, meta, corrida, classificacao, voltas: voltasCanonicas, officialPilotUids: oficiaisEtapa.uids };
    const stat = dashboardEstatisticasEtapa(etapaObj);
    const resumo = dashboardSerializarEstatisticasEtapa(stat, {
        resultado_final: meta.resultadoFinalResumo?.idImportacao || "",
        classificacao: meta.classificacaoResumo?.idImportacao || "",
        volta_a_volta: voltaInfo.fonte
    });

    await resultadoDocRef.set(toFirestoreSafe({
        campeonato,
        campeonato_id: campeonatoDocId,
        etapa: Number(etapa),
        dataCorrida,
        resultadoDocId,
        stageKey,
        normalizationVersion: NORMALIZATION_VERSION,
        analyticsVersion: KartAnalytics.VERSION,
        processedAtISO: new Date().toISOString(),
        officialPilotUids: [...oficiaisEtapa.uids],
        officialDriverIds: [...oficiaisEtapa.ids],
        stageSummary: {
            campeonato_id: campeonatoDocId, etapa_id: resultadoDocId, dataCorrida,
            officialPilotsCount: oficiaisEtapa.uids.size,
            resultAvailable: corrida.length > 0,
            qualifyingAvailable: classificacao.length > 0,
            lapByLapAvailable: voltasCanonicas.length > 0,
            analyticsAvailable: true,
            normalizationVersion: NORMALIZATION_VERSION,
            analyticsVersion: KartAnalytics.VERSION,
            processedAtISO: new Date().toISOString()
        },
        dashboardOculto: false,
        ultimoVoltaAVoltaImportado: voltaInfo.fonte?.idImportacao || meta.ultimoVoltaAVoltaImportado || "",
        atualizadoEmISO: new Date().toISOString()
    }), { merge: true });

    await persistirEstruturaNormalizadaEtapa(resultadoDocRef, corrida, classificacao, voltasCanonicas);

    const persistedAnalytics = await persistirAnalyticsEtapa(resultadoDocRef, voltasCanonicas, pilotosCampeonato, voltaInfo.fonte, stat, { ...meta, stageKey, classificationAll: classificacaoResolvida.rows });
    // O resumo exibido pela etapa é gravado somente depois de start analytics e
    // Stage Highlights. As demais métricas permanecem exatamente como foram
    // calculadas por dashboardEstatisticasEtapa.
    if (persistedAnalytics?.stageHighlights) {
        const overtakeRows = (persistedAnalytics.pilotAnalytics || []).map(item => ({
            piloto: dashboardPilotoMetricaPersistivel(item),
            total: Number(item.overtakes?.madeOverall || 0)
        }));
        const overtakeWinner = persistedAnalytics.stageHighlights.overtakes;
        resumo.metricas.ultrapassagens = overtakeRows;
        resumo.metricas.topUltrapassagens = overtakeWinner ? {
            piloto: dashboardPilotoMetricaPersistivel(overtakeWinner),
            total: Number(overtakeWinner.overtakes?.madeOverall || 0)
        } : null;
        const winner = persistedAnalytics.stageHighlights.start;
        resumo.metricas.melhorLargada = winner ? {
            piloto: dashboardPilotoMetricaPersistivel(winner),
            ganho: winner.start.deltaOverall,
            grid: winner.start.gridPositionOverall,
            posVolta1: winner.start.firstLapPositionOverall
        } : null;
    }
    await resultadoDocRef.set(toFirestoreSafe({
        dashboardResumo: resumo,
        dashboardResumoVersao: DASHBOARD_RESUMO_VERSION,
        dashboardResumoAtualizadoEmISO: new Date().toISOString()
    }), { merge: true });

    if (atualizarGeral) await recalcularPersistirResumoGeralDashboard(campeonatoDocId, campeonato);
    limparCacheDashboardCampeonato(campeonatoDocId);
    return resumo;
}

function montarAnalyticsPilotosEtapa(analytics, pilotosLista, stat, meta) {
    const identityKey = row => getPilotUid(row) || getDriverId(row);
    const byId = rows => new Map((rows || []).map(row => [identityKey(row), row]).filter(([id]) => id));
    const resultados = byId(stat?.corrida), classificacao = byId(stat?.classificacao);
    const regularidade = byId(analytics.regularidade);
    const ultrapassagensCamp = byId(analytics.ultrapassagensCampeonato);
    const ultrapassagensGeral = byId(analytics.ultrapassagensGeral);
    const firstLapChanges = byId(analytics.firstLapChanges);
    const primeiro = analytics.firstLapSnapshot?.positions || [];
    const primeiroCamp = KartAnalytics.filtrarSnapshot({ positions: primeiro }, new Set(pilotosLista.map(identityKey)), "campeonato");
    const rankBest = [...(analytics.regularidade || [])].filter(p => Number.isFinite(Number(p.bestLapValid))).sort((a, b) => Number(a.bestLapValid) - Number(b.bestLapValid));
    const agora = new Date().toISOString();
    const lapsLedOverall = new Map(), lapsLedChampionship = new Map();
    (analytics.snapshots || []).filter(snapshot => snapshot.snapshotType !== "grid").forEach(snapshot => {
        (snapshot.positions || []).forEach(p => {
            const key = identityKey(p);
            if (p.positionOverall === 1) lapsLedOverall.set(key, (lapsLedOverall.get(key) || 0) + 1);
            if (p.positionChampionship === 1) lapsLedChampionship.set(key, (lapsLedChampionship.get(key) || 0) + 1);
        });
    });
    return pilotosLista.map((driver, officialIndex) => {
        const id = identityKey(driver), result = resultados.get(id) || {}, quali = classificacao.get(id) || {};
        const pace = regularidade.get(id) || {}, overCamp = ultrapassagensCamp.get(id) || {}, overAll = ultrapassagensGeral.get(id) || {}, firstLap = firstLapChanges.get(id) || {};
        const firstOverallIndex = primeiro.findIndex(p => identityKey(p) === id), firstCampIndex = primeiroCamp.findIndex(p => identityKey(p) === id);
        const start = analytics.startAnalytics?.get(id) || {
            gridPositionOverall: null, firstLapPositionOverall: null, deltaOverall: null,
            gridPositionChampionship: null, firstLapPositionChampionship: null, deltaChampionship: null
        };
        const resultPosition = officialIndex + 1;
        const resultOverall = Number(result.posicao_geral_arquivo || result.posicao_final || 0) || null;
        const qualifyingOverall = Number(quali.posicao_geral_arquivo || quali.posicao_final || quali.posicao || 0) || null;
        const qualifyingPositionCalculated = [...pilotosLista].sort((a, b) => {
            const qa = classificacao.get(identityKey(a)) || {}, qb = classificacao.get(identityKey(b)) || {};
            return Number(qa.posicao_geral_arquivo || qa.posicao_final || Infinity) - Number(qb.posicao_geral_arquivo || qb.posicao_final || Infinity);
        }).findIndex(p => identityKey(p) === id) + 1 || null;
        const qualifyingPosition = qualifyingOverall === null ? null : qualifyingPositionCalculated;
        const bestOverallIndex = rankBest.findIndex(p => identityKey(p) === id);
        const fastest = bestOverallIndex === 0;
        const pole = qualifyingOverall === 1, win = resultOverall === 1;
        const gridOverall = qualifyingOverall;
        const firstOverall = firstOverallIndex >= 0 ? Number(primeiro[firstOverallIndex].positionOverall || firstOverallIndex + 1) : null;
        const firstChampionship = firstCampIndex >= 0 ? Number(primeiroCamp[firstCampIndex].positionChampionship || firstCampIndex + 1) : null;
        return toFirestoreSafe({
            analyticsVersion: KartAnalytics.VERSION, processedAt: agora,
            normalizationVersion: NORMALIZATION_VERSION, processedAtISO: agora,
            pilot_uid: getPilotUid(driver), driver_id: getDriverId(driver) || null, driver_name_original: DriverIdentity.getDriverName(driver),
            driver_name_display: DriverIdentity.getDriverDisplayName(driver), kart_numero: DriverIdentity.normalizeKartNumber(driver.kart_numero || driver.kart),
            campeonato_id: meta?.campeonato_id || "", campeonato: meta?.campeonato || "", etapa_id: meta?.resultadoDocId || "", etapa: Number(meta?.etapa || 0), dataCorrida: meta?.dataCorrida || "",
            result: { positionOverall: resultOverall, positionChampionship: resultPosition, points: Number(result.pontos || 0) + Number(result.melhor_tempo_ponto || 0) },
            qualifying: { positionOverall: qualifyingOverall, positionChampionship: qualifyingPosition, bestLap: quali.melhor_tempo ?? null, positionSource: qualifyingOverall === null ? null : "classificacao" },
            finish: { deltaOverall: qualifyingOverall && resultOverall ? qualifyingOverall - resultOverall : null, deltaChampionship: qualifyingPosition && resultPosition ? qualifyingPosition - resultPosition : null },
            scoring: { total: Number(result.pontos || 0) + Number(result.melhor_tempo_ponto || 0) },
            start,
            firstLapOvertakes: { madeOverall: Number(firstLap.madeOverall || 0), takenOverall: Number(firstLap.takenOverall || 0), balanceOverall: Number(firstLap.balanceOverall || 0) },
            pace: { bestLap: pace.bestLapValid ?? null, pace: pace.pace ?? null, regularity: pace.regularidade ?? null, cleanLaps: Number(pace.cleanLapsCount || 0), totalLaps: Number(pace.totalLaps || 0), status: pace.status || "voltas_insuficientes" },
            overtakes: { madeOverall: Number(overAll.feitas || 0), takenOverall: Number(overAll.tomadas || 0), balanceOverall: Number(overAll.saldo || 0), madeChampionship: Number(overCamp.feitas || 0), takenChampionship: Number(overCamp.tomadas || 0), balanceChampionship: Number(overCamp.saldo || 0) },
            bestLap: { time: pace.bestLapValid ?? null, rankOverall: bestOverallIndex >= 0 ? bestOverallIndex + 1 : null, rankChampionship: bestOverallIndex >= 0 ? rankBest.filter((p, i) => i <= bestOverallIndex && pilotosLista.some(d => identityKey(d) === identityKey(p))).length : null },
            race: { bestLap: pace.bestLapValid ?? null, bestLapRankOverall: bestOverallIndex >= 0 ? bestOverallIndex + 1 : null },
            leadership: { lapsLedOverall: lapsLedOverall.get(id) || 0, lapsLedChampionship: lapsLedChampionship.get(id) || 0, relevantLapsOverall: (analytics.snapshots || []).filter(snapshot => snapshot.snapshotType !== "grid").length },
            achievements: { pole, win, podium: resultPosition <= 3, fastestLap: fastest, hatTrick: pole && win && fastest, grandChelem: pole && win && fastest && (lapsLedOverall.get(id) || 0) === (analytics.snapshots || []).filter(snapshot => snapshot.snapshotType !== "grid").length && (analytics.snapshots || []).some(snapshot => snapshot.snapshotType !== "grid") }
        });
    });
}

function validarInvariantesGridEtapa(analytics, pilotAnalytics) {
    const rows = snapshot => snapshot?.positions || snapshot?.drivers || [];
    const byUid = list => new Map(rows(list).map(row => [getPilotUid(row), row]).filter(([uid]) => uid));
    const grid = byUid(analytics.gridSnapshot);
    const lap1 = byUid(analytics.firstLapSnapshot);
    (pilotAnalytics || []).forEach(pilot => {
        const uid = getPilotUid(pilot), gridRow = grid.get(uid), lap1Row = lap1.get(uid);
        const checks = [
            [pilot.start?.gridPositionOverall, pilot.qualifying?.positionOverall, "start.gridPositionOverall != qualifying.positionOverall"],
            [pilot.start?.gridPositionChampionship, pilot.qualifying?.positionChampionship, "start.gridPositionChampionship != qualifying.positionChampionship"],
            [gridRow?.positionOverall ?? null, pilot.qualifying?.positionOverall, "gridSnapshot.positionOverall != qualifying.positionOverall"],
            [gridRow?.positionChampionship ?? null, pilot.qualifying?.positionChampionship, "gridSnapshot.positionChampionship != qualifying.positionChampionship"],
            [pilot.start?.firstLapPositionOverall, lap1Row?.positionOverall ?? null, "start.firstLapPositionOverall != lap1Snapshot.positionOverall"],
            [pilot.start?.firstLapPositionChampionship, lap1Row?.positionChampionship ?? null, "start.firstLapPositionChampionship != lap1Snapshot.positionChampionship"]
        ];
        checks.forEach(([actual, expected, message]) => {
            if ((actual ?? null) !== (expected ?? null)) throw new Error(`[Kart/GridInvariant] ${message}: ${uid} (${actual} != ${expected})`);
        });
        const expectedDelta = gridRow && lap1Row ? gridRow.positionOverall - lap1Row.positionOverall : null;
        if ((pilot.start?.deltaOverall ?? null) !== expectedDelta) throw new Error(`[Kart/GridInvariant] delta inválido: ${uid}`);
    });
}

async function persistirAnalyticsEtapa(resultadoDocRef, voltas, pilotosCampeonato, fonte = {}, stat = null, meta = {}) {
    const analyticsRef = resultadoDocRef.collection("analytics").doc("volta_a_volta_v1");
    const pilotosLista = Array.isArray(pilotosCampeonato) ? pilotosCampeonato : (pilotosCampeonato?.pilotos || []);
    pilotosLista.forEach(driver => FirestoreIntegrity.requireFirestoreId(getPilotUid(driver), "pilot_uid", { campeonatoId: meta?.campeonato_id, etapaId: meta?.resultadoDocId, driver: DriverIdentity.getDriverName(driver) }));
    // Todo o cálculo e a validação acontecem antes de qualquer exclusão.
    const analytics = KartAnalytics.processarVoltasEtapa(voltas || [], pilotosLista, meta?.classificationAll || stat?.classificacao || []);
    const overtakeInvariant = KartAnalytics.assertOvertakeInvariant(analytics.ultrapassagensGeral, `etapa ${meta?.etapa || meta?.resultadoDocId || "-"}`);
    const firstLapInvariant = KartAnalytics.assertOvertakeInvariant(analytics.firstLapChanges, `primeira volta da etapa ${meta?.etapa || meta?.resultadoDocId || "-"}`);
    const pilotAnalytics = montarAnalyticsPilotosEtapa(analytics, pilotosLista, stat, meta);
    pilotAnalytics.forEach(p => {
        const canonical = analytics.raceOvertakes?.get(p.pilot_uid);
        console.group("[Kart/Overtakes/Pilot]");
        console.log({
            name: p.driver_name_display, pilot_uid: p.pilot_uid,
            start: { grid: p.start?.gridPositionOverall, lap1: p.start?.firstLapPositionOverall, delta: p.start?.deltaOverall },
            firstLap: { made: p.firstLapOvertakes?.madeOverall, taken: p.firstLapOvertakes?.takenOverall, balance: p.firstLapOvertakes?.balanceOverall },
            race: { made: p.overtakes?.madeOverall, taken: p.overtakes?.takenOverall, balance: p.overtakes?.balanceOverall }
        });
        console.table(canonical?.transitionBreakdown || []);
        console.groupEnd();
    });
    const gridDiagnostic = new Map((analytics.gridSnapshot?.positions || []).map(row => [getPilotUid(row), row]));
    const lap1Diagnostic = new Map((analytics.firstLapSnapshot?.positions || []).map(row => [getPilotUid(row), row]));
    console.table(pilotAnalytics.map(p => ({
        nome: p.driver_name_display,
        qualifyingOverall: p.qualifying.positionOverall,
        qualifyingChamp: p.qualifying.positionChampionship,
        gridSnapshotOverall: gridDiagnostic.get(p.pilot_uid)?.positionOverall ?? null,
        lap1Overall: lap1Diagnostic.get(p.pilot_uid)?.positionOverall ?? null,
        startGrid: p.start.gridPositionOverall,
        startLap1: p.start.firstLapPositionOverall,
        delta: p.start.deltaOverall,
        made: p.firstLapOvertakes?.madeOverall,
        taken: p.firstLapOvertakes?.takenOverall
    })));
    pilotAnalytics.filter(p => /(?:^|\s)(?:leo|l[eé]o|leonardo)(?:\s|$)/i.test(p.driver_name_display || "")).forEach(p => console.log("[Kart/GridDiagnostic]", {
        pilot_uid: p.pilot_uid,
        nome: p.driver_name_display,
        qualifyingPositionOverall: p.qualifying.positionOverall,
        qualifyingPositionChampionship: p.qualifying.positionChampionship,
        resultGridField: (stat?.corrida || []).find(row => getPilotUid(row) === p.pilot_uid)?.posicao_largada ?? null,
        firstLapPositionOverall: p.start.firstLapPositionOverall,
        currentStartGridPositionOverall: p.start.gridPositionOverall,
        currentStartDeltaOverall: p.start.deltaOverall
    }));
    validarInvariantesGridEtapa(analytics, pilotAnalytics);
    const officialPilotUids = new Set(pilotosLista.map(getPilotUid).filter(Boolean));
    const stageHighlights = KartAnalytics.buildStageHighlights(pilotAnalytics, officialPilotUids);
    const normalizedAnalytics = pilotAnalytics.map(KartAnalytics.normalizePilotAnalyticsForHighlights);
    const officialAnalytics = KartAnalytics.getOfficialHighlightCandidates({ analytics: normalizedAnalytics, officialPilotUids });
    const analyticsUids = new Set(normalizedAnalytics.map(p => p.pilot_uid).filter(Boolean));
    const expectedBestStart = Math.max(...officialAnalytics.map(p => p.start?.deltaOverall).filter(Number.isFinite).filter(value => value > 0), -Infinity);
    if (Number.isFinite(expectedBestStart) && !stageHighlights.start) {
        console.error("[Kart/BestStart] Destaque inconsistente", { etapa: meta?.etapa, expectedBestStart, analytics: officialAnalytics });
        throw new Error(`[Kart/BestStart] etapa ${meta?.etapa || "-"} possui ganho oficial sem destaque`);
    }
    const bestStart = stageHighlights.start ? {
        pilot_uid: stageHighlights.start.pilot_uid,
        driver_name_display: stageHighlights.start.driver_name_display,
        value: stageHighlights.start.start.deltaOverall,
        etapa: Number(meta?.etapa || 0),
        gridPositionOverall: stageHighlights.start.start.gridPositionOverall,
        firstLapPositionOverall: stageHighlights.start.start.firstLapPositionOverall,
        metric: "start.deltaOverall"
    } : null;
    const persistedStageHighlights = { ...stageHighlights, bestStart };
    console.group(`[Kart/Highlights Diagnostic] Etapa ${meta?.etapa || "-"}`);
    console.log("officialPilotUids", [...officialPilotUids]);
    console.log({
        officialCount: officialPilotUids.size,
        analyticsCount: normalizedAnalytics.length,
        matchedCount: officialAnalytics.length,
        missingAnalytics: [...officialPilotUids].filter(uid => !analyticsUids.has(uid)),
        extraAnalytics: [...analyticsUids].filter(uid => !officialPilotUids.has(uid)),
        overtakeInvariant,
        firstLapInvariant
    });
    const positiveDeltaByPilot = new Map();
    (analytics.snapshots || []).forEach(snapshot => (snapshot.positions || []).forEach(row => {
        const uid = getPilotUid(row);
        positiveDeltaByPilot.set(uid, Number(positiveDeltaByPilot.get(uid) || 0) + Math.max(0, Number(row.positionDeltaOverall || 0)));
    }));
    console.table(normalizedAnalytics.map(p => ({
        name: p.name, pilot_uid: p.pilot_uid, stage: meta?.etapa || "-",
        firstLapMade: p.firstLapOvertakes.madeOverall,
        totalMade: p.overtakes.madeOverall,
        totalTaken: p.overtakes.takenOverall,
        balance: p.overtakes.balanceOverall,
        sumPositivePositionDelta: positiveDeltaByPilot.get(p.pilot_uid) || 0
    })));
    console.table(officialAnalytics.map(p => ({
        Nome: p.name,
        pilot_uid: p.pilot_uid,
        Official: true,
        "Grid Overall": p.start?.gridPositionOverall ?? null,
        "First Lap Overall": p.start?.firstLapPositionOverall ?? null,
        "Delta Overall": p.start?.deltaOverall ?? null,
        "First Lap Made": p.firstLapOvertakes?.madeOverall ?? null,
        "First Lap Taken": p.firstLapOvertakes?.takenOverall ?? null,
        "Overtakes Made Overall": p.overtakes?.madeOverall ?? null,
        "Laps Led Overall": p.leadership?.lapsLedOverall ?? null,
        Regularity: p.pace?.regularity ?? null,
        "Best Lap": p.race?.bestLap ?? null,
        "Qualifying Overall": p.qualifying?.positionOverall ?? null,
        "Qualifying Championship": p.qualifying?.positionChampionship ?? null
    })));
    officialAnalytics.forEach(p => {
        if (Number(p.firstLapOvertakes?.madeOverall) > 0 && (p.start?.gridPositionOverall === null || p.start?.firstLapPositionOverall === null)) {
            console.warn("[Kart/BestStart] ultrapassagem sem snapshot comparável", { pilot_uid: p.pilot_uid, start: p.start, firstLapOvertakes: p.firstLapOvertakes });
        }
        console.debug("[Kart/BestStart/Stage]", {
            pilot_uid: p.pilot_uid, gridPositionOverall: p.start?.gridPositionOverall,
            firstLapPositionOverall: p.start?.firstLapPositionOverall, deltaOverall: p.start?.deltaOverall,
            gridPositionChampionship: p.start?.gridPositionChampionship,
            firstLapPositionChampionship: p.start?.firstLapPositionChampionship,
            deltaChampionship: p.start?.deltaChampionship, stageHighlightBestStart: bestStart
        });
    });
    console.log("Winner:", bestStart);
    console.groupEnd();
    const [participantesAntigos, voltasAntigas, pilotosAnalyticsAntigos] = await Promise.all([
        resultadoDocRef.collection("participantes_etapa").get(),
        resultadoDocRef.collection("voltas_processadas").get(),
        resultadoDocRef.collection("pilot_analytics").get()
    ]);
    const limpeza = [
        ...participantesAntigos.docs.map(doc => ({ tipo: "delete", ref: doc.ref })),
        ...voltasAntigas.docs.map(doc => ({ tipo: "delete", ref: doc.ref })),
        ...pilotosAnalyticsAntigos.docs.map(doc => ({ tipo: "delete", ref: doc.ref }))
    ];
    if (!voltas?.length) {
        const ops = [...limpeza, { tipo: "set", ref: analyticsRef, payload: { analyticsVersion: KartAnalytics.VERSION, available: false, fonte: fonte || {}, processedAt: new Date().toISOString() } }];
        pilotAnalytics.forEach(item => ops.push({ tipo: "set", ref: resultadoDocRef.collection("pilot_analytics").doc(FirestoreIntegrity.requireFirestoreId(item.pilot_uid, "pilot_uid", { etapaId: meta?.resultadoDocId })), payload: item }));
        await executarBatchFirestore(ops);
        return null;
    }
    const idsOficiais = pilotosLista.map(getPilotUid).filter(Boolean);
    const participantes = new Map();
    voltas.forEach(v => {
        const id = getPilotUid(v);
        if (!participantes.has(id)) participantes.set(id, { pilot_uid: id, driver_id: getDriverId(v) || null, driver_name: v.driver_name || id, kart_numero: v.kart_numero || "", isChampionship: idsOficiais.includes(id) });
    });
    const resolvedIds = new Set(voltas.map(getPilotUid).filter(id => idsOficiais.includes(id)));
    const analyticsValidation = {
        resultDrivers: idsOficiais.length,
        resolvedChampionshipDrivers: resolvedIds.size,
        regularityDrivers: analytics.regularidade.filter(p => idsOficiais.includes(getPilotUid(p))).length,
        overtakeDrivers: analytics.ultrapassagensCampeonato.length,
        pilotAnalyticsDrivers: pilotosLista.length,
        snapshots: analytics.snapshots.map(snapshot => ({ lap: snapshot.lap || snapshot.numeroVolta, count: KartAnalytics.filtrarSnapshot(snapshot, new Set(idsOficiais), "campeonato").length })),
        extras: analytics.snapshots.flatMap(snapshot => (snapshot.positions || []).filter(p => p.isChampionship && !idsOficiais.includes(getDriverId(p))).map(getDriverId)),
        missing: pilotosLista.filter(p => !resolvedIds.has(getPilotUid(p))).map(p => getPilotUid(p)),
        unresolvedDrivers: pilotosLista.filter(p => !resolvedIds.has(getPilotUid(p))).map(p => ({ pilotUid: getPilotUid(p), driverId: getDriverId(p) || null, name: DriverIdentity.getDriverName(p), kartNumber: p.kart_numero || "" }))
    };
    const validation = FirestoreIntegrity.validateStageAnalytics({ officialDrivers: pilotosLista, regularity: analytics.regularidade, qualifying: stat?.classificacao, overtakes: analytics.ultrapassagensCampeonato, pilotAnalytics, snapshots: analytics.snapshots }, getPilotUid);
    analyticsValidation.consistency = validation;
    validation.snapshots.forEach(snapshot => { if (snapshot.missing.length) console.warn("[Kart/Snapshot]", snapshot); });
    const ops = [...limpeza,
        { tipo: "set", ref: analyticsRef, payload: toFirestoreSafe({ ...analytics, startAnalytics: Object.fromEntries(analytics.startAnalytics || []), analyticsValidation, stageHighlights: persistedStageHighlights, available: true, fonte: fonte || {}, processedAt: new Date().toISOString() }) },
        { tipo: "set", ref: resultadoDocRef, payload: toFirestoreSafe({ stageHighlights: persistedStageHighlights, officialPilotUids: [...officialPilotUids], analyticsVersion: KartAnalytics.VERSION }) }
    ];
    participantes.forEach((p, id) => ops.push({ tipo: "set", ref: resultadoDocRef.collection("participantes_etapa").doc(FirestoreIntegrity.requireFirestoreId(id, "pilot_uid", { etapaId: meta?.resultadoDocId, collection: "participantes_etapa" })), payload: p }));
    const porPiloto = new Map();
    voltas.forEach(v => {
        const id = getPilotUid(v);
        if (!porPiloto.has(id)) porPiloto.set(id, []);
        porPiloto.get(id).push(v);
    });
    porPiloto.forEach((laps, id) => ops.push({ tipo: "set", ref: resultadoDocRef.collection("voltas_processadas").doc(FirestoreIntegrity.requireFirestoreId(id, "pilot_uid", { etapaId: meta?.resultadoDocId, collection: "voltas_processadas" })), payload: { pilot_uid: id, driver_id: getDriverId(laps[0]) || null, laps } }));
    pilotAnalytics.forEach(item => ops.push({
        tipo: "set", ref: resultadoDocRef.collection("pilot_analytics").doc(FirestoreIntegrity.requireFirestoreId(item.pilot_uid, "pilot_uid", { etapaId: meta?.resultadoDocId, collection: "pilot_analytics" })), payload: item
    }));
    await executarBatchFirestore(ops);
    console.debug("[Kart/PilotAnalytics]", { campeonato: meta?.campeonato_id, etapa: meta?.resultadoDocId, officialCount: officialPilotUids.size, pilotAnalyticsCount: pilotAnalytics.length, pilotSummaryCount: officialPilotUids.size });
    if (officialPilotUids.size !== pilotAnalytics.length) console.warn("[Kart/PilotAnalytics] quantidade inconsistente", { officialCount: officialPilotUids.size, pilotAnalyticsCount: pilotAnalytics.length });
    return { analytics, pilotAnalytics, stageHighlights: persistedStageHighlights };
}

async function persistirPilotSummariesCampeonato(campRef, campeonatoDocId) {
    const stages = await campRef.collection("resultado_final").get();
    const rows = [];
    for (const stage of stages.docs) {
        const snap = await stage.ref.collection("pilot_analytics").get();
        snap.docs.forEach(doc => rows.push(doc.data() || {}));
    }
    const grouped = new Map();
    rows.forEach(row => {
        const uid = getPilotUid(row);
        if (!uid) return;
        if (!grouped.has(uid)) grouped.set(uid, []);
        grouped.get(uid).push(row);
    });
    const old = await campRef.collection("pilot_summaries").get();
    const ops = old.docs.map(doc => ({ tipo: "delete", ref: doc.ref }));
    grouped.forEach((items, uid) => {
        const first = items[0], average = field => {
            const values = items.map(field).map(Number).filter(Number.isFinite);
            return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
        };
        const summary = KartAnalytics.consolidarPilotAnalytics(items).kpis;
        ops.push({ tipo: "set", ref: campRef.collection("pilot_summaries").doc(uid), payload: toFirestoreSafe({
            pilot_uid: uid, driver_id: getDriverId(first) || null, driver_name: first.driver_name_display || first.driver_name_original || uid, driver_name_display: first.driver_name_display || first.driver_name_original || uid,
            campeonato_id: campeonatoDocId, etapasDisputadas: items.length, corridas: items.length,
            // Os escalares em português permanecem para consumidores legados.
            vitorias: summary.wins.championship, podios: summary.podiums.championship,
            poles: summary.poles.championship, pontos: summary.points,
            summary: { races: summary.races, wins: summary.wins, podiums: summary.podiums, poles: summary.poles, points: summary.points, bestPosition: summary.bestPosition },
            melhorVoltas: items.filter(x => x.achievements?.fastestLap).length, regularidadeMedia: average(x => x.pace?.regularity),
            paceRelativoMedio: average(x => x.pace?.pace), ultrapassagensFeitas: items.reduce((s, x) => s + Number(x.overtakes?.madeOverall || 0), 0),
            ultrapassagensTomadas: items.reduce((s, x) => s + Number(x.overtakes?.takenOverall || 0), 0), atualizadoEmISO: new Date().toISOString()
        }) });
    });
    await executarBatchFirestore(ops);
    return grouped.size;
}

async function carregarAnalyticsEtapa(resultadoDocRef) {
    // A etapa ja foi hidratada e a lista oficial ja foi montada a partir da
    // mesma corrida exibida. Aqui consultamos somente analytics, sem tentar
    // redescobrir os participantes em outras collections.
    const snap = await resultadoDocRef.collection("analytics").doc("volta_a_volta_v1").get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    const resultadoRows = DASHBOARD_STAGE_STATE.pilotosCampeonatoEtapa;
    const oficiais = pilotosOficiaisAtuais();
    const marcarOficial = item => ({
        ...(item || {}),
        driver_id: getDriverId(item),
        isChampionship: isChampionshipDriver(item, oficiais)
    });
    const participants = (data.participants || []).map(marcarOficial);
    const regularidade = (data.regularidade || []).map(marcarOficial);
    const snapshots = (data.snapshots || []).map(snapshot => ({
        ...snapshot,
        positions: (snapshot.positions || []).map(marcarOficial)
    }));

    const ultrapassagensCampeonatoBase = data.ultrapassagensCampeonato || KartAnalytics.calcularUltrapassagens(snapshots, true, participants);
    const ultrapassagensGeralBase = data.ultrapassagensGeral || KartAnalytics.calcularUltrapassagens(snapshots, false, participants);

    return {
        ...data,
        participants,
        regularidade,
        snapshots,
        championshipDriverIds: [...oficiais.ids],
        championshipDriverNames: [...oficiais.legacyNames],
        stageResultDrivers: resultadoRows,
        // Revalida a associação na leitura para corrigir analytics antigos sem
        // exigir reprocessamento só por causa da apresentação.
        ultrapassagensCampeonato: DriverIdentity.reconcileStageChampionshipDrivers(
            (ultrapassagensCampeonatoBase || []).map(marcarOficial),
            oficiais,
            driver => ({ ...driver, isChampionship: true, feitas: 0, tomadas: 0, saldo: 0 })
        ),
        ultrapassagensGeral: (ultrapassagensGeralBase || []).map(marcarOficial)
    };
}

async function recalcularPersistirResumoGeralDashboard(campeonatoDocId, campeonatoNome = "") {
    const campRef = firestore.collection(COLLECTION_CAMPEONATOS).doc(campeonatoDocId);
    const snapshot = await campRef.collection("resultado_final").get();
    const stats = snapshot.docs
        .map(doc => {
            const meta = doc.data() || {};
            const resumo = meta.dashboardResumo || null;
            return resumo?.versao ? dashboardHidratarEstatisticasEtapa(meta, resumo, doc.id) : null;
        })
        .filter(Boolean)
        .sort((a, b) => Number(a.etapa.meta.etapa || 0) - Number(b.etapa.meta.etapa || 0) || String(a.etapa.meta.dataCorrida || "").localeCompare(String(b.etapa.meta.dataCorrida || "")));

    const ranking = dashboardRankingDasEtapasPersistidas(stats);
    const geral = dashboardEstatisticasGeral({ etapasStats: stats }, ranking);
    // Championship highlights are rebuilt from stage Pilot Analytics. They do
    // not inherit possibly empty highlights written by an older application.
    const stageAnalytics = [];
    for (const stage of snapshot.docs) {
        const analyticsSnap = await stage.ref.collection("pilot_analytics").get();
        stageAnalytics.push({
            etapa: Number((stage.data() || {}).etapa || 0),
            etapa_id: stage.id,
            stageKey: (stage.data() || {}).stageKey || `${campeonatoDocId}|${Number((stage.data() || {}).etapa || 0)}|${(stage.data() || {}).dataCorrida || ""}`,
            analytics: analyticsSnap.docs.map(doc => ({ ...(doc.data() || {}), _documentId: doc.id }))
        });
    }
    const officialPilotUids = new Set(ranking.map(getPilotUid).filter(Boolean));
    const championshipHighlights = KartAnalytics.buildChampionshipHighlights(stageAnalytics, officialPilotUids);
    if (championshipHighlights.start) console.debug("[Kart/BestStart/ChampionshipSource]", {
        pilot_uid: championshipHighlights.start.pilot_uid,
        nome: championshipHighlights.start.driver_name_display,
        etapa: championshipHighlights.start._stage,
        value: championshipHighlights.start.start.deltaOverall,
        sourceDocument: `resultado_final/${championshipHighlights.start.etapa_id}/pilot_analytics/${championshipHighlights.start.pilot_uid}`,
        sourceField: "start.deltaOverall"
    });
    const allAnalytics = stageAnalytics.flatMap(stage => stage.analytics);
    const normalized = allAnalytics.map(KartAnalytics.normalizePilotAnalyticsForHighlights);
    const matched = KartAnalytics.getOfficialHighlightCandidates({ analytics: normalized, officialPilotUids });
    const analyticsUids = new Set(normalized.map(row => row.pilot_uid).filter(Boolean));
    console.group("[Kart/Highlights Diagnostic] Campeonato Geral");
    console.log("officialPilotUids", [...officialPilotUids]);
    console.log({ officialCount: officialPilotUids.size, analyticsCount: normalized.length, matchedCount: matched.length,
        missingAnalytics: [...officialPilotUids].filter(uid => !analyticsUids.has(uid)),
        extraAnalytics: [...analyticsUids].filter(uid => !officialPilotUids.has(uid)) });
    console.table(normalized.filter(p => /LEONARDO\s+LEMES/i.test(p.name)).map(p => ({
        etapa: p.etapa || "-", pilot_uid: p.pilot_uid, nome: p.name,
        dashboardMade: p.overtakes.madeOverall, dashboardTaken: p.overtakes.takenOverall,
        dashboardBalance: p.overtakes.balanceOverall, highlightMadeSource: p.overtakes.madeOverall,
        firstLapMade: p.firstLapOvertakes.madeOverall, positionDeltaSum: p.start.deltaOverall,
        storedMadeOverall: p.overtakes.madeOverall
    })));
    console.log("Highlights", championshipHighlights);
    console.groupEnd();

    const pilot = row => row || null;
    if (championshipHighlights.bestLap) geral.melhorVoltaAbsoluta = {
        piloto: pilot(championshipHighlights.bestLap), tempo: championshipHighlights.bestLap.race.bestLap,
        etapa: { docId: championshipHighlights.bestLap.etapa_id || "", meta: { etapa: championshipHighlights.bestLap._stage || championshipHighlights.bestLap.etapa || "" } }
    };
    if (championshipHighlights.overtakes) {
        const overtakes = KartAnalytics.getPilotStageOvertakes(championshipHighlights.overtakes);
        geral.topUltrapassagens = { piloto: pilot(championshipHighlights.overtakes), total: overtakes.made, tomadas: overtakes.taken, saldo: overtakes.balance };
    }
    if (championshipHighlights.start) geral.melhorLargada = {
        piloto: pilot(championshipHighlights.start), ganho: championshipHighlights.start.start.deltaOverall,
        grid: championshipHighlights.start.start.gridPositionOverall,
        posVolta1: championshipHighlights.start.start.firstLapPositionOverall,
        etapa: { docId: championshipHighlights.start.etapa_id || "", meta: { etapa: championshipHighlights.start._stage || championshipHighlights.start.etapa || "" } }
    };
    geral.topLideradas = championshipHighlights.leadership ? { piloto: pilot(championshipHighlights.leadership), total: championshipHighlights.leadership.leadership.lapsLedOverall } : null;
    geral.topRegularidade = championshipHighlights.regularity ? { piloto: pilot(championshipHighlights.regularity), media: championshipHighlights.regularity.pace.regularity, valores: championshipHighlights.regularity.regularities || [] } : null;
    geral.topPoles = championshipHighlights.pole ? { piloto: pilot(championshipHighlights.pole), total: championshipHighlights.pole.poleCount || 1 } : null;
    const resumoGeral = dashboardSerializarGeral(geral, ranking, stats);

    const pilotSummaryCount = await persistirPilotSummariesCampeonato(campRef, campeonatoDocId);
    await campRef.set(toFirestoreSafe({
        nome: campeonatoNome || undefined,
        dashboardGeral: resumoGeral,
        dashboardGeralVersao: DASHBOARD_RESUMO_VERSION,
        dashboardGeralAtualizadoEmISO: resumoGeral.atualizadoEmISO,
        championshipSummary: {
            etapas: stats.length,
            pilotos: pilotSummaryCount,
            corridas: stats.length,
            classificacaoGeral: ranking,
            normalizationVersion: NORMALIZATION_VERSION,
            analyticsVersion: KartAnalytics.VERSION,
            processedAtISO: new Date().toISOString()
        },
        atualizadoEmISO: new Date().toISOString()
    }), { merge: true });

    limparCacheDashboardCampeonato(campeonatoDocId);
    return resumoGeral;
}

async function recalcularEPersistirDashboardAposImportacao(args) {
    try {
        return await recalcularPersistirResumoEtapaDashboard(args);
    } catch (e) {
        console.error("Falha ao persistir resumo do dashboard:", e);
        const status = document.getElementById("statusImport");
        if (status) status.innerHTML = `❌ Falha no processamento. Campeonato: ${htmlEscape(args?.campeonato || "-")} · Etapa: ${htmlEscape(args?.etapa || "-")} · Fase: resumos · ${htmlEscape(e.message || e)}`;
        return null;
    }
}

async function limparCadastrosDuplicadosCriadosPorVoltaAVolta(campeonato) {
    const snap = await firestore.collection(COLLECTION_PILOTOS).get();
    const docs = snap.docs.map(doc => ({ id: doc.id, ref: doc.ref, data: doc.data() || {} }));
    let removidos = 0;

    for (const item of docs) {
        const nomeAtual = String(item.data.nome || item.data.driver_name || "").trim();
        const origem = String(item.data.origemCadastro || "").trim();
        const parsed = extrairPilotoHeaderVoltaAVolta(nomeAtual);
        const pareceHeaderVolta = !!parsed.kart_numero && !!parsed.driver_name && normalizarNomeComparacao(parsed.driver_name) !== normalizarNomeComparacao(nomeAtual);

        // Só toca em registros criados automaticamente pelo fluxo de importação
        // e cujo nome ficou claramente no formato "kart - nome - classe".
        if (!pareceHeaderVolta || origem !== "importacao_arquivo") continue;

        const nomeCanonico = normalizarNomeComparacao(parsed.driver_name);
        const candidatos = docs.filter(outro => {
            if (outro.id === item.id) return false;
            const nomeBrutoOutro = String(outro.data.nome || outro.data.driver_name || "").trim();
            const nomeOutro = normalizarNomeComparacao(nomeBrutoOutro);
            if (nomeOutro !== nomeCanonico) return false;

            // O cadastro canônico não precisa obrigatoriamente ter driver_id.
            // Em alguns kartódromos o arquivo não fornece ID algum. O que
            // diferencia o cadastro real do duplicado antigo é o nome normal,
            // sem o prefixo "kart -" e sem o sufixo "- RENTAL".
            const parsedOutro = extrairPilotoHeaderVoltaAVolta(nomeBrutoOutro);
            const outroPareceHeader = !!parsedOutro.kart_numero &&
                !!parsedOutro.driver_name &&
                normalizarNomeComparacao(parsedOutro.driver_name) !== nomeOutro;

            return !outroPareceHeader;
        });

        if (candidatos.length !== 1) continue;
        const canonico = candidatos[0];
        const campsCanonico = extrairCampeonatosDoPilotoExistente(canonico.data);
        const aliases = aliasesCampeonato(campeonato);
        const vinculado = campsCanonico.some(v => aliases.has(v) || aliases.has(normalizarDocId(v)) || aliases.has(normalizarChave(v)));
        if (!vinculado) continue;

        await item.ref.delete();
        removidos += 1;
    }

    if (removidos) await carregarDadosBaseFirestore();
    return removidos;
}

async function reprocessarResumosDashboardCampeonatoAtual() {
    const campeonato = document.getElementById("imp_camp")?.value || "";
    const status = document.getElementById("statusImport");
    if (!campeonato) { alert("Selecione um campeonato antes de reprocessar."); return; }
    if (!await pedirSenhaAdmin()) return;
    const botao = document.getElementById("btnReprocessarResumos");
    if (botao) botao.disabled = true;
    let etapaEmProcessamento = "";

    try {
        if (status) status.innerHTML = "⏳ Limpando vínculos antigos do Volta a volta e reprocessando resumos...";
        const duplicadosRemovidos = await limparCadastrosDuplicadosCriadosPorVoltaAVolta(campeonato);
        const { campeonatoDocId, campRef } = await prepararDocumentoCampeonato(campeonato);
        const etapasSnap = await campRef.collection("resultado_final").get();
        const etapas = etapasSnap.docs.map(doc => ({ ...(doc.data() || {}), docId: doc.id }))
            .map(item => ({ ...item, etapa: FirestoreIntegrity.canonicalStageNumber(item.etapa || item.docId) }))
            .filter(item => item.etapa && item.dataCorrida)
            .sort((a, b) => Number(a.etapa || 0) - Number(b.etapa || 0));

        let etapasReprocessadas = 0;
        let etapasOcultadas = 0;

        for (let i = 0; i < etapas.length; i += 1) {
            const item = etapas[i];
            etapaEmProcessamento = item.etapa;
            if (status) status.innerHTML = `⏳ Reprocessando etapa ${htmlEscape(item.etapa)} (${i + 1}/${etapas.length})...`;

            const etapaId = FirestoreIntegrity.requireFirestoreId(item.docId, "etapaId", { campeonatoId: campeonatoDocId, etapa: item.etapa });
            const resultRef = campRef.collection("resultado_final").doc(etapaId);
            const possuiFonte = await dashboardEtapaPossuiFontePersistida({
                campRef,
                resultRef,
                etapa: item.etapa,
                dataCorrida: item.dataCorrida
            });

            if (!possuiFonte) {
                const del = firestoreDeleteValue();
                await resultRef.set({
                    dashboardResumo: del,
                    dashboardResumoVersao: del,
                    dashboardResumoAtualizadoEmISO: del,
                    dashboardOculto: true,
                    atualizadoEmISO: new Date().toISOString()
                }, { merge: true });
                etapasOcultadas += 1;
                continue;
            }

            await recalcularPersistirResumoEtapaDashboard({
                campeonato,
                etapa: item.etapa,
                dataCorrida: item.dataCorrida,
                atualizarGeral: false
            });
            etapasReprocessadas += 1;
        }

        await recalcularPersistirResumoGeralDashboard(campeonatoDocId, campeonato);
        if (status) status.innerHTML = `✅ Reprocessamento concluído. ${etapasReprocessadas} etapa(s) atualizada(s). ${etapasOcultadas ? `${etapasOcultadas} etapa(s) sem arquivos foram ocultadas. ` : ""}${duplicadosRemovidos ? `${duplicadosRemovidos} cadastro(s) duplicado(s) antigo(s) do Volta a volta foram removidos.` : ""}`;
        await inicializarRankingFirestore();
    } catch (e) {
        console.error(e);
        if (status) status.innerHTML = `❌ Erro ao reprocessar Etapa ${htmlEscape(etapaEmProcessamento || "não identificada")}: ${htmlEscape(e.message || e)}`;
    } finally {
        if (botao) botao.disabled = false;
    }
}
window.reprocessarResumosDashboardCampeonatoAtual = reprocessarResumosDashboardCampeonatoAtual;

// Administrative API. It is deliberately dry-run by default and never touches
// campeonato configuration, Pilotos or pilot_identities.
async function limparDadosImportacaoCampeonato(campeonato, { dryRun = true } = {}) {
    const campeonatoId = FirestoreIntegrity.requireFirestoreId(normalizarDocId(campeonato), "campeonatoId", { fase: "clean_reimport" });
    const campRef = firestore.collection(COLLECTION_CAMPEONATOS).doc(campeonatoId);
    const stageSnap = await campRef.collection("resultado_final").get();
    const lapSnap = await campRef.collection("volta_a_volta").get();
    const backupSnap = await firestore.collection(COLLECTION_BACKUPS).where("campeonato_id", "==", campeonatoId).get();
    const subcollections = ["pilotos_resultado", "classificacao", "volta_a_volta_pilotos", "historias_pilotos", "analytics", "participantes_etapa", "voltas_processadas", "pilot_analytics", "pilotos_resultado_v2", "classificacao_v2", "voltas_processadas_v2"];
    const refs = [...lapSnap.docs.map(doc => doc.ref), ...backupSnap.docs.map(doc => doc.ref)];
    for (const stage of stageSnap.docs) {
        const children = await Promise.all(subcollections.map(name => stage.ref.collection(name).get()));
        children.forEach(snapshot => snapshot.docs.forEach(doc => refs.push(doc.ref)));
        refs.push(stage.ref);
    }
    const report = { campeonato_id: campeonatoId, dryRun, stages: stageSnap.size, lapFiles: lapSnap.size, backups: backupSnap.size, documents: refs.length };
    if (dryRun) return report;
    await executarBatchFirestore(refs.map(ref => ({ tipo: "delete", ref })));
    const del = firestoreDeleteValue();
    await campRef.set({ dashboardGeral: del, dashboardGeralVersao: del, dashboardGeralAtualizadoEmISO: del, championshipSummary: del, atualizadoEmISO: new Date().toISOString() }, { merge: true });
    limparCacheDashboardCampeonato(campeonatoId);
    return report;
}
window.limparDadosImportacaoCampeonato = limparDadosImportacaoCampeonato;

/* V4: consulta apenas resumos persistidos; exclusão também recalcula dashboard e etapas vazias ficam ocultas. */
async function carregarDashboardCampeonato(campeonatoDocId, force = false) {
    if (!force && DASHBOARD_CAMPEONATO_CACHE.has(campeonatoDocId)) return DASHBOARD_CAMPEONATO_CACHE.get(campeonatoDocId);

    const campRef = firestore.collection(COLLECTION_CAMPEONATOS).doc(campeonatoDocId);
    const [campSnap, resultadosSnapshot] = await Promise.all([
        campRef.get(),
        campRef.collection("resultado_final").get()
    ]);
    const campData = campSnap.exists ? campSnap.data() || {} : {};
    const campeonatoNome = campData.nome || campData.nome_exibicao || campeonatoDocId;
    const etapas = resultadosSnapshot.docs
        .map(doc => {
            const meta = doc.data() || {};
            return {
                docId: doc.id,
                meta,
                resumoPersistido: meta.dashboardResumo || null,
                stat: meta.dashboardResumo?.versao ? dashboardHidratarEstatisticasEtapa(meta, meta.dashboardResumo, doc.id) : null
            };
        })
        .filter(item => item.meta.dashboardOculto !== true)
        .sort((a, b) => Number(a.meta.etapa || 0) - Number(b.meta.etapa || 0) || String(a.meta.dataCorrida || "").localeCompare(String(b.meta.dataCorrida || "")));

    const geralPersistido = dashboardHidratarGeral(campData.dashboardGeral || null);
    const payload = {
        campeonatoDocId,
        campeonatoNome,
        campData,
        etapas,
        etapasStats: etapas.map(e => e.stat).filter(Boolean),
        rankingPersistido: geralPersistido?.ranking || [],
        geralPersistido,
        resumoPersistido: !!geralPersistido
    };
    DASHBOARD_CAMPEONATO_CACHE.set(campeonatoDocId, payload);
    return payload;
}

async function renderDashboardCampeonato() {
    const renderToken = ++DASHBOARD_STAGE_RENDER_TOKEN;
    const select = document.getElementById("filtro_rank_firebase_camp");
    const etapaSelect = document.getElementById("filtro_rank_etapa");
    const content = document.getElementById("rankingFirestoreContent");
    const status = document.getElementById("rankingFirestoreStatus");
    if (!select || !content) return;

    const campId = select.value;
    if (!campId) {
        limparPilotosCampeonatoEtapa();
        content.innerHTML = "";
        if (status) status.innerHTML = "Selecione um campeonato para carregar os dados.";
        return;
    }

    try {
        if (status) status.innerHTML = "⏳ Consultando resumos salvos no Firestore...";
        const payload = await carregarDashboardCampeonato(campId);
        if (renderToken !== DASHBOARD_STAGE_RENDER_TOKEN) return;
        await carregarFiltroEtapasDashboard(campId, payload);
        if (renderToken !== DASHBOARD_STAGE_RENDER_TOKEN) return;
        const filtroEtapa = etapaSelect?.value || "geral";
        const ranking = payload.rankingPersistido || [];

        if (filtroEtapa === "geral") {
            limparPilotosCampeonatoEtapa();
            const geral = payload.geralPersistido;
            if (!geral) {
                content.innerHTML = `<div class="form-card"><h3>Resumo ainda não processado</h3><p class="hint">Este campeonato possui dados antigos sem o resumo persistido. Na tela Importar, selecione o campeonato e use <strong>REPROCESSAR RESUMOS DO CAMPEONATO</strong>.</p></div>`;
                if (status) status.innerHTML = "⚠️ Campeonato sem dashboardGeral persistido.";
                return;
            }
            content.innerHTML = `
                ${dashboardHero(payload, ranking)}
                <div class="dashboard-section-title"><h3>⭐ Destaques do Campeonato</h3><span>dados pré-calculados e persistidos</span></div>
                <div class="dashboard-cards">${dashboardCardsGeral(geral)}</div>
                ${dashboardTabelaGeral(ranking, geral)}
                <div class="dashboard-note">A home apenas consulta os resumos salvos no Firestore. Os cálculos são refeitos e persistidos somente ao importar/reprocessar arquivos.</div>
            `;
            if (status) status.innerHTML = `✅ Resumo persistido carregado · ${payload.etapasStats.length} etapa(s) processada(s) · ${ranking.length} piloto(s).`;
            return;
        }

        const etapa = payload.etapas.find(e => e.docId === filtroEtapa);
        const stat = etapa?.stat || null;
        if (!stat) {
            content.innerHTML = `<div class="form-card"><h3>Etapa sem resumo persistido</h3><p class="hint">Reimporte um dos arquivos desta etapa ou use o botão de reprocessamento na tela Importar.</p></div>`;
            if (status) status.innerHTML = "⚠️ Etapa encontrada, mas dashboardResumo ainda não foi gerado.";
            return;
        }

        // Deve ocorrer antes do topo, tabelas e analytics. Assim nenhum
        // componente pode observar IDs vazios ou herdados da etapa anterior.
        obterPilotosOficiaisDaEtapa(campId, etapa.docId, stat.corrida);
        stat.classificacao = filtrarPilotosDoCampeonato(stat.classificacao);

        const faltantes = [];
        if (!stat.completo?.resultado_final) faltantes.push("Resultado final");
        if (!stat.completo?.classificacao) faltantes.push("Classificação");
        if (!stat.completo?.volta_a_volta) faltantes.push("Volta a volta");
        const aviso = faltantes.length ? `<div class="dashboard-note" style="margin-bottom:10px;">⏳ A etapa ainda está incompleta. Falta importar/processar: <strong>${htmlEscape(faltantes.join(", "))}</strong>. Os cards são atualizados automaticamente a cada arquivo salvo.</div>` : "";

        content.innerHTML = `
            ${dashboardHero(payload, ranking, stat)}
            ${aviso}
            <div class="dashboard-section-title"><h3>⭐ Destaques da Etapa</h3><span>dados pré-calculados e persistidos</span></div>
            <div class="dashboard-cards">${dashboardCardsEtapa(stat)}</div>
            ${dashboardTabelaEtapa(stat)}
            <div class="dashboard-note">Esta tela não reprocessa os arquivos. As métricas foram calculadas no momento da importação e estão persistidas em resultado_final/${htmlEscape(etapa.docId)}/dashboardResumo.</div>
            <div id="etapaAnalyticsContent"></div>
        `;
        await renderAnalyticsEtapa(firestore.collection(COLLECTION_CAMPEONATOS).doc(campId).collection("resultado_final").doc(etapa.docId), renderToken);
        if (status) status.innerHTML = `✅ Etapa ${htmlEscape(stat.etapa.meta.etapa || etapa.docId)} · resumo persistido carregado · ${stat.corrida.length} piloto(s).`;
    } catch (e) {
        console.error(e);
        content.innerHTML = "";
        if (status) status.innerHTML = `❌ Erro ao consultar o dashboard: ${htmlEscape(e.message || e)}`;
    }
}

let RACE_PLAY_TIMER = null;
let RACE_SNAPSHOT_INDEX = 0;
let ETAPA_ANALYTICS_ATUAL = null;
let OVERTAKE_MODE = "campeonato";
let RACE_MODE = "campeonato";
let DASHBOARD_STAGE_RENDER_TOKEN = 0;
const DASHBOARD_STAGE_STATE = {
    campeonatoId: "",
    etapaId: "",
    pilotosCampeonatoEtapa: [],
    pilotosCampeonatoIds: new Set(),
    pilotosCampeonatoUids: new Set(),
    pilotosCampeonatoNomesLegados: new Set()
};

function limparPilotosCampeonatoEtapa() {
    DASHBOARD_STAGE_STATE.campeonatoId = "";
    DASHBOARD_STAGE_STATE.etapaId = "";
    DASHBOARD_STAGE_STATE.pilotosCampeonatoEtapa = [];
    DASHBOARD_STAGE_STATE.pilotosCampeonatoIds = new Set();
    DASHBOARD_STAGE_STATE.pilotosCampeonatoUids = new Set();
    DASHBOARD_STAGE_STATE.pilotosCampeonatoNomesLegados = new Set();
    ETAPA_ANALYTICS_ATUAL = null;
}

// Resultado da Etapa (dashboardResumo.corrida) e a unica fonte desta lista.
function obterPilotosOficiaisDaEtapa(campeonatoId, etapaId, resultadoEtapa) {
    const oficiais = DriverIdentity.getStageChampionshipDrivers(resultadoEtapa || []);
    DASHBOARD_STAGE_STATE.campeonatoId = campeonatoId;
    DASHBOARD_STAGE_STATE.etapaId = etapaId;
    DASHBOARD_STAGE_STATE.pilotosCampeonatoEtapa = oficiais.drivers;
    DASHBOARD_STAGE_STATE.pilotosCampeonatoIds = oficiais.ids;
    DASHBOARD_STAGE_STATE.pilotosCampeonatoUids = oficiais.uids;
    DASHBOARD_STAGE_STATE.pilotosCampeonatoNomesLegados = oficiais.legacyNames;
    console.debug("[Kart] pilotos oficiais da etapa:", [...oficiais.ids]);
    return oficiais.drivers;
}

function pilotosOficiaisAtuais() {
    return {
        drivers: DASHBOARD_STAGE_STATE.pilotosCampeonatoEtapa,
        ids: DASHBOARD_STAGE_STATE.pilotosCampeonatoIds,
        uids: DASHBOARD_STAGE_STATE.pilotosCampeonatoUids,
        legacyNames: DASHBOARD_STAGE_STATE.pilotosCampeonatoNomesLegados
    };
}

function filtrarPilotosDoCampeonato(lista) {
    return DriverIdentity.filterStageChampionshipDrivers(lista, pilotosOficiaisAtuais());
}

function validarConsistenciaPilotosEtapa({ regularidade = [], snapshot = [], ultrapassagens = [] } = {}) {
    const oficiais = DASHBOARD_STAGE_STATE.pilotosCampeonatoEtapa;
    const relatorios = { regularidade, evolucao: snapshot, ultrapassagens };
    const diagnostico = { oficiais: DriverIdentity.compareDriverIdSets(oficiais, oficiais) };
    Object.entries(relatorios).forEach(([nome, rows]) => {
        const check = DriverIdentity.compareDriverIdSets(oficiais, rows);
        diagnostico[nome] = check;
        if (check.missing.length || check.extra.length) {
            console.warn("[Kart] inconsistência de pilotos", nome, check);
        }
    });
    return diagnostico;
}

function analyticsHelp(texto) {
    return `<span class="analytics-help" title="${htmlEscape(texto)}" aria-label="${htmlEscape(texto)}">?</span>`;
}
async function renderAnalyticsEtapa(resultadoDocRef, renderToken = DASHBOARD_STAGE_RENDER_TOKEN) {
    const alvo = document.getElementById("etapaAnalyticsContent");
    if (!alvo) return;
    alvo.innerHTML = `<div class="analytics-state">⏳ Consultando análises persistidas...</div>`;
    pauseRaceAnimation();
    try {
        const data = await carregarAnalyticsEtapa(resultadoDocRef);
        if (renderToken !== DASHBOARD_STAGE_RENDER_TOKEN) return;
        if (!data?.available) {
            alvo.innerHTML = `<div class="analytics-state">Dados de Volta a Volta ainda não importados ou processados para esta etapa.</div>`;
            return;
        }
        ETAPA_ANALYTICS_ATUAL = data;
        RACE_SNAPSHOT_INDEX = 0;
        alvo.innerHTML = `
          <section class="analytics-card"><h3>📊 Regularidade dos Pilotos ${analyticsHelp("Indica o quanto os tempos do piloto variam entre as voltas limpas. Quanto menor o valor, maior a regularidade.")}</h3><div id="regularidadeChart" class="bar-chart"></div></section>
          <section class="analytics-card"><h3>🏁 Evolução da Corrida — Volta a Volta ${analyticsHelp("Mostra a evolução das posições ao longo da corrida e a distância entre os pilotos.")}</h3><div class="analytics-toggle race-filter"><button id="raceChamp" onclick="setRaceMode('campeonato')">Pilotos do Campeonato</button><button id="raceAll" onclick="setRaceMode('geral')">Geral da Corrida</button></div><div class="race-controls"><button onclick="voltaAnterior()" aria-label="Volta anterior">‹</button><strong id="raceLapLabel"></strong><button id="racePlay" onclick="playRaceAnimation()">▶ Reproduzir</button><button onclick="proximaVolta()" aria-label="Próxima volta">›</button></div><div id="raceSnapshot" class="race-scroll"></div></section>
          <section class="analytics-card"><h3>🔄 Ultrapassagens por Piloto ${analyticsHelp("Estimativa baseada nas mudanças de posição observadas entre voltas consecutivas.")}</h3><div class="analytics-toggle"><button id="overtakeChamp" onclick="renderUltrapassagensChart('campeonato')">Pilotos do Campeonato</button><button id="overtakeAll" onclick="renderUltrapassagensChart('geral')">Geral da Corrida</button></div><div id="overtakeKpis"></div><div id="overtakeChart" class="bar-chart"></div></section>`;
        RACE_MODE = "campeonato"; renderRegularidadeChart(); renderRaceSnapshot(); renderUltrapassagensChart("campeonato");
        const regularidadeOficial = DriverIdentity.reconcileStageChampionshipDrivers(data.regularidade || [], pilotosOficiaisAtuais(), driver => driver);
        const evolucaoOficial = racePositionsForSnapshot(data.snapshots?.[0], "campeonato");
        validarConsistenciaPilotosEtapa({ regularidade: regularidadeOficial, snapshot: evolucaoOficial, ultrapassagens: data.ultrapassagensCampeonato || [] });
    } catch (e) {
        console.error(e); alvo.innerHTML = `<div class="analytics-state error">Erro ao consultar análises: ${htmlEscape(e.message || e)}</div>`;
    }
}
function renderRegularidadeChart() {
    const alvo = document.getElementById("regularidadeChart");
    const todos = ETAPA_ANALYTICS_ATUAL?.regularidade || [];
    const championshipItems = DriverIdentity.reconcileStageChampionshipDrivers(
        todos,
        pilotosOficiaisAtuais(),
        driver => ({ ...driver, isChampionship: true, status: "insufficient_data", regularidade: null, cleanLaps: 0, totalLaps: 0 })
    );
    const idMatches = todos.filter(item => getDriverId(item) && DASHBOARD_STAGE_STATE.pilotosCampeonatoIds.has(getDriverId(item))).length;
    const nameFallbacks = todos.filter(item => !getDriverId(item) && DriverIdentity.isChampionshipDriver(item, pilotosOficiaisAtuais())).length;
    if (championshipItems.length !== DASHBOARD_STAGE_STATE.pilotosCampeonatoEtapa.length || (!idMatches && todos.length)) {
        console.warn("[Kart] associação da regularidade", { oficiais: DASHBOARD_STAGE_STATE.pilotosCampeonatoEtapa.length, totalAnalytics: todos.length, filtrados: championshipItems.length, matchesPorDriverId: idMatches, fallbacksPorNome: nameFallbacks });
    }
    const items = championshipItems.filter(i => i.status === "ok" && Number.isFinite(Number(i.regularidade))).sort((a,b) => a.regularidade-b.regularidade);
    const insufficient = championshipItems.filter(i => i.status !== "ok" || !Number.isFinite(Number(i.regularidade)));
    if (!alvo) return;
    if (!items.length) { alvo.innerHTML = insufficient.map(i => `<div class="metric-row"><span>${htmlEscape(getDriverShortName(i))}</span><b>N/D — voltas insuficientes</b></div>`).join("") || `<div class="analytics-state">Analytics de regularidade indisponível para esta etapa.</div>`; return; }
    const valores = items.map(i => Number(i.regularidade)).sort((a,b)=>a-b);
    const quartil = q => valores[Math.min(valores.length - 1, Math.floor((valores.length - 1) * q))];
    const q1=quartil(.25), q2=quartil(.5), q3=quartil(.75), max=Math.max(...valores, .001);
    alvo.innerHTML = `<div class="regularity-zones">Alta ≤${q1.toFixed(3)}s · Boa ≤${q2.toFixed(3)}s · Média ≤${q3.toFixed(3)}s · Baixa &gt;${q3.toFixed(3)}s</div>` + items.map((i,idx) => `<button class="metric-row" onclick="abrirDetalheRegularidade(${idx})" title="${htmlEscape(getDriverFullDisplayName(i))} | Regularidade ±${Number(i.regularidade).toFixed(3)}s | Pace ${Number(i.pace).toFixed(3)}s | Melhor ${Number(i.bestLap).toFixed(3)}s | Limpas ${i.cleanLaps}/${i.totalLaps}"><span>${htmlEscape(getDriverShortName(i))}</span><i style="width:${Math.max(3, i.regularidade/max*100)}%;background:${i.regularidade<=q1?'#36c98f':i.regularidade<=q2?'#5ca8ff':i.regularidade<=q3?'#ffca5c':'#ff6b6b'}"></i><b>±${Number(i.regularidade).toFixed(3)}s</b></button>`).join("") + insufficient.map(i => `<div class="metric-row"><span>${htmlEscape(getDriverShortName(i))}</span><b>N/D — voltas insuficientes</b></div>`).join("");
    alvo._sortedItems = items;
}
function abrirDetalheRegularidade(index) {
    const item = document.getElementById("regularidadeChart")?._sortedItems?.[index]; if (!item) return;
    const grid = Number(ETAPA_ANALYTICS_ATUAL.gridPace);
    const propria = lap => lap.volta===1?'⚪ Não Classificada':lap.classification==='joker_lap'?'🃏 Joker Lap / Anômala':lap.isBest?'🏆 Mais Rápida':!lap.clean?'🔴 Lenta / Fora da janela':lap.tempo<item.pace-item.regularidade?'🟢 Rápida':lap.tempo>item.pace+item.regularidade?'🔴 Lenta':'🔵 Normal';
    const compGrid = lap => { if (!Number.isFinite(grid)||!lap.tempo) return '-'; const d=(lap.tempo-grid)/grid; return d<=-.03?'Muito Acima da Média':d<=-.01?'Acima da Média':d<.01?'Média':d<.03?'Abaixo da Média':'Muito Abaixo da Média'; };
    const overlay=document.createElement('div'); overlay.className='analytics-modal'; overlay.innerHTML=`<div class="analytics-modal-box"><button class="modal-close">×</button><h2>${htmlEscape(getDriverFullDisplayName(item))}</h2><p>As voltas são comparadas com a melhor volta válida do piloto (${item.bestLap.toFixed(3)}s) e com a média do grid (${Number.isFinite(grid)?grid.toFixed(3):'-'}s).</p><p><strong>Regularidade:</strong> ±${item.regularidade.toFixed(3)}s · <strong>Pace:</strong> ${item.pace.toFixed(3)}s</p><p class="hint">Voltas limpas: sem a volta 1, sem outliers abaixo de 80% da mediana e até 5% acima da melhor volta válida.</p><div class="dashboard-table-wrap"><table><tr><th>Volta</th><th>Tempo (s)</th><th>Comparação Própria</th><th>Comparação com o Grid</th></tr>${item.laps.map(l=>`<tr><td>${l.volta}</td><td>${l.tempo?.toFixed(3)||'-'}</td><td>${propria(l)}</td><td>${compGrid(l)}</td></tr>`).join('')}</table></div></div>`; document.body.appendChild(overlay); overlay.querySelector('.modal-close').onclick=()=>overlay.remove(); overlay.onclick=e=>{if(e.target===overlay)overlay.remove();};
}
function setRaceMode(mode) {
    RACE_MODE = mode === "geral" ? "geral" : "campeonato";
    document.getElementById("raceChamp")?.classList.toggle("selected", RACE_MODE === "campeonato");
    document.getElementById("raceAll")?.classList.toggle("selected", RACE_MODE === "geral");
    renderRaceSnapshot();
}

function racePositionsForSnapshot(snapshot, mode = RACE_MODE) {
    const rows = Array.isArray(snapshot?.positions) ? snapshot.positions : [];
    if (mode === "geral") return rows;
    const snapshotRenderizado = rows
        .filter(p => DASHBOARD_STAGE_STATE.pilotosCampeonatoUids.has(getPilotUid(p)) || DASHBOARD_STAGE_STATE.pilotosCampeonatoIds.has(String(p.driver_id)))
        .map(p => ({ ...p }))
        .sort((a, b) => Number(a.positionChampionship || Infinity) - Number(b.positionChampionship || Infinity));
    const expectedIds = DASHBOARD_STAGE_STATE.pilotosCampeonatoUids.size ? DASHBOARD_STAGE_STATE.pilotosCampeonatoUids : DASHBOARD_STAGE_STATE.pilotosCampeonatoIds;
    const visibleIds = new Set(snapshotRenderizado.map(p => getPilotUid(p) || String(p.driver_id)));
    const extras = [...visibleIds].filter(id => !expectedIds.has(id));
    if (extras.length) {
        console.warn("[Kart] Evolução contém piloto externo no modo Campeonato", {
            expected: [...expectedIds], visible: [...visibleIds], extras
        });
    }
    return snapshotRenderizado;
}

function raceDisplayKey(item) {
    return DriverIdentity.driverKey(item) || `name:${DriverIdentity.normalizeDriverName(DriverIdentity.getDriverName(item))}`;
}

function raceDeltaVisual(item, currentPosition, snapshotIndex, mode = RACE_MODE) {
    const persisted = mode === "campeonato" ? item?.positionDeltaOverall : item?.positionDeltaOverall;
    if (Number.isFinite(Number(persisted))) return Number(persisted);
    if (snapshotIndex <= 0) return 0;
    const previousSnapshot = ETAPA_ANALYTICS_ATUAL?.snapshots?.[snapshotIndex - 1];
    const previousRows = racePositionsForSnapshot(previousSnapshot, mode);
    const key = raceDisplayKey(item);
    const previousIndex = previousRows.findIndex(p => raceDisplayKey(p) === key);
    return previousIndex >= 0 ? (previousIndex + 1) - currentPosition : 0;
}

function raceGapVisual(item, previousItem) {
    if (!previousItem) return "Líder";
    const currentLaps = Number(item?.completedLaps);
    const previousLaps = Number(previousItem?.completedLaps);
    if (Number.isFinite(currentLaps) && Number.isFinite(previousLaps) && previousLaps > currentLaps) {
        const laps = previousLaps - currentLaps;
        return `+${laps} volta${laps === 1 ? "" : "s"}`;
    }
    const currentElapsed = Number(item?.elapsedTime);
    const previousElapsed = Number(previousItem?.elapsedTime);
    if (Number.isFinite(currentElapsed) && Number.isFinite(previousElapsed)) {
        return `+${Math.max(0, currentElapsed - previousElapsed).toFixed(3)}s`;
    }
    return "-";
}

function renderRaceSnapshot() {
    const snaps = ETAPA_ANALYTICS_ATUAL?.snapshots || [];
    const alvo = document.getElementById("raceSnapshot");
    const label = document.getElementById("raceLapLabel");
    if (!alvo || !label || !snaps.length) return;

    RACE_SNAPSHOT_INDEX = Math.max(0, Math.min(RACE_SNAPSHOT_INDEX, snaps.length - 1));
    const snap = snaps[RACE_SNAPSHOT_INDEX];
    const positions = racePositionsForSnapshot(snap, RACE_MODE);

    document.getElementById("raceChamp")?.classList.toggle("selected", RACE_MODE === "campeonato");
    document.getElementById("raceAll")?.classList.toggle("selected", RACE_MODE === "geral");
    const ultimaVolta = snaps.filter(item => item.snapshotType !== "grid").at(-1)?.numeroVolta || 0;
    label.textContent = snap.snapshotType === "grid"
        ? `🏁 LARGADA · ${positions.length} piloto(s)`
        : `VOLTA ${snap.numeroVolta} / ${ultimaVolta} · ${positions.length} piloto(s)`;

    if (RACE_MODE === "campeonato" && ETAPA_ANALYTICS_ATUAL?.stageResultDrivers?.length) {
        const check = DriverIdentity.compareStageDriverIds(ETAPA_ANALYTICS_ATUAL.stageResultDrivers, snap.positions || [], positions);
        if (check.missing.length || check.unexpected.length) console.warn("Inconsistência de pilotos da etapa", check);
    }

    if (!positions.length) {
        alvo.innerHTML = '<div class="analytics-state">Nenhum piloto disponível neste filtro.</div>';
        return;
    }

    alvo.innerHTML = `<div class="race-table">${positions.map((p, index) => {
        // A ordem visual usa positionChampionship; o texto e o delta preservam
        // a posição real no grid completo, inclusive ao ultrapassar externos.
        const pos = Number(p.positionOverall) || index + 1;
        const delta = raceDeltaVisual(p, pos, RACE_SNAPSHOT_INDEX, RACE_MODE);
        const previous = positions[index - 1] || null;
        const gap = Number.isFinite(Number(p.gapToPreviousOverall)) ? `+${Number(p.gapToPreviousOverall).toFixed(3)}s para o carro à frente` : raceGapVisual(p, previous);
        const tooltip = snap.snapshotType === "grid"
            ? `${getDriverFullDisplayName(p)} | Grid geral: P${pos} | Grid campeonato: P${p.positionChampionship || "-"} | Classificação: ${p.melhor_tempo || p.qualifying?.bestLap || "—"}`
            : `${getDriverFullDisplayName(p)} | Kart: ${p.kart_numero || "-"} | Posição geral: P${pos} | Posição campeonato: P${p.positionChampionship || "-"} | Gap: ${gap}`;
        const trackWidth = Math.max(18, 100 - ((pos - 1) * 10));
        const movement = snap.snapshotType === "grid" ? "Largada" : delta > 0 ? `▲ +${delta}` : delta < 0 ? `▼ ${delta}` : "= 0";
        return `<div class="race-row" title="${htmlEscape(tooltip)}">
            <b class="race-position">P${pos}</b>
            <span class="race-track-cell"><i class="race-track" style="width:${trackWidth}%"></i></span>
            <span class="race-driver"><strong>${htmlEscape(getDriverShortName(p))}</strong><small>${RACE_MODE === "campeonato" ? `P${p.positionChampionship || "-"} campeonato · ` : ""}${gap}</small></span>
            <em class="${delta > 0 ? "gain" : delta < 0 ? "loss" : ""}">${movement}</em>
        </div>`;
    }).join("")}</div>`;
}
function proximaVolta(){const n=ETAPA_ANALYTICS_ATUAL?.snapshots?.length||0;if(n){RACE_SNAPSHOT_INDEX=Math.min(n-1,RACE_SNAPSHOT_INDEX+1);renderRaceSnapshot();}}
function voltaAnterior(){RACE_SNAPSHOT_INDEX=Math.max(0,RACE_SNAPSHOT_INDEX-1);renderRaceSnapshot();}
function playRaceAnimation(){if(RACE_PLAY_TIMER){pauseRaceAnimation();return;} const btn=document.getElementById('racePlay');if(btn)btn.textContent='⏸ Pausar';RACE_PLAY_TIMER=setInterval(()=>{const n=ETAPA_ANALYTICS_ATUAL?.snapshots?.length||0;if(RACE_SNAPSHOT_INDEX>=n-1){pauseRaceAnimation();return;}proximaVolta();},1000);}
function pauseRaceAnimation(){if(RACE_PLAY_TIMER)clearInterval(RACE_PLAY_TIMER);RACE_PLAY_TIMER=null;const btn=document.getElementById('racePlay');if(btn)btn.textContent='▶ Reproduzir';}
function renderUltrapassagensChart(mode='campeonato') {
    OVERTAKE_MODE=mode; const source=ETAPA_ANALYTICS_ATUAL?.[mode==='campeonato'?'ultrapassagensCampeonato':'ultrapassagensGeral']||[], reconciled=mode==='campeonato'?DriverIdentity.reconcileStageChampionshipDrivers(source,pilotosOficiaisAtuais(),driver=>({...driver,isChampionship:true,feitas:0,tomadas:0,saldo:0})):source, items=[...reconciled].sort((a,b)=>getDriverFullDisplayName(a).localeCompare(getDriverFullDisplayName(b),'pt-BR',{sensitivity:'base'})), alvo=document.getElementById('overtakeChart'); if(!alvo)return;
    document.getElementById('overtakeChamp')?.classList.toggle('selected',mode==='campeonato'); document.getElementById('overtakeAll')?.classList.toggle('selected',mode==='geral');
    const max=Math.max(1,...items.flatMap(i=>[i.feitas,i.tomadas]));
    alvo.innerHTML=items.length ? `<div class="overtake-head"><span>Piloto</span><span>Feitas</span><span>Tomadas</span></div>`+items.map(i=>`<div class="metric-row overtake" title="${htmlEscape(getDriverFullDisplayName(i))}"><span>${htmlEscape(getDriverShortName(i))}</span><span class="overtake-bar"><i class="made" style="width:${i.feitas/max*100}%"></i><b>+${i.feitas}</b></span><span class="overtake-bar"><i class="lost" style="width:${i.tomadas/max*100}%"></i><b>-${i.tomadas}</b></span></div>`).join('') : '<div class="analytics-state">Sem transições suficientes.</div>';
    const top=field=>[...items].sort((a,b)=>b[field]-a[field])[0], k=document.getElementById('overtakeKpis'); if(k&&items.length){const a=top('feitas'),b=top('tomadas'),c=top('saldo');k.innerHTML=`<div class="analytics-kpis"><span>Mais ultrapassou: <b>${htmlEscape(getDriverShortName(a))} — ${a.feitas}</b></span><span>Mais sofreu: <b>${htmlEscape(getDriverShortName(b))} — ${b.tomadas}</b></span><span>Melhor saldo: <b>${htmlEscape(getDriverShortName(c))} — ${c.saldo>=0?'+':''}${c.saldo}</b></span></div>`;}
}

inicializarPreviewVoltaAVoltaJS();
fetchData();
