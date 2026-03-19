// InsightUBC Course Explorer frontend (no framework)
// Uses ONLY REST endpoints:
// - POST /api/v1/datasets (multipart)
// - GET  /api/v1/datasets/:id
// - POST /api/v1/search
// - GET  /api/v1/courses (for dept list + clear data)
// - DELETE /api/v1/courses/:course (for clear data)

const state = {
	sortKey: null, // dept, code, title, year, instructor, avg
	sortDir: "UP", // UP | DOWN (DOWN implemented by reversing after server sort)
	lastResults: [],
	deptOptions: [],
	rawI1: null,
};

document.addEventListener("DOMContentLoaded", () => {
	wireUi();
	initFromServer().catch((e) => showQueryError(formatErr(e)));
});

function wireUi() {
	const uploadBtn = byId("upload-btn");
	const clearDataBtn = byId("clear-data-btn");
	const applyBtn = byId("apply-btn");
	const resetBtn = byId("reset-btn");

	uploadBtn.addEventListener("click", () => handleUpload().catch((e) => showUploadError(formatErr(e))));
	clearDataBtn.addEventListener("click", () => clearAllUploadedData().catch((e) => showUploadError(formatErr(e))));
	applyBtn.addEventListener("click", () => refreshTable().catch((e) => showQueryError(formatErr(e))));
	resetBtn.addEventListener("click", () => resetFiltersAndReload().catch((e) => showQueryError(formatErr(e))));

	// Click-to-sort (single field + toggle)
	const ths = document.querySelectorAll("#results-table thead th[data-sort]");
	for (const th of ths) {
		th.addEventListener("click", () => {
			const key = th.getAttribute("data-sort");
			if (state.sortKey === key) {
				state.sortDir = state.sortDir === "UP" ? "DOWN" : "UP";
			} else {
				state.sortKey = key;
				state.sortDir = "UP";
			}
			refreshTable().catch((e) => showQueryError(formatErr(e)));
		});
	}
}

function byId(id) {
	const el = document.getElementById(id);
	if (!el) throw new Error(`Missing element #${id}`);
	return el;
}

function setText(id, text) {
	byId(id).textContent = text;
}

function clearEl(id) {
	byId(id).textContent = "";
}

function showUploadStatus(text) {
	setText("upload-status", text);
}

function showUploadSpinner(on) {
	const sp = byId("upload-spinner");
	sp.classList.toggle("hidden", !on);
}

function showUploadError(text) {
	setText("upload-error", text);
}

function showUploadResult(text) {
	setText("upload-result", text);
}

function showQueryError(text) {
	setText("query-error", text);
}

function clearUploadMessages() {
	clearEl("upload-error");
	clearEl("upload-result");
}

function clearQueryMessages() {
	clearEl("query-error");
}

function disableUpload(disabled) {
	byId("upload-btn").disabled = disabled;
	byId("dataset-file").disabled = disabled;
	byId("clear-data-btn").disabled = disabled;
}

function disableFilters(disabled) {
	byId("apply-btn").disabled = disabled;
	byId("reset-btn").disabled = disabled;
	byId("dept-select").disabled = disabled;
	byId("year-min").disabled = disabled;
	byId("year-max").disabled = disabled;
	byId("instructor-input").disabled = disabled;
}

function clearMultiSelect(selectEl) {
	for (const opt of selectEl.options) opt.selected = false;
}

function resetFiltersAndReload() {
	state.sortKey = null;
	state.sortDir = "UP";
	clearMultiSelect(byId("dept-select"));
	byId("year-min").value = "";
	byId("year-max").value = "";
	byId("instructor-input").value = "";
	autoSelectFirstDeptIfNone();
	return refreshTable();
}

async function initFromServer() {
	setText("table-meta", "Upload a dataset to begin.");
	renderRows([]);
	await loadDeptOptionsFromCourses();
	initInsights().catch((e) => { try { setText("insight-error", formatErr(e)); } catch {} });
}

// ----------------------------
// Upload flow
// ----------------------------

