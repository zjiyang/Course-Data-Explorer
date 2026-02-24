import fs from "fs/promises";
import express from "express";
import cors from "cors";
import multer from "multer";
import JSZip from "jszip";

/**
 * Express application.
 */
export type Application = ReturnType<typeof express>;

/**
 * Configuration options for the application.
 */
export type AppConfig = {
	readonly datadir: string;
};

/**
 * Initializes the application.
 */
export async function createApp(config: AppConfig): Promise<Application> {
	const app = express();

	const { datadir } = config;

	await fs.mkdir(datadir, { recursive: true });

	const upload = multer({ storage: multer.memoryStorage() });

	app.use(express.static("frontend/public"));
	app.use(express.json());
	app.use(express.raw({ type: "application/*", limit: "10mb" }));
	app.use(cors());

	app.get("/api", (_req, res) => {
		res.send("App is running!");
	});

	// ----------------------------
	// Datasets
	// ----------------------------

	app.post("/api/v1/datasets", upload.single("archive"), async (req, res) => {
		const fields: Record<string, string> = {};

		const kind = req.body?.kind;
		if (kind === undefined) fields.kind = "required but missing";
		else if (kind !== "course_offerings") fields.kind = "expected to be course_offerings";

		if (!req.file) fields.archive = "required but missing";
		else if (!req.file.buffer || req.file.size === 0) fields.archive = "expected non-empty file";

		if (Object.keys(fields).length > 0) {
			res.status(422).send({ error: "Validation failed", fields });
			return;
		}

		const model = new Model(datadir);
		const id = `upload_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

		await model.createDatasetJob(id);

		res.status(202).send({
			id,
			status: "processing",
			kind: "course_offerings",
			message: "Dataset accepted for processing",
		});

		// async processing
		setImmediate(async () => {
			try {
				const zip = await JSZip.loadAsync(req.file!.buffer);
				const fileNames = Object.keys(zip.files);
				const hasCoursesDir =
					zip.files["courses/"]?.dir === true || fileNames.some((n) => n.startsWith("courses/") && n !== "courses/");

				if (!hasCoursesDir) {
					await model.failDatasetJob(id, "Missing root courses directory");
					return;
				}

				await model.processCourseOfferingsZip(id, zip);
			} catch {
				await model.failDatasetJob(id, "Data is not in a valid zip format");
			}
		});
	});

	app.get("/api/v1/datasets/:id", async (req, res) => {
		const model = new Model(datadir);
		const job = await model.getDatasetJob(req.params.id);
		if (!job) {
			res.status(404).send({ error: "Not found", message: `no dataset with id '${req.params.id}'` });
			return;
		}
		res.status(200).send(job);
	});

	// ----------------------------
	// Search
	// ----------------------------

	app.post("/api/v1/search", async (req, res) => {
		const fields: Record<string, string> = {};

		if (!req.body || typeof req.body !== "object" || req.body === null) {
			res.status(422).send({
				error: "Validation failed",
				fields: { kind: "required but missing", query: "required but missing" },
			});
			return;
		}

		if (req.body.kind === undefined) fields.kind = "required but missing";
		else if (req.body.kind !== "course_offerings") fields.kind = "expected to be course_offerings";

		if (req.body.query === undefined) fields.query = "required but missing";
		else if (typeof req.body.query !== "object" || req.body.query === null || Array.isArray(req.body.query)) {
			fields.query = "expected an object";
		}

		if (Object.keys(fields).length > 0) {
			res.status(422).send({ error: "Validation failed", fields });
			return;
		}

		const q = req.body.query;

		// 400: Missing WHERE
		if (q.WHERE === undefined) {
			res.status(400).send({ error: "Invalid query", message: "Missing WHERE" });
			return;
		}

		if (q.WHERE === null || typeof q.WHERE !== "object" || Array.isArray(q.WHERE) || Object.keys(q.WHERE).length > 1) {
			res.status(400).send({ error: "Invalid query", message: "WHERE must be an object with at most one FILTER" });
			return;
		}

		// Need OPTIONS
		if (q.OPTIONS === undefined) {
			res.status(400).send({ error: "Invalid query", message: "Missing OPTIONS" });
			return;
		}

		if (q.OPTIONS === null || typeof q.OPTIONS !== "object" || Array.isArray(q.OPTIONS)) {
			res
				.status(400)
				.send({ error: "Invalid query", message: "OPTIONS must be an object with COLUMNS and optional ORDER" });
			return;
		}

		// Need COLUMNS
		if (q.OPTIONS.COLUMNS === undefined) {
			res.status(400).send({ error: "Invalid query", message: "Missing COLUMNS" });
			return;
		}
		if (!Array.isArray(q.OPTIONS.COLUMNS) || q.OPTIONS.COLUMNS.length === 0) {
			res.status(400).send({ error: "Invalid query", message: "Missing COLUMNS" });
			return;
		}

		const allowedKeys = new Set(["avg", "pass", "fail", "audit", "year", "title", "dept", "code", "instructor"]);
		for (const k of q.OPTIONS.COLUMNS) {
			if (typeof k !== "string" || !allowedKeys.has(k)) {
				res.status(400).send({ error: "Invalid query", message: "Unknown key in COLUMNS" });
				return;
			}
		}

		// ORDER must be in COLUMNS (if present)
		if (q.OPTIONS.ORDER !== undefined) {
			if (typeof q.OPTIONS.ORDER !== "string" || !q.OPTIONS.COLUMNS.includes(q.OPTIONS.ORDER)) {
				res.status(400).send({ error: "Invalid query", message: "ORDER must be a key in COLUMNS" });
				return;
			}
		}

		const model = new Model(datadir);
		const results = await model.searchCourseOfferings(q);

		if (results.length > 5000) {
			res.status(413).send({
				error: "Too many results",
				message: "Query would return more than 5000 results",
				limit: 5000,
			});
			return;
		}

		res.status(200).send(results);
	});

	// ----------------------------
	// Courses (unchanged logic)
	// ----------------------------

	app.get("/api/v1/courses", async (req, res) => {
		const limitRaw = req.query.limit;
		const offsetRaw = req.query.offset;

		const limit = limitRaw === undefined ? 100 : Number(limitRaw);
		const offset = offsetRaw === undefined ? 0 : Number(offsetRaw);

		const params: Record<string, string> = {};
		if (!Number.isInteger(limit) || limit < 1 || limit > 5000) params.limit = "expected an integer between 1 and 5000";
		if (!Number.isInteger(offset) || offset < 0) params.offset = "expected an integer >= 0";

		if (Object.keys(params).length > 0) {
			res.status(400).send({ error: "Invalid request parameters", params });
			return;
		}

		const model = new Model(datadir);
		const all = await model.listCoursesSorted();
		const items = all.slice(offset, offset + limit).map((c) => ({
			id: c.id,
			title: c.title,
			dept: c.dept,
			code: c.code,
			links: {
				self: `/api/v1/courses/${c.id}`,
				sections: `/api/v1/courses/${c.id}/sections`,
			},
		}));

		res.status(200).send({ total: all.length, limit, offset, items });
	});

	app.get("/api/v1/courses/:course", async (req, res) => {
		const model = new Model(datadir);
		const course = await model.getCourse(req.params.course);

		if (!course) {
			res.status(404).send({ error: "Not found", message: `no course with id '${req.params.course}'` });
			return;
		}

		res.status(200).send({
			id: course.id,
			title: course.title,
			dept: course.dept,
			code: course.code,
			links: {
				self: `/api/v1/courses/${course.id}`,
				sections: `/api/v1/courses/${course.id}/sections`,
			},
		});
	});

	app.put("/api/v1/courses/:course", async (req, res) => {
		const fields: Record<string, string> = {};

		if (!req.body || typeof req.body !== "object" || req.body === null) {
			res.status(422).send({
				error: "Validation failed",
				fields: { title: "required but missing", dept: "required but missing", code: "required but missing" },
			});
			return;
		}

		if (req.body.title === undefined) fields.title = "required but missing";
		else if (typeof req.body.title !== "string") fields.title = "expected a string";

		if (req.body.dept === undefined) fields.dept = "required but missing";
		else if (typeof req.body.dept !== "string") fields.dept = "expected a string";

		if (req.body.code === undefined) fields.code = "required but missing";
		else if (typeof req.body.code !== "string") fields.code = "expected a string";

		if (Object.keys(fields).length > 0) {
			res.status(422).send({ error: "Validation failed", fields });
			return;
		}

		const model = new Model(datadir);
		const out = await model.setCourse(req.params.course, req.body.title, req.body.dept, req.body.code);

		if (out.created) {
			res.status(201).send({
				id: out.course.id,
				title: out.course.title,
				dept: out.course.dept,
				code: out.course.code,
				links: {
					self: `/api/v1/courses/${out.course.id}`,
					sections: `/api/v1/courses/${out.course.id}/sections`,
				},
			});
		} else {
			res.sendStatus(204);
		}
	});

	app.delete("/api/v1/courses/:course", async (req, res) => {
		const model = new Model(datadir);
		const out = await model.deleteCourse(req.params.course);

		if (!out.course) {
			res.status(404).send({ error: "Not found", message: `no course with id '${req.params.course}'` });
			return;
		}

		res.status(200).send({
			id: out.course.id,
			title: out.course.title,
			dept: out.course.dept,
			code: out.course.code,
			sections: out.removedSections,
		});
	});

	// ----------------------------
	// Sections (unchanged logic)
	// ----------------------------

	app.get("/api/v1/courses/:course/sections", async (req, res) => {
		const limitRaw = req.query.limit;
		const offsetRaw = req.query.offset;

		const limit = limitRaw === undefined ? 100 : Number(limitRaw);
		const offset = offsetRaw === undefined ? 0 : Number(offsetRaw);

		const params: Record<string, string> = {};
		if (!Number.isInteger(limit) || limit < 1 || limit > 5000) params.limit = "expected an integer between 1 and 5000";
		if (!Number.isInteger(offset) || offset < 0) params.offset = "expected an integer >= 0";

		if (Object.keys(params).length > 0) {
			res.status(400).send({ error: "Invalid request parameters", params });
			return;
		}

		const model = new Model(datadir);
		const list = await model.listSectionsSorted(req.params.course);
		if (list === "NO_COURSE") {
			res.status(404).send({ error: "Not found", message: `no course with id '${req.params.course}'` });
			return;
		}

		const items = list.slice(offset, offset + limit).map((s) => ({
			id: s.id,
			instructor: s.instructor,
			year: s.year,
			avg: s.avg,
			pass: s.pass,
			fail: s.fail,
			audit: s.audit,
			links: {
				self: `/api/v1/courses/${req.params.course}/sections/${s.id}`,
				course: `/api/v1/courses/${req.params.course}`,
			},
		}));

		res.status(200).send({ total: list.length, limit, offset, items });
	});

	app.get("/api/v1/courses/:course/sections/:section", async (req, res) => {
		const model = new Model(datadir);
		const sec = await model.getSection(req.params.course, req.params.section);

		if (sec === "NO_COURSE") {
			res.status(404).send({ error: "Not found", message: `no course with id '${req.params.course}'` });
			return;
		}
		if (!sec) {
			res.status(404).send({ error: "Not found", message: `no section with id '${req.params.section}'` });
			return;
		}

		res.status(200).send({
			id: sec.id,
			instructor: sec.instructor,
			year: sec.year,
			avg: sec.avg,
			pass: sec.pass,
			fail: sec.fail,
			audit: sec.audit,
			links: {
				self: `/api/v1/courses/${req.params.course}/sections/${sec.id}`,
				course: `/api/v1/courses/${req.params.course}`,
			},
		});
	});

	app.put("/api/v1/courses/:course/sections/:section", async (req, res) => {
		const fields: Record<string, string> = {};

		if (!req.body || typeof req.body !== "object" || req.body === null) {
			res.status(422).send({
				error: "Validation failed",
				fields: {
					instructor: "required but missing",
					year: "required but missing",
					avg: "required but missing",
					pass: "required but missing",
					fail: "required but missing",
					audit: "required but missing",
				},
			});
			return;
		}

		if (req.body.instructor === undefined) fields.instructor = "required but missing";
		else if (typeof req.body.instructor !== "string") fields.instructor = "expected a string";

		if (req.body.year === undefined) fields.year = "required but missing";
		else if (!Number.isInteger(req.body.year) || req.body.year < 1900 || req.body.year > 2099) {
			fields.year = "expected a number between 1900 and 2099";
		}

		if (req.body.avg === undefined) fields.avg = "required but missing";
		else if (typeof req.body.avg !== "number" || req.body.avg < 0 || req.body.avg > 100) {
			fields.avg = "expected a number between 0 and 100";
		}

		if (req.body.pass === undefined) fields.pass = "required but missing";
		else if (!Number.isInteger(req.body.pass) || req.body.pass < 0) fields.pass = "expected a number >= 0";

		if (req.body.fail === undefined) fields.fail = "required but missing";
		else if (!Number.isInteger(req.body.fail) || req.body.fail < 0) fields.fail = "expected a number >= 0";

		if (req.body.audit === undefined) fields.audit = "required but missing";
		else if (!Number.isInteger(req.body.audit) || req.body.audit < 0) fields.audit = "expected a number >= 0";

		if (Object.keys(fields).length > 0) {
			res.status(422).send({ error: "Validation failed", fields });
			return;
		}

		const model = new Model(datadir);
		const out = await model.setSection(req.params.course, req.params.section, {
			instructor: req.body.instructor,
			year: req.body.year,
			avg: req.body.avg,
			pass: req.body.pass,
			fail: req.body.fail,
			audit: req.body.audit,
		});

		if (out === "NO_COURSE") {
			res.status(404).send({ error: "Not found", message: `no course with id '${req.params.course}'` });
			return;
		}

		if (out.created) {
			res.status(201).send({
				id: out.section.id,
				instructor: out.section.instructor,
				year: out.section.year,
				avg: out.section.avg,
				pass: out.section.pass,
				fail: out.section.fail,
				audit: out.section.audit,
				links: {
					self: `/api/v1/courses/${req.params.course}/sections/${out.section.id}`,
					course: `/api/v1/courses/${req.params.course}`,
				},
			});
		} else {
			res.sendStatus(204);
		}
	});

	app.delete("/api/v1/courses/:course/sections/:section", async (req, res) => {
		const model = new Model(datadir);
		const out = await model.deleteSection(req.params.course, req.params.section);

		if (out === "NO_COURSE") {
			res.status(404).send({ error: "Not found", message: `no course with id '${req.params.course}'` });
			return;
		}
		if (!out) {
			res.status(404).send({ error: "Not found", message: `no section with id '${req.params.section}'` });
			return;
		}

		res.status(200).send({
			id: out.id,
			instructor: out.instructor,
			year: out.year,
			avg: out.avg,
			pass: out.pass,
			fail: out.fail,
			audit: out.audit,
		});
	});

	return app;
}

// ----------------------------
// Model (disk persistence)
// ----------------------------

type Course = { id: string; title: string; dept: string; code: string };
type Section = { id: string; instructor: string; year: number; avg: number; pass: number; fail: number; audit: number };

type UploadStats = {
	files_total: number;
	files_processed: number;
	files_skipped: number;
	courses_seen: number;
	courses_added: number;
	courses_modified: number;
	sections_seen: number;
	sections_added: number;
	sections_modified: number;
};

type DatasetJob = {
	id: string;
	status: "processing" | "completed" | "failed";
	kind: "course_offerings";
	stats: UploadStats;
	message:
		| "Processing in progress"
		| "Dataset processing complete"
		| "Data is not in a valid zip format"
		| "Missing root courses directory";
};

type Db = {
	courses: Record<string, Course>;
	sections: Record<string, Record<string, Section>>;
	datasets: Record<string, DatasetJob>;
};

class Model {
	private file: string;
	private data: Db = { courses: {}, sections: {}, datasets: {} };

	constructor(datadir: string) {
		this.file = `${datadir}/db.json`;
	}

	private async load(): Promise<void> {
		try {
			const txt = await fs.readFile(this.file, "utf-8");
			this.data = JSON.parse(txt) as Db;
		} catch {
			this.data = { courses: {}, sections: {}, datasets: {} };
		}
	}

	private async save(): Promise<void> {
		await fs.writeFile(this.file, JSON.stringify(this.data, null, 2), "utf-8");
	}

	// ---------- courses ----------
	async listCoursesSorted(): Promise<Course[]> {
		await this.load();
		return Object.values(this.data.courses).sort((a, b) => a.id.localeCompare(b.id));
	}

	async getCourse(courseId: string): Promise<Course | undefined> {
		await this.load();
		return this.data.courses[courseId];
	}

	async setCourse(
		courseId: string,
		title: string,
		dept: string,
		code: string
	): Promise<{ created: boolean; course: Course }> {
		await this.load();
		const existed = !!this.data.courses[courseId];

		const course: Course = { id: courseId, title, dept, code };
		this.data.courses[courseId] = course;
		if (!this.data.sections[courseId]) this.data.sections[courseId] = {};

		await this.save();
		return { created: !existed, course };
	}

	async deleteCourse(courseId: string): Promise<{ course?: Course; removedSections: number }> {
		await this.load();
		const course = this.data.courses[courseId];
		if (!course) return { removedSections: 0 };

		const removedSections = this.data.sections[courseId] ? Object.keys(this.data.sections[courseId]).length : 0;
		delete this.data.courses[courseId];
		delete this.data.sections[courseId];

		await this.save();
		return { course, removedSections };
	}

	// ---------- sections ----------
	async listSectionsSorted(courseId: string): Promise<Section[] | "NO_COURSE"> {
		await this.load();
		if (!this.data.courses[courseId]) return "NO_COURSE";
		const map = this.data.sections[courseId] ?? {};
		return Object.values(map).sort((a, b) => a.id.localeCompare(b.id));
	}

	async getSection(courseId: string, sectionId: string): Promise<Section | "NO_COURSE" | undefined> {
		await this.load();
		if (!this.data.courses[courseId]) return "NO_COURSE";
		return this.data.sections[courseId]?.[sectionId];
	}

	async setSection(
		courseId: string,
		sectionId: string,
		payload: Omit<Section, "id">
	): Promise<{ created: boolean; section: Section } | "NO_COURSE"> {
		await this.load();
		if (!this.data.courses[courseId]) return "NO_COURSE";
		if (!this.data.sections[courseId]) this.data.sections[courseId] = {};

		const existed = !!this.data.sections[courseId][sectionId];
		const section: Section = { id: sectionId, ...payload };
		this.data.sections[courseId][sectionId] = section;

		await this.save();
		return { created: !existed, section };
	}

	async deleteSection(courseId: string, sectionId: string): Promise<Section | "NO_COURSE" | undefined> {
		await this.load();
		if (!this.data.courses[courseId]) return "NO_COURSE";

		const section = this.data.sections[courseId]?.[sectionId];
		if (!section) return undefined;

		delete this.data.sections[courseId][sectionId];
		await this.save();
		return section;
	}

	// ---------- datasets ----------
	private emptyStats(): UploadStats {
		return {
			files_total: 0,
			files_processed: 0,
			files_skipped: 0,
			courses_seen: 0,
			courses_added: 0,
			courses_modified: 0,
			sections_seen: 0,
			sections_added: 0,
			sections_modified: 0,
		};
	}

	async createDatasetJob(id: string): Promise<void> {
		await this.load();
		this.data.datasets[id] = {
			id,
			status: "processing",
			kind: "course_offerings",
			stats: this.emptyStats(),
			message: "Processing in progress",
		};
		await this.save();
	}

	async getDatasetJob(id: string): Promise<DatasetJob | undefined> {
		await this.load();
		return this.data.datasets[id];
	}

	async failDatasetJob(id: string, message: DatasetJob["message"]): Promise<void> {
		await this.load();
		const job = this.data.datasets[id];
		if (!job) return;
		job.status = "failed";
		job.message = message;
		job.stats = this.emptyStats();
		await this.save();
	}

	private async completeDatasetJob(id: string, stats: UploadStats): Promise<void> {
		await this.load();
		const job = this.data.datasets[id];
		if (!job) return;
		job.status = "completed";
		job.message = "Dataset processing complete";
		job.stats = stats;
		await this.save();
	}

	async processCourseOfferingsZip(id: string, zip: JSZip): Promise<void> {
		await this.load();
		const job = this.data.datasets[id];
		if (!job) return;

		const stats = this.emptyStats();

		const courseFiles = Object.keys(zip.files).filter((n) => n.startsWith("courses/") && !zip.files[n].dir);
		stats.files_total = courseFiles.length;

		type Offering = {
			id: string;
			Course: string;
			Title: string;
			Professor: string;
			Subject: string;
			Section: string;
			Year: string;
			Avg: number;
			Pass: number;
			Fail: number;
			Audit: number;
		};

		const offerings: Offering[] = [];

		const maxYear: Record<string, number> = {};
		const maxTitle: Record<string, string> = {};
		const deptByCourse: Record<string, string> = {};
		const codeByCourse: Record<string, string> = {};

		const toNum = (x: any): number | null => {
			const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN;
			return Number.isFinite(n) ? n : null;
		};

		for (const fname of courseFiles) {
			let text: string;
			try {
				text = await zip.files[fname].async("text");
			} catch {
				stats.files_skipped++;
				continue;
			}

			let obj: any;
			try {
				obj = JSON.parse(text);
			} catch {
				stats.files_skipped++;
				continue;
			}

			if (!obj || typeof obj !== "object" || !Array.isArray(obj.result)) {
				stats.files_skipped++;
				continue;
			}

			stats.files_processed++;

			for (const r of obj.result) {
				if (
					!r ||
					typeof r !== "object" ||
					typeof r.id !== "string" ||
					typeof r.Course !== "string" ||
					typeof r.Title !== "string" ||
					typeof r.Professor !== "string" ||
					typeof r.Subject !== "string" ||
					typeof r.Section !== "string" ||
					typeof r.Year !== "string"
				) {
					continue;
				}

				const yearNum = toNum(r.Year);
				const avgNum = toNum(r.Avg);
				const passNum = toNum(r.Pass);
				const failNum = toNum(r.Fail);
				const auditNum = toNum(r.Audit);

				if (yearNum === null || avgNum === null || passNum === null || failNum === null || auditNum === null) {
					continue;
				}
				if (!Number.isInteger(passNum) || !Number.isInteger(failNum) || !Number.isInteger(auditNum)) {
					continue;
				}

				const normalized: Offering = {
					id: r.id,
					Course: r.Course,
					Title: r.Title,
					Professor: r.Professor,
					Subject: r.Subject,
					Section: r.Section,
					Year: r.Year,
					Avg: avgNum,
					Pass: passNum,
					Fail: failNum,
					Audit: auditNum,
				};

				const courseId = `${normalized.Subject}${normalized.Course}`;

				deptByCourse[courseId] = normalized.Subject;
				codeByCourse[courseId] = normalized.Course;

				if (maxYear[courseId] === undefined || yearNum > maxYear[courseId]) {
					maxYear[courseId] = yearNum;
					maxTitle[courseId] = normalized.Title;
				}

				offerings.push(normalized);
			}
		}

		for (const courseId of Object.keys(deptByCourse)) {
			stats.courses_seen++;

			const desired: Course = {
				id: courseId,
				dept: deptByCourse[courseId],
				code: codeByCourse[courseId],
				title: maxTitle[courseId] ?? "",
			};

			const existing = this.data.courses[courseId];
			if (!existing) {
				this.data.courses[courseId] = desired;
				if (!this.data.sections[courseId]) this.data.sections[courseId] = {};
				stats.courses_added++;
			} else {
				const changed =
					existing.dept !== desired.dept || existing.code !== desired.code || existing.title !== desired.title;
				if (changed) {
					this.data.courses[courseId] = desired;
					stats.courses_modified++;
				}
				if (!this.data.sections[courseId]) this.data.sections[courseId] = {};
			}
		}

		for (const r of offerings) {
			const courseId = `${r.Subject}${r.Course}`;
			if (!this.data.courses[courseId]) continue;

			stats.sections_seen++;

			const sectionId = r.id;
			const secMap = this.data.sections[courseId] ?? {};
			const existingSec = secMap[sectionId];

			const yearNum = Number(r.Year);
			const sectionYear = r.Section === "overall" ? 1900 : yearNum;

			const desiredSec: Section = {
				id: sectionId,
				instructor: r.Professor,
				year: sectionYear,
				avg: r.Avg,
				pass: r.Pass,
				fail: r.Fail,
				audit: r.Audit,
			};

			if (!existingSec) {
				secMap[sectionId] = desiredSec;
				this.data.sections[courseId] = secMap;
				stats.sections_added++;
			} else {
				const changed =
					existingSec.instructor !== desiredSec.instructor ||
					existingSec.year !== desiredSec.year ||
					existingSec.avg !== desiredSec.avg ||
					existingSec.pass !== desiredSec.pass ||
					existingSec.fail !== desiredSec.fail ||
					existingSec.audit !== desiredSec.audit;

				if (changed) {
					secMap[sectionId] = desiredSec;
					stats.sections_modified++;
				}
			}
		}

		await this.save();
		await this.completeDatasetJob(id, stats);
	}

	// ---------- search ----------
	private buildAllOfferings(): Array<Record<string, any>> {
		const out: Array<Record<string, any>> = [];
		for (const courseId of Object.keys(this.data.courses)) {
			const c = this.data.courses[courseId];
			const secMap = this.data.sections[courseId] ?? {};
			for (const secId of Object.keys(secMap)) {
				const s = secMap[secId];
				out.push({
					title: c.title,
					dept: c.dept,
					code: c.code,
					instructor: s.instructor,
					year: s.year,
					avg: s.avg,
					pass: s.pass,
					fail: s.fail,
					audit: s.audit,
				});
			}
		}
		return out;
	}

	private matchIs(value: string, pattern: string): boolean {
		if (pattern.startsWith("*") && pattern.endsWith("*") && pattern.length >= 2) {
			const mid = pattern.slice(1, -1);
			return value.includes(mid);
		}
		if (pattern.startsWith("*")) return value.endsWith(pattern.slice(1));
		if (pattern.endsWith("*")) return value.startsWith(pattern.slice(0, -1));
		return value === pattern;
	}

	private applyWhere(records: any[], where: any): any[] {
		if (where === undefined) return [];
		if (where === null || typeof where !== "object" || Array.isArray(where)) return [];

		const keys = Object.keys(where);
		if (keys.length === 0) return records;
		if (keys.length > 1) return [];

		const op = keys[0];
		const body = where[op];

		const keyOf = (r: any) => JSON.stringify(r);

		if (op === "AND" || op === "OR") {
			if (!Array.isArray(body) || body.length === 0) return [];
			const parts = body.map((sub) => this.applyWhere(records, sub));

			if (op === "AND") {
				let set = new Set(parts[0].map(keyOf));
				for (let i = 1; i < parts.length; i++) {
					const next = new Set(parts[i].map(keyOf));
					set = new Set([...set].filter((k) => next.has(k)));
				}
				return records.filter((r) => set.has(keyOf(r)));
			} else {
				const set = new Set<string>();
				for (const p of parts) for (const r of p) set.add(keyOf(r));
				return records.filter((r) => set.has(keyOf(r)));
			}
		}

		if (op === "NOT") {
			const neg = this.applyWhere(records, body);
			const negSet = new Set(neg.map(keyOf));
			return records.filter((r) => !negSet.has(keyOf(r)));
		}

		if (op === "GT" || op === "LT" || op === "EQ") {
			if (!body || typeof body !== "object" || Array.isArray(body)) return [];
			const ks = Object.keys(body);
			if (ks.length !== 1) return [];
			const k = ks[0];
			const v = body[k];
			if (typeof v !== "number") return [];
			return records.filter((r) => {
				const x = r[k];
				if (typeof x !== "number") return false;
				if (op === "GT") return x > v;
				if (op === "LT") return x < v;
				return x === v;
			});
		}

		if (op === "IS") {
			if (!body || typeof body !== "object" || Array.isArray(body)) return [];
			const ks = Object.keys(body);
			if (ks.length !== 1) return [];
			const k = ks[0];
			const v = body[k];
			if (typeof v !== "string") return [];
			return records.filter((r) => typeof r[k] === "string" && this.matchIs(r[k], v));
		}

		return [];
	}

	async searchCourseOfferings(queryObj: any): Promise<any[]> {
		await this.load();

		const where = queryObj.WHERE;
		const columns: string[] = queryObj.OPTIONS.COLUMNS;
		const order: string | undefined = queryObj.OPTIONS.ORDER;

		let records = this.buildAllOfferings();
		records = this.applyWhere(records, where);

		let projected = records.map((r) => {
			const o: any = {};
			for (const c of columns) o[c] = r[c];
			return o;
		});

		if (order) {
			projected = projected.sort((a, b) => {
				const va = a[order];
				const vb = b[order];
				if (va === vb) return 0;
				return va < vb ? -1 : 1;
			});
		}

		return projected;
	}
}
