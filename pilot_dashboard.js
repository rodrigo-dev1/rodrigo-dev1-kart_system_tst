(function () {
    "use strict";
    let cache = new Map();
    let summaryPilots = [];
    const el = id => document.getElementById(id);
    const n = value => value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
    const avg = values => { const valid = values.map(n).filter(Number.isFinite); return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null; };
    const esc = value => typeof htmlEscape === "function" ? htmlEscape(value) : String(value || "");
    const fmt = (value, suffix = "") => n(value) === null ? "N/D" : `${Number(value).toFixed(3)}${suffix}`;
    const present = value => value !== null && value !== undefined && value !== "";
    const position = value => n(value) !== null && n(value) > 0 ? `P${n(value)}` : "—";
    const signed = value => n(value) === null ? "—" : `${n(value) > 0 ? "+" : ""}${n(value)}`;
    const duration = value => {
        if (!present(value)) return "—";
        if (typeof value === "string" && value.includes(":")) return esc(value);
        const seconds = n(value);
        if (seconds === null || seconds < 0) return "—";
        return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(3).padStart(6, "0")}`;
    };
    const driverId = item => DriverIdentity.getDriverId(item);
    const pilotUid = item => DriverIdentity.getPilotUid(item);
    const pilotKey = item => pilotUid(item) || driverId(item);
    const stageOvertakes = row => KartAnalytics.getPilotStageOvertakes(row);

    function pilotChampionships(pilot) {
        return typeof vinculosPiloto === "function" ? vinculosPiloto(pilot) : (pilot.campeonatos || []);
    }
    async function loadPilotIndex() {
        const byUid = new Map();
        for (const camp of DB.campeonatos || []) {
            const snap = await firestore.collection(COLLECTION_CAMPEONATOS).doc(camp.id).collection("pilot_summaries").get();
            snap.docs.forEach(doc => {
                const row = { ...doc.data(), pilot_uid: doc.data()?.pilot_uid || doc.id };
                if (!byUid.has(row.pilot_uid)) byUid.set(row.pilot_uid, { ...row, campeonatos: [] });
                byUid.get(row.pilot_uid).campeonatos.push(camp.id);
            });
        }
        summaryPilots = [...byUid.values()].sort((a, b) => String(a.driver_name_display).localeCompare(String(b.driver_name_display)));
        return summaryPilots;
    }
    async function populatePilots() {
        const select = el("pilotFilterDriver");
        if (!select) return;
        const selected = select.value;
        select.innerHTML = `<option value="">Carregando…</option>`;
        await loadPilotIndex();
        select.innerHTML = `<option value="">Selecione</option>` + summaryPilots
            .map(p => `<option value="${esc(p.pilot_uid)}">${esc(p.driver_name_display)}</option>`).join("");
        if ([...select.options].some(o => o.value === selected)) select.value = selected;
        updateChampionships();
    }
    function updateChampionships() {
        const pilot = summaryPilots.find(p => p.pilot_uid === el("pilotFilterDriver")?.value);
        const linked = new Set(pilotChampionships(pilot || {}).flatMap(value => [String(value), normalizarDocId(value)]));
        const select = el("pilotFilterChampionship"), old = select?.value;
        if (!select) return;
        select.innerHTML = `<option value="">Selecione</option>` + DB.campeonatos.filter(c => linked.has(c.nome) || linked.has(c.id) || linked.has(normalizarDocId(c.nome))).map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("");
        if ([...select.options].some(o => o.value === old)) select.value = old;
        updateStages();
    }
    async function updateStages() {
        const campId = el("pilotFilterChampionship")?.value, select = el("pilotFilterStage");
        if (!select) return;
        select.innerHTML = `<option value="all">Todas</option>`;
        if (!campId) return;
        const snap = await firestore.collection(COLLECTION_CAMPEONATOS).doc(campId).collection("resultado_final").get();
        snap.docs.sort((a, b) => Number(a.data().etapa || 0) - Number(b.data().etapa || 0)).forEach(doc => {
            select.insertAdjacentHTML("beforeend", `<option value="${esc(doc.id)}">Etapa ${esc(doc.data().etapa || doc.id)}</option>`);
        });
    }
    async function queryPilotAnalytics(id) {
        if (cache.has(id)) return cache.get(id);
        const rows = [];
        for (const camp of DB.campeonatos || []) {
            const stages = await firestore.collection(COLLECTION_CAMPEONATOS).doc(camp.id).collection("resultado_final").get();
            for (const stage of stages.docs) {
                const doc = await stage.ref.collection("pilot_analytics").doc(String(id)).get();
                if (doc.exists) rows.push({ ...doc.data(), _path: doc.ref.path });
            }
        }
        cache.set(id, rows);
        return rows;
    }
    function selectedData(rows) {
        const camp = el("pilotFilterChampionship")?.value, stage = el("pilotFilterStage")?.value;
        return rows.filter(r => (!camp || r.campeonato_id === camp) && (stage === "all" || !stage || r.etapa_id === stage)).sort((a, b) => Number(a.etapa) - Number(b.etapa));
    }
    function kpis(rows) {
        const sum = fn => rows.filter(fn).length;
        return [
            ["🏁", "Corridas", rows.length], ["🏆", "Vitórias", sum(r => r.achievements?.win)],
            ["🥇", "Pódios", sum(r => r.achievements?.podium)], ["⚡", "Poles", sum(r => r.achievements?.pole)],
            ["📊", "Pontos", rows.reduce((s, r) => s + Number(r.result?.points || 0), 0)], ["🏅", "Títulos", 0]
        ].map(([icon, label, value]) => `<div class="pilot-kpi"><span>${icon}</span><b>${value}</b><small>${label}</small></div>`).join("");
    }
    function lineChart(rows, series, invert = false) {
        if (!rows.length) return `<div class="pilot-empty">Piloto não participou desta etapa</div>`;
        const width = 700, height = 220, pad = 34;
        const values = rows.flatMap(row => series.map(s => n(s.get(row)))).filter(Number.isFinite);
        if (!values.length) return `<div class="pilot-empty">Etapa ainda não reprocessada</div>`;
        let min = Math.min(...values), max = Math.max(...values); if (min === max) max = min + 1;
        const x = i => pad + i * ((width - pad * 2) / Math.max(1, rows.length - 1));
        const y = v => pad + ((invert ? v - min : max - v) / (max - min)) * (height - pad * 2);
        return `<svg class="pilot-svg" viewBox="0 0 ${width} ${height}" role="img">${series.map(s => {
            const points = rows.map((r, i) => n(s.get(r)) === null ? null : `${x(i)},${y(n(s.get(r)))}`).filter(Boolean).join(" ");
            return `<polyline points="${points}" fill="none" stroke="${s.color}" stroke-width="4"/><g>${rows.map((r, i) => n(s.get(r)) === null ? "" : `<circle cx="${x(i)}" cy="${y(n(s.get(r)))}" r="5" fill="${s.color}"><title>Etapa ${r.etapa}: ${s.name} ${s.get(r)}</title></circle>`).join("")}</g>`;
        }).join("")}${rows.map((r, i) => `<text x="${x(i)}" y="210" text-anchor="middle">E${r.etapa}</text>`).join("")}</svg><div class="pilot-legend">${series.map(s => `<span style="--c:${s.color}">${s.name}</span>`).join("")}</div>`;
    }
    function bars(rows, get, tooltip) {
        const values = rows.map(r => n(get(r)) || 0), max = Math.max(1, ...values.map(Math.abs));
        return `<div class="pilot-bars">${rows.map((r, i) => `<div class="pilot-bar-col" title="${esc(tooltip(r))}"><b>${values[i] > 0 ? "+" : ""}${values[i]}</b><i class="${values[i] < 0 ? "negative" : values[i] === 0 ? "neutral" : ""}" style="height:${Math.max(4, Math.abs(values[i]) / max * 120)}px"></i><small>E${r.etapa}</small></div>`).join("")}</div>`;
    }
    function podium(rows) {
        const counts = [1, 2, 3].map(pos => rows.filter(r => Number(r.result?.positionChampionship) === pos).length), total = counts.reduce((a, b) => a + b, 0);
        const degree = total ? counts[0] / total * 360 : 0, degree2 = total ? (counts[0] + counts[1]) / total * 360 : 0;
        return `<div class="pilot-donut" style="background:conic-gradient(#ffca5c 0 ${degree}deg,#b7c2d0 ${degree}deg ${degree2}deg,#c77d55 ${degree2}deg)"><b>${total}</b><small>pódios</small></div><div class="pilot-legend"><span style="--c:#ffca5c">P1 ${counts[0]}</span><span style="--c:#b7c2d0">P2 ${counts[1]}</span><span style="--c:#c77d55">P3 ${counts[2]}</span></div>`;
    }
    function scores(rows) {
        const regularity = avg(rows.map(r => r.pace?.regularity));
        const pace = avg(rows.map(r => r.pace?.pace));
        const start = avg(rows.map(r => r.start?.deltaOverall)) || 0, over = avg(rows.map(r => stageOvertakes(r).balance)) || 0;
        const points = rows.reduce((s, r) => s + Number(r.result?.points || 0), 0), possible = rows.length * Math.max(...Object.values(PONTOS_PADRAO));
        return [regularity === null ? 0 : 100 / (1 + regularity), pace === null ? 0 : 100 / (1 + Math.max(0, pace / Math.max(1, pace) - 1)), Math.max(0, Math.min(100, 50 + start * 10)), Math.max(0, Math.min(100, 50 + over * 10)), possible ? points / possible * 100 : 0].map(v => Math.round(v));
    }
    function radar(rows) {
        const labels = ["Regularidade", "Ritmo", "Largada", "Ultrapassagem", "Aproveitamento"], values = scores(rows), cx = 170, cy = 150, radius = 105;
        const point = (i, scale) => { const angle = -Math.PI / 2 + i * Math.PI * 2 / labels.length; return `${cx + Math.cos(angle) * radius * scale},${cy + Math.sin(angle) * radius * scale}`; };
        return `<svg class="pilot-radar" viewBox="0 0 340 310">${[.25,.5,.75,1].map(s => `<polygon points="${labels.map((_,i)=>point(i,s)).join(" ")}" fill="none" stroke="#465063"/>`).join("")}<polygon points="${values.map((v,i)=>point(i,v/100)).join(" ")}" fill="rgba(255,75,75,.3)" stroke="#ff6b6b" stroke-width="3"/>${labels.map((label,i)=>{const [x,y]=point(i,1.18).split(',');return `<text x="${x}" y="${y}" text-anchor="middle">${label}</text>`}).join("")}</svg>`;
    }
    const card = (title, body, cls = "") => `<section class="pilot-card ${cls}"><h3>${title}</h3>${body}</section>`;
    function resultsTable(rows) {
        return `<div class="pilot-table-wrap"><table class="pilot-table"><thead><tr><th>Etapa</th><th>Data</th><th>Campeonato</th><th>Posição</th><th>Pontos</th><th>Grid</th><th>Melhor Volta</th><th>Regularidade</th><th>Ultrapassagens</th><th>Ações</th></tr></thead><tbody>${rows.map(r => `<tr><td>Etapa ${r.etapa}</td><td>${esc(formatarDataBR(r.dataCorrida))}</td><td>${esc(r.campeonato)}</td><td>P${r.result?.positionOverall || "-"}<small> · P${r.result?.positionChampionship || "-"} campeonato</small></td><td>${r.result?.points || 0}</td><td>P${r.start?.gridPositionOverall || "-"}</td><td>${fmt(r.bestLap?.time,"s")}</td><td>${fmt(r.pace?.regularity,"s")}</td><td>${Number(r.overtakes?.balanceOverall || 0)}</td><td><button class="btn-view" onclick="abrirDetalhesPilotoEtapa('${esc(r.etapa_id)}')">Detalhes</button></td></tr>`).join("")}</tbody></table></div>`;
    }
    function championshipComparison(rows) {
        const groups = new Map();
        rows.forEach(row => {
            const key = row.campeonato_id || row.campeonato || "—";
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(row);
        });
        if (!groups.size) return `<div class="pilot-empty">Sem campeonatos para comparar</div>`;
        return `<div class="championship-comparison">${[...groups.values()].map(stages => {
            const first = stages[0];
            const validBestLaps = stages.map(row => ({ row, time: n(row.race?.bestLap) })).filter(item => item.time !== null && item.time > 0).sort((a, b) => a.time - b.time);
            const best = validBestLaps[0];
            const metric = (label, value, detail = "") => `<div><small>${label}</small><b>${value}</b>${detail ? `<span>${detail}</span>` : ""}</div>`;
            return `<article><h4>${esc(first.campeonato || first.campeonato_id || "Campeonato")}</h4><div class="comparison-metrics">
                ${metric("Corridas", stages.length)}${metric("Vitórias", stages.filter(r => r.achievements?.win).length)}${metric("Pódios", stages.filter(r => r.achievements?.podium).length)}${metric("Poles", stages.filter(r => r.achievements?.pole).length)}
                ${metric("Pontos", stages.reduce((sum, r) => sum + Number(r.scoring?.total ?? r.result?.points ?? 0), 0))}${metric("Média de Posição", fmt(avg(stages.map(r => r.result?.positionChampionship))))}${metric("Média de Pontos", fmt(avg(stages.map(r => r.scoring?.total ?? r.result?.points)) ))}
                ${metric("Regularidade média", avg(stages.map(r => r.pace?.regularity)) === null ? "—" : `±${avg(stages.map(r => r.pace?.regularity)).toFixed(3)}s`)}${metric("Pace relativo médio", duration(avg(stages.map(r => r.pace?.pace))))}
                ${metric("Melhor Volta", best ? duration(best.time) : "—", best ? `Etapa ${esc(best.row.etapa || "—")}` : "")}
            </div></article>`;
        }).join("")}</div>`;
    }
    function achievements(rows) {
        const count = key => rows.filter(r => r.achievements?.[key]).length, points = rows.reduce((s,r)=>s+Number(r.result?.points||0),0), possible=rows.length*20;
        const values = [["👑","Grand Chelem",count("grandChelem")],["🎯","Hat Trick",count("hatTrick")],["🏆","Títulos",0],["⚡","Melhores Voltas",count("fastestLap")],["🌟","Melhor Volta do Dia",count("fastestLap")],["📊","Presença",rows.length?"100%":"0%"],["🎯","Aproveitamento",possible?`${Math.round(points/possible*100)}%`:"0%"],["⚠","Advertências","N/D"]];
        return `<div class="pilot-achievements">${values.map(v=>`<div><span>${v[0]}</span><b>${v[2]}</b><small>${v[1]}</small></div>`).join("")}</div>`;
    }
    function deltaMarkup(value) {
        const delta = n(value);
        if (delta === null) return `<span class="stage-delta neutral">—</span>`;
        const cls = delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral";
        const symbol = delta > 0 ? "▲" : delta < 0 ? "▼" : "=";
        return `<span class="stage-delta ${cls}">${symbol} ${signed(delta)} ${Math.abs(delta) === 1 ? "posição" : "posições"}</span>`;
    }
    function positionJourney(title, help, from, to, delta) {
        return `<div class="stage-journey"><h4>${title}</h4><p>${help}</p><div class="stage-positions"><span><small>LARGADA</small><b>${position(from)}</b></span><i aria-hidden="true">→</i><span><small>CHEGADA</small><b>${position(to)}</b></span></div>${deltaMarkup(delta)}</div>`;
    }
    function stageSummary(row) {
        if (!row) return card("🏁 RESUMO DA ETAPA", `<div class="pilot-empty">Piloto não participou desta etapa</div>`, "pilot-wide stage-summary");
        const overallFrom = row.qualifying?.positionOverall, overallTo = row.result?.positionOverall;
        const championshipFrom = row.qualifying?.positionChampionship, championshipTo = row.result?.positionChampionship;
        // `finish` is canonical. The subtraction fallback supports analytics persisted before this field existed.
        const finishOverall = n(row.finish?.deltaOverall) ?? (n(overallFrom) !== null && n(overallTo) !== null ? n(overallFrom) - n(overallTo) : null);
        const finishChampionship = n(row.finish?.deltaChampionship) ?? (n(championshipFrom) !== null && n(championshipTo) !== null ? n(championshipFrom) - n(championshipTo) : null);
        const points = n(row.scoring?.total) ?? n(row.result?.points);
        const bestLap = row.race?.bestLap ?? row.bestLap?.time;
        const bestRank = n(row.race?.bestLapRankOverall) ?? n(row.bestLap?.rankOverall);
        const canonicalOvertakes = stageOvertakes(row), balance = n(canonicalOvertakes.balance);
        const metric = (icon, label, value, detail = "", cls = "") => `<div class="stage-metric ${cls}"><small>${icon} ${label}</small><b>${value}</b>${detail ? `<span>${detail}</span>` : ""}</div>`;
        const firstLap = `<div class="stage-metric stage-first-lap"><small>🚀 1ª VOLTA</small><b>${position(row.start?.gridPositionOverall)} <i>→</i> ${position(row.start?.firstLapPositionOverall)}</b>${deltaMarkup(row.start?.deltaOverall)}</div>`;
        const rankDetail = bestRank !== null && bestRank > 0 ? `P${bestRank} geral` : "";
        const regularity = n(row.pace?.regularity);
        const made = n(canonicalOvertakes.made), taken = n(canonicalOvertakes.taken);
        const overtakes = made === null && taken === null ? "—" : `${made === null ? "—" : `+${made}`} / ${taken === null ? "—" : `-${taken}`}`;
        const balanceCls = balance > 0 ? "positive" : balance < 0 ? "negative" : "neutral";
        return card("🏁 RESUMO DA ETAPA", `<div class="stage-summary-head"><b>Etapa ${esc(row.etapa || "—")}</b><span>${present(row.dataCorrida) ? esc(formatarDataBR(row.dataCorrida)) : "—"}</span></div><div class="stage-journeys">${positionJourney("GERAL DA BATERIA", "Posição considerando todos os participantes da corrida.", overallFrom, overallTo, finishOverall)}${positionJourney("CAMPEONATO", "Posição considerando somente os pilotos oficiais do campeonato.", championshipFrom, championshipTo, finishChampionship)}</div><div class="stage-metrics">${firstLap}${metric("📊", "PONTOS", points === null ? "—" : `${points} pts`)}${metric("⏱", "MELHOR VOLTA", duration(bestLap), rankDetail)}${metric("〽", "PACE", duration(row.pace?.pace))}${metric("📏", "REGULARIDADE", regularity === null ? "—" : `±${regularity.toFixed(3)}s`)}${metric("🔄", "ULTRAPASSAGENS", overtakes, made === null && taken === null ? "" : "feitas / tomadas")}${metric("↔", "SALDO", signed(balance), "", balanceCls)}</div>`, "pilot-wide stage-summary");
    }
    function render(rows, pilot) {
        const target = el("pilotDashboardContent"), initials = DriverIdentity.getDriverDisplayName(pilot).split(/\s+/).map(x=>x[0]).slice(0,2).join("");
        const filtered = selectedData(rows), photo = pilot.foto || pilot.foto_url || "";
        const specificStage = el("pilotFilterStage")?.value && el("pilotFilterStage").value !== "all";
        const historical = `${card("📈 Evolução de Posições",lineChart(filtered,[{name:"Posição Final geral",color:"#ff6b6b",get:r=>r.result?.positionOverall},{name:"Largada geral",color:"#5ca8ff",get:r=>r.start?.gridPositionOverall},{name:"Melhor Volta geral",color:"#ffca5c",get:r=>r.bestLap?.rankOverall}],true),"pilot-wide")}${card("📊 Pontuação por Etapa",bars(filtered,r=>r.result?.points,r=>`Etapa ${r.etapa}: ${r.result?.points||0} pontos`))}${card("↔ Saldo de Ultrapassagens",bars(filtered,r=>stageOvertakes(r).balance,r=>{const o=stageOvertakes(r);return `Etapa ${r.etapa}\nFeitas: ${o.made??"N/D"}\nTomadas: ${o.taken??"N/D"}\nSaldo: ${signed(o.balance)}`}))}${card("🏁 Performance na Largada",bars(filtered,r=>r.start?.deltaOverall,r=>`Etapa ${r.etapa}: ${r.start?.deltaOverall??"N/D"}`))}${card("🎯 Perfil de Performance",radar(filtered))}${card("〽 Ritmo e Regularidade",lineChart(filtered,[{name:"Pace",color:"#36c98f",get:r=>r.pace?.pace},{name:"Pace - Regularidade",color:"#5ca8ff",get:r=>n(r.pace?.pace)-n(r.pace?.regularity)},{name:"Pace + Regularidade",color:"#8d75d8",get:r=>n(r.pace?.pace)+n(r.pace?.regularity)}]))}${card("⏱ Evolução da Melhor Volta",lineChart(filtered,[{name:"Ranking geral",color:"#ffca5c",get:r=>r.bestLap?.rankOverall}],true))}`;
        target.innerHTML = `<div class="pilot-hero"><div class="pilot-avatar">${photo?`<img src="${esc(photo)}" alt="">`:esc(initials)}</div><div><span>DASHBOARD DO PILOTO</span><h2>${esc(DriverIdentity.getDriverDisplayName(pilot))}</h2><p>${esc(el("pilotFilterChampionship")?.selectedOptions[0]?.text || "Campeonatos")} · ${filtered.length} etapa(s) disputada(s)</p></div></div><div class="pilot-kpis">${kpis(filtered)}</div><div class="pilot-grid">${card("📋 Resultados por Corrida",resultsTable(filtered),"pilot-wide")}${specificStage ? stageSummary(filtered[0]) + card("🎯 Perfil de Performance",radar(filtered)) : historical}${card("🏆 Distribuição de Pódios",podium(filtered))}${card("📅 Comparação por Campeonato",championshipComparison(rows))}${card("🏅 Conquistas",achievements(filtered),"pilot-wide")}${card("🏁 Campeonatos",`<div class="pilot-champ-card"><b>${esc(el("pilotFilterChampionship")?.selectedOptions[0]?.text||"-")}</b><span>${filtered.reduce((s,r)=>s+Number(r.result?.points||0),0)} pontos · ${filtered.length} corridas · posição média ${fmt(avg(filtered.map(r=>r.result?.positionChampionship)))}</span><button onclick="show('dash')">Ver Campeonato</button></div>`,"pilot-wide")}</div>`;
    }
    async function filter() {
        const id = el("pilotFilterDriver")?.value, target = el("pilotDashboardContent");
        if (!id) { target.innerHTML = `<div class="pilot-empty">Selecione um piloto</div>`; return; }
        target.innerHTML = `<div class="pilot-empty">Consultando analytics persistidos…</div>`;
        try { const rows = await queryPilotAnalytics(id); render(rows, summaryPilots.find(p => p.pilot_uid === id) || { pilot_uid:id, driver_name:id }); }
        catch (error) { console.error(error); target.innerHTML = `<div class="pilot-empty">Etapa ainda não reprocessada</div>`; }
    }
    window.inicializarPilotosDashboard = populatePilots;
    window.atualizarCampeonatosPiloto = updateChampionships;
    window.atualizarEtapasPiloto = updateStages;
    window.filtrarDashboardPiloto = filter;
    window.renderPilotStageSummary = stageSummary;
    window.abrirDetalhesPilotoEtapa = id => { el("pilotFilterStage").value = id; filter(); };
    window.openPilotDashboard = async ({ pilotUid: uid, campeonatoId, etapaId = null }) => {
        show("pilotosDashboard");
        if (!summaryPilots.length) await populatePilots();
        el("pilotFilterDriver").value = uid || "";
        updateChampionships();
        el("pilotFilterChampionship").value = campeonatoId || "";
        await updateStages();
        el("pilotFilterStage").value = etapaId && [...el("pilotFilterStage").options].some(option => option.value === etapaId) ? etapaId : "all";
        await filter();
    };
    window.openRaceDetails = options => window.openPilotDashboard(options);
})();