async function handleUpload() {
	clearUploadMessages();

	const fileInput = byId("dataset-file");
	const file = fileInput.files && fileInput.files[0];
	if (!file) {
		showUploadError("Please choose a .zip file first.");
		return;
	}

	disableUpload(true);
	disableFilters(true);
	showUploadSpinner(true);

	showUploadStatus("Uploading…");

	let postRes;
	try {
		postRes = await postDataset(file);
	} catch (e) {
		showUploadStatus("Upload failed.");
		showUploadError(formatErr(e));
		showUploadSpinner(false);
		disableUpload(false);
		disableFilters(false);
		return;
	}

	showUploadStatus(`Processing… (job: ${postRes.id})`);

	let finalJob;
	try {
		finalJob = await pollDatasetJob(postRes.id, (job) => {
			showUploadStatus(`Processing… status=${job.status}`);
		});
	} catch (e) {
		showUploadStatus("Upload failed.");
		showUploadError(formatErr(e));
		showUploadSpinner(false);
		disableUpload(false);
		disableFilters(false);
		return;
	}

	if (finalJob.status === "completed") {
		showUploadStatus("Completed ✅");
		showUploadSpinner(false);

		const s = finalJob.stats || {};
		const lines = [
			`Dataset processing complete.`,
			`Courses: added=${s.courses_added ?? "?"}, modified=${s.courses_modified ?? "?"}`,
			`Sections: added=${s.sections_added ?? "?"}, modified=${s.sections_modified ?? "?"}`,
		];
		showUploadResult(lines.join("\n"));

		// Load dept list safely from /courses, then show something (auto-pick first dept).
		await loadDeptOptionsFromCourses();
		autoSelectFirstDeptIfNone();
		await refreshTable();
	} else {
		showUploadStatus("Failed ❌");
		showUploadError(finalJob.message || "Upload failed.");
		showUploadSpinner(false);
	}

	disableUpload(false);
	disableFilters(false);
}

// POST /api/v1/datasets
async function postDataset(file) {
	const fd = new FormData();
	fd.set("kind", "course_offerings");
	fd.set("archive", file);

	const res = await fetch("/api/v1/datasets", { method: "POST", body: fd });
	const payload = await safeJson(res);
	if (res.status === 202) return payload;

	throw new Error(formatHttpError(res, payload));
}

// GET /api/v1/datasets/:id until completed/failed
async function pollDatasetJob(id, onTick) {
	const maxAttempts = 80;
	for (let i = 0; i < maxAttempts; i++) {
		const res = await fetch(`/api/v1/datasets/${encodeURIComponent(id)}`, { method: "GET" });
		const payload = await safeJson(res);

		if (!res.ok) throw new Error(formatHttpError(res, payload));
		if (onTick) onTick(payload);

		if (payload.status === "completed" || payload.status === "failed") return payload;
		await sleep(200);
	}
	throw new Error("Timed out waiting for dataset processing to finish.");
}

// ----------------------------
// Clear uploaded data (no backend changes)
// ----------------------------

async function clearAllUploadedData() {
	clearUploadMessages();
	clearQueryMessages();

	disableUpload(true);
	disableFilters(true);
	showUploadSpinner(true);
	showUploadStatus("Clearing uploaded data…");

	try {
		const courses = await listAllCourses();
		let removed = 0;

		for (const c of courses) {
			await deleteCourse(c.id);
			removed++;
			showUploadStatus(`Clearing uploaded data… (${removed}/${courses.length})`);
		}

		showUploadStatus("All uploaded data cleared ✅");
		showUploadResult(`Deleted courses: ${removed}`);

		state.sortKey = null;
		state.sortDir = "UP";
		clearMultiSelect(byId("dept-select"));
		renderRows([]);
		setText("table-meta", "No data. Upload a dataset to begin.");

		await loadDeptOptionsFromCourses();
	} catch (e) {
		showUploadStatus("Clear data failed.");
		showUploadError(formatErr(e));
	} finally {
		showUploadSpinner(false);
		disableUpload(false);
		disableFilters(false);
	}
}

// ----------------------------
// Search + Table
// ----------------------------

