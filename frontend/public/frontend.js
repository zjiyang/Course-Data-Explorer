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
	return refreshTable();
}

async function initFromServer() {
	setText("table-meta", "Upload a dataset to begin.");
	renderRows([]);
	await loadDeptOptionsFromCourses();
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