async function refreshTable() {
	clearQueryMessages();

	// Fix the high-risk 413 case: don't run search with empty WHERE by default.
	// User must select at least one filter.
	if (!hasAnyFilterSelected()) {
		renderRows([]);
		setText("table-meta", "Select at least one filter (dept/year/instructor) then click Apply.");
		return;
	}

	setText("table-meta", "Loading…");

	const query = buildQueryFromUI();

	let res;
	try {
		res = await postSearch(query);
	} catch (e) {
		setText("table-meta", "");
		renderRows([]);
		showQueryError(formatErr(e));
		return;
	}

	state.lastResults = res;

	let toRender = res;
	if (state.sortKey && state.sortDir === "DOWN") {
		// backend supports only ORDER (ascending); for DOWN, reverse after server sort
		toRender = [...res].reverse();
	}

	renderRows(toRender);

	setText(
		"table-meta",
		`Rows: ${res.length}` +
			(state.sortKey ? ` | Sorted by: ${state.sortKey} ${state.sortDir === "UP" ? "▲" : "▼"}` : "")
	);
}

function hasAnyFilterSelected() {
	const selectedDepts = getSelectedValues(byId("dept-select"));
	const yearMinRaw = byId("year-min").value.trim();
	const yearMaxRaw = byId("year-max").value.trim();
	const instructorRaw = byId("instructor-input").value.trim();
	return selectedDepts.length > 0 || yearMinRaw !== "" || yearMaxRaw !== "" || instructorRaw !== "";
}

function buildQueryFromUI() {
	const selectedDepts = getSelectedValues(byId("dept-select"));
	const yearMinRaw = byId("year-min").value.trim();
	const yearMaxRaw = byId("year-max").value.trim();
	const instructorRaw = byId("instructor-input").value.trim();

	const filters = [];

	if (selectedDepts.length > 0) {
		filters.push({
			OR: selectedDepts.map((d) => ({ IS: { dept: d } })),
		});
	}

	if (yearMinRaw !== "") {
		const n = Number(yearMinRaw);
		if (Number.isFinite(n)) filters.push({ GT: { year: n - 1 } }); // year >= n
	}
	if (yearMaxRaw !== "") {
		const n = Number(yearMaxRaw);
		if (Number.isFinite(n)) filters.push({ LT: { year: n + 1 } }); // year <= n
	}

	if (instructorRaw !== "") {
		const cleaned = instructorRaw.replaceAll("*", "").trim();
		if (cleaned !== "") filters.push({ IS: { instructor: `*${cleaned}*` } });
	}

	let WHERE = {};
	if (filters.length === 1) WHERE = filters[0];
	else if (filters.length > 1) WHERE = { AND: filters };

	const OPTIONS = {
		COLUMNS: ["dept", "code", "title", "year", "instructor", "avg"],
	};

	if (state.sortKey) OPTIONS.ORDER = state.sortKey;

	return { WHERE, OPTIONS };
}

async function postSearch(query) {
	const res = await fetch("/api/v1/search", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ kind: "course_offerings", query }),
	});

	const payload = await safeJson(res);

	if (res.status === 413) {
		throw new Error(
			"Too many results (> 5000).\nPlease narrow filters (choose depts, set year range, or instructor)."
		);
	}

	if (!res.ok) throw new Error(formatHttpError(res, payload));
	if (!Array.isArray(payload)) throw new Error("Unexpected response from /api/v1/search (expected an array).");

	return payload;
}

function renderRows(rows) {
	const tbody = byId("results-body");
	tbody.innerHTML = "";

	for (const r of rows) {
		const tr = document.createElement("tr");
		tr.appendChild(td(String(r.dept ?? "")));
		tr.appendChild(td(String(r.code ?? "")));
		tr.appendChild(td(String(r.title ?? "")));
		tr.appendChild(td(String(r.year ?? "")));
		tr.appendChild(td(String(r.instructor ?? "")));
		tr.appendChild(td(formatAvg(r.avg)));
		tbody.appendChild(tr);
	}
}

function td(text) {
	const el = document.createElement("td");
	el.textContent = text;
	return el;
}

function formatAvg(v) {
	if (typeof v !== "number") return "";
	return String(Math.round(v * 10) / 10);
}

function getSelectedValues(selectEl) {
	const out = [];
	for (const opt of selectEl.options) if (opt.selected) out.push(opt.value);
	return out;
}

// ----------------------------
// Dept options from /courses (safe; avoids 413 trap)
// ----------------------------

async function loadDeptOptionsFromCourses() {
	try {
		const courses = await listAllCourses();
		const selected = new Set(getSelectedValues(byId("dept-select")));

		const depts = new Set();
		for (const c of courses) {
			if (typeof c.dept === "string" && c.dept.trim() !== "") depts.add(c.dept);
		}
		const sorted = Array.from(depts).sort((a, b) => a.localeCompare(b));
		state.deptOptions = sorted;

		const select = byId("dept-select");
		select.innerHTML = "";
		for (const d of sorted) {
			const opt = document.createElement("option");
			opt.value = d;
			opt.textContent = d;
			if (selected.has(d)) opt.selected = true;
			select.appendChild(opt);
		}
	} catch {
		byId("dept-select").innerHTML = "";
	}
}

function autoSelectFirstDeptIfNone() {
	const select = byId("dept-select");
	if (getSelectedValues(select).length > 0) return;
	if (select.options.length > 0) select.options[0].selected = true;
}

async function listAllCourses() {
	const all = [];
	let offset = 0;
	const limit = 5000;

	while (true) {
		const res = await fetch(`/api/v1/courses?limit=${limit}&offset=${offset}`, { method: "GET" });
		const payload = await safeJson(res);
		if (!res.ok) throw new Error(formatHttpError(res, payload));
		if (!payload || !Array.isArray(payload.items)) return all;

		for (const c of payload.items) all.push(c);

		offset += payload.items.length;
		if (offset >= (payload.total ?? offset) || payload.items.length === 0) break;
	}
	return all;
}

async function deleteCourse(courseId) {
	const res = await fetch(`/api/v1/courses/${encodeURIComponent(courseId)}`, { method: "DELETE" });
	const payload = await safeJson(res);
	if (!res.ok) throw new Error(formatHttpError(res, payload));
}

// ----------------------------
// Utilities
// ----------------------------

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeJson(res) {
	const text = await res.text();
	if (!text) return {};
	try {
		return JSON.parse(text);
	} catch {
		return { raw: text };
	}
}

function formatHttpError(res, payload) {
	let msg = `${res.status} ${payload?.error || res.statusText || "Error"}`;
	if (payload?.message) msg += `\n${payload.message}`;

	if (payload?.fields && typeof payload.fields === "object") {
		msg += `\n\nFields:`;
		for (const [k, v] of Object.entries(payload.fields)) msg += `\n- ${k}: ${v}`;
	}
	return msg;
}

function formatErr(e) {
	if (e instanceof Error) return e.message;
	return String(e);
}
// ─────────────────────────────────────────────────────────────────────────────
// DATA INSIGHTS
// All three charts fetch raw data via POST /api/v1/search (no TRANSFORMATIONS)
// and aggregate entirely in the browser.
// ─────────────────────────────────────────────────────────────────────────────

// Shared Chart.js defaults matching the existing white-card UI
const CHART_COLORS = {
	blue: "#3f51b5",
	blueFaded: "rgba(63,81,181,0.15)",
	border: "#ddd",
	muted: "#555",
	text: "#111",
	danger: "#b00020",
	ok: "#0b6b0b",
};

const CHART_BASE = {
	responsive: true,
	maintainAspectRatio: false,
	animation: { duration: 350 },
	plugins: {
		legend: { display: false },
		tooltip: {
			backgroundColor: "white",
			borderColor: "#ddd",
			borderWidth: 1,
			titleColor: "#111",
			bodyColor: "#555",
			padding: 10,
			cornerRadius: 8,
		},
	},
};

// Cache for raw search results (avoid redundant fetches when switching tabs/controls)
const insightCache = {
	allSections: null,   // full {dept,code,year,avg,pass,fail,audit}[] — fetched once
	loading: false,
	chart1: null,
	chart2: null,
	chart3: null,
};

// ── Tab switching ──────────────────────────────────────────────────────────

function wireInsightTabs() {
	for (const btn of document.querySelectorAll(".insight-tab")) {
		btn.addEventListener("click", () => {
			const n = btn.dataset.insight;
			for (const b of document.querySelectorAll(".insight-tab"))
				b.classList.toggle("active", b.dataset.insight === n);
			for (const p of document.querySelectorAll(".insight-panel"))
				p.style.display = p.id === `insight-panel-${n}` ? "" : "none";
		});
	}
}

// ── Entry point ────────────────────────────────────────────────────────────

async function initInsights() {
	wireInsightTabs();
	setText("insight-error", "");

	// Fetch ALL section data in one query (no TRANSFORMATIONS — v1 search only)
	// WHERE:{} returns everything; we cap at 5000 implicitly via the server limit.
	// For pair.zip the real data is well within 5000 rows of unique combos,
	// but the raw sections can exceed it.  We use dept+year buckets so we fetch
	// progressively by iterating depts to stay under the limit.
	await fetchAllSectionsForInsights();

	if (!insightCache.allSections || insightCache.allSections.length === 0) {
		setText("insight-error", "No data yet — upload a dataset to see insights.");
		return;
	}

	setText("insight-error", "");
	buildInsight1();
	buildInsight2();
	buildInsight3();
}

// Fetch data dept-by-dept to stay under the 5000-row server limit.
async function fetchAllSectionsForInsights() {
	if (insightCache.allSections !== null) return; // already loaded
	insightCache.allSections = [];

	// Use the dept list we already have from loadDeptOptionsFromCourses.
	const depts = state.deptOptions;
	if (depts.length === 0) return;

	for (const dept of depts) {
		let rows;
		try {
			const res = await fetch("/api/v1/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					kind: "course_offerings",
					query: {
						WHERE: { IS: { dept: dept } },
						OPTIONS: { COLUMNS: ["dept", "code", "year", "avg", "pass", "fail", "audit"] },
					},
				}),
			});
			const payload = await safeJson(res);
			if (!res.ok || !Array.isArray(payload)) continue;
			rows = payload;
		} catch {
			continue;
		}
		for (const r of rows) insightCache.allSections.push(r);
	}
}

// ── Insight 1: Department Average Grades (horizontal bar) ──────────────────

function buildInsight1() {
	// Aggregate: mean of all section avgs per dept
	const deptTotals = {};
	for (const r of insightCache.allSections) {
		if (typeof r.avg !== "number") continue;
		if (typeof r.year === "number" && r.year < 2000) continue; // skip 1900 "overall" rows
		if (!deptTotals[r.dept]) deptTotals[r.dept] = { sum: 0, count: 0 };
		deptTotals[r.dept].sum += r.avg;
		deptTotals[r.dept].count++;
	}

	state.rawI1 = Object.entries(deptTotals).map(([dept, { sum, count }]) => ({
		dept,
		avg: Math.round((sum / count) * 100) / 100,
	}));

	// Initial render
	renderInsight1();

	// Wire controls — guard against double-binding on re-upload
	const sortEl = byId("i1-sort");
	const limitEl = byId("i1-limit");
	sortEl.onchange = renderInsight1;
	limitEl.onchange = renderInsight1;
}

function renderInsight1() {
	if (!state.rawI1) return;
	const sortMode = byId("i1-sort").value;
	const limitVal = byId("i1-limit").value;

	let data = [...state.rawI1];
	if (sortMode === "avg") data.sort((a, b) => b.avg - a.avg);
	else data.sort((a, b) => a.dept.localeCompare(b.dept));

	const n = parseInt(limitVal, 10);
	if (!isNaN(n)) data = data.slice(0, n);
	// if limitVal is "all" or anything non-numeric, show everything

	const labels = data.map((d) => d.dept.toUpperCase());
	const values = data.map((d) => d.avg);

	// Color gradient: low avg → red tint, high avg → blue tint
	const maxV = Math.max(...values, 1);
	const minV = Math.min(...values, 0);
	const colors = values.map((v) => {
		const t = (v - minV) / (maxV - minV || 1);
		// interpolate #e53935 → #3f51b5
		const r = Math.round(229 - (229 - 63) * t);
		const g = Math.round(57  + (81 - 57) * t);
		const b = Math.round(53  + (181 - 53) * t);
		return `rgba(${r},${g},${b},0.82)`;
	});

	const ctx = byId("chart-i1").getContext("2d");
	if (insightCache.chart1) insightCache.chart1.destroy();

	insightCache.chart1 = new Chart(ctx, {
		type: "bar",
		data: {
			labels,
			datasets: [{ data: values, backgroundColor: colors, borderRadius: 4, borderSkipped: false }],
		},
		options: {
			...CHART_BASE,
			indexAxis: "y",
			scales: {
				x: {
					min: Math.max(0, minV - 3),
					grid: { color: "#eee" },
					ticks: { color: CHART_COLORS.muted },
					title: { display: true, text: "Average Grade", color: CHART_COLORS.muted },
				},
				y: {
					grid: { display: false },
					ticks: { color: CHART_COLORS.text, font: { size: 11 } },
				},
			},
			plugins: {
				...CHART_BASE.plugins,
				tooltip: {
					...CHART_BASE.plugins.tooltip,
					callbacks: {
						title: (items) => items[0].label,
						label: (item) => `Avg grade: ${item.raw.toFixed(2)}`,
					},
				},
			},
		},
	});
}

// ── Insight 2: Grade Trends Over Time (line) ───────────────────────────────

function buildInsight2() {
	const select = byId("i2-dept");
	select.innerHTML = "";
	for (const d of state.deptOptions) {
		const o = document.createElement("option");
		o.value = d;
		o.textContent = d.toUpperCase();
		select.appendChild(o);
	}
	// Default to cpsc if available
	if (state.deptOptions.includes("cpsc")) select.value = "cpsc";
	else if (select.options.length > 0) select.value = select.options[0].value;

	const render = () => renderInsight2(select.value);
	select.onchange = render;
	render();
}

function renderInsight2(dept) {
	// Aggregate: yearly avg for this dept
	const yearTotals = {};
	for (const r of insightCache.allSections) {
		if (r.dept !== dept || typeof r.avg !== "number") continue;
		if (typeof r.year !== "number" || r.year < 2000) continue; // skip 1900 "overall" rows
		const y = String(r.year);
		if (!yearTotals[y]) yearTotals[y] = { sum: 0, count: 0 };
		yearTotals[y].sum += r.avg;
		yearTotals[y].count++;
	}

	const sorted = Object.entries(yearTotals)
		.map(([year, { sum, count }]) => ({ year, avg: Math.round((sum / count) * 100) / 100 }))
		.sort((a, b) => Number(a.year) - Number(b.year));

	const labels = sorted.map((r) => r.year);
	const values = sorted.map((r) => r.avg);

	const ctx = byId("chart-i2").getContext("2d");
	if (insightCache.chart2) insightCache.chart2.destroy();

	const gradient = ctx.createLinearGradient(0, 0, 0, 340);
	gradient.addColorStop(0, "rgba(63,81,181,0.18)");
	gradient.addColorStop(1, "rgba(63,81,181,0)");

	insightCache.chart2 = new Chart(ctx, {
		type: "line",
		data: {
			labels,
			datasets: [{
				data: values,
				borderColor: CHART_COLORS.blue,
				backgroundColor: gradient,
				borderWidth: 2,
				pointBackgroundColor: CHART_COLORS.blue,
				pointRadius: 4,
				pointHoverRadius: 7,
				fill: true,
				tension: 0.35,
			}],
		},
		options: {
			...CHART_BASE,
			scales: {
				x: {
					grid: { color: "#eee" },
					ticks: { color: CHART_COLORS.muted },
					title: { display: true, text: "Year", color: CHART_COLORS.muted },
				},
				y: {
					grid: { color: "#eee" },
					ticks: { color: CHART_COLORS.muted },
					title: { display: true, text: "Average Grade", color: CHART_COLORS.muted },
				},
			},
			plugins: {
				...CHART_BASE.plugins,
				tooltip: {
					...CHART_BASE.plugins.tooltip,
					callbacks: {
						title: (items) => `Year ${items[0].label}`,
						label: (item) => `Avg grade: ${item.raw.toFixed(2)}`,
					},
				},
			},
		},
	});
}

// ── Insight 3: Grade Avg vs Fail Rate (scatter) ────────────────────────────

function buildInsight3() {
	// Aggregate per course (dept+code): avg grade & fail rate
	const courseTotals = {};
	for (const r of insightCache.allSections) {
		const key = `${r.dept}::${r.code}`;
		if (typeof r.year === "number" && r.year < 2000) continue; // skip 1900 "overall" rows
		if (!courseTotals[key]) courseTotals[key] = { dept: r.dept, code: r.code, sumAvg: 0, pass: 0, fail: 0, audit: 0, count: 0 };
		const c = courseTotals[key];
		if (typeof r.avg === "number") { c.sumAvg += r.avg; c.count++; }
		if (typeof r.pass === "number") c.pass += r.pass;
		if (typeof r.fail === "number") c.fail += r.fail;
		if (typeof r.audit === "number") c.audit += r.audit;
	}

	const courses = Object.values(courseTotals).map((c) => {
		const total = c.pass + c.fail + c.audit;
		const failRate = total > 0 ? Math.round((c.fail / total) * 1000) / 10 : 0;
		const avg = c.count > 0 ? Math.round((c.sumAvg / c.count) * 100) / 100 : 0;
		return { dept: c.dept, code: c.code, avg, failRate, total };
	});

	// Populate dept filter
	const select = byId("i3-dept");
	select.innerHTML = `<option value="all">All departments</option>`;
	const depts = [...new Set(courses.map((c) => c.dept))].sort();
	for (const d of depts) {
		const o = document.createElement("option");
		o.value = d; o.textContent = d.toUpperCase();
		select.appendChild(o);
	}

	const render = () => renderInsight3(courses);
	select.onchange = render;
	byId("i3-min").onchange = render;
	render();
}

function renderInsight3(courses) {
	const deptFilter = byId("i3-dept").value;
	const minEnroll = Number(byId("i3-min").value);

	let data = courses.filter((c) => c.total >= minEnroll);
	if (deptFilter !== "all") data = data.filter((c) => c.dept === deptFilter);

	const points = data.map((c) => ({ x: c.avg, y: c.failRate, dept: c.dept, code: c.code, total: c.total }));

	// Color: low fail = blue, high fail = red
	const maxFail = Math.max(...points.map((p) => p.y), 1);
	const bgColors = points.map((p) => {
		const t = p.y / maxFail;
		const r = Math.round(63  + (229 - 63) * t);
		const g = Math.round(81  + (57  - 81) * t);
		const b = Math.round(181 + (53  - 181) * t);
		return `rgba(${r},${g},${b},0.72)`;
	});

	const ctx = byId("chart-i3").getContext("2d");
	if (insightCache.chart3) insightCache.chart3.destroy();

	insightCache.chart3 = new Chart(ctx, {
		type: "scatter",
		data: {
			datasets: [{
				data: points,
				backgroundColor: bgColors,
				pointRadius: 5,
				pointHoverRadius: 8,
			}],
		},
		options: {
			...CHART_BASE,
			scales: {
				x: {
					grid: { color: "#eee" },
					ticks: { color: CHART_COLORS.muted },
					title: { display: true, text: "Average Grade", color: CHART_COLORS.muted },
				},
				y: {
					grid: { color: "#eee" },
					ticks: { color: CHART_COLORS.muted },
					title: { display: true, text: "Fail Rate (%)", color: CHART_COLORS.muted },
					min: 0,
				},
			},
			plugins: {
				...CHART_BASE.plugins,
				tooltip: {
					...CHART_BASE.plugins.tooltip,
					callbacks: {
						title: (items) => `${items[0].raw.dept.toUpperCase()} ${items[0].raw.code}`,
						label: (item) => [
							`Avg grade: ${item.raw.x.toFixed(2)}`,
							`Fail rate: ${item.raw.y}%`,
							`Total enrolled: ${item.raw.total}`,
						],
					},
				},
			},
		},
	});
}
