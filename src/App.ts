import fs from "fs/promises";
import express from "express";
import cors from "cors";
import multer from "multer";
import JSZip from "jszip";
import Decimal from "decimal.js";

export type Application = ReturnType<typeof express>;

export type AppConfig = {
	readonly datadir: string;
};

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

	// =====================================================================
	// V1 (kept as-is in behavior)
	// =====================================================================

	app.post("/api/v1/datasets", upload.single("archive"), async (req, res) => {
		const fields: Record<string, string> = {};

		const kind = req.body?.kind;
		if (kind === undefined) fields.kind = "required but missing";
		else if (kind !== "course_offerings") fields.kind = "expected to be course_offerings";

		const file = req.file;
		if (!file) fields.archive = "required but missing";
		else if (!file.buffer || file.size === 0) fields.archive = "expected non-empty file";

		if (Object.keys(fields).length > 0) {
			res.status(422).send({ error: "Validation failed", fields });
			return;
		}

		const buf = file!.buffer;

		const model = new Model(datadir);
		const id = `upload_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

		await model.createDatasetJob(id, "course_offerings");

		res.status(202).send({
			id,
			status: "processing",
			kind: "course_offerings",
			message: "Dataset accepted for processing",
		});

		setImmediate(async () => {
			try {
				const zip = await JSZip.loadAsync(buf);
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
		const v = validateSearchQuery(q);
		if (!v.ok) {
			res.status(400).send({ error: "Invalid query", message: v.message });
			return;
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

	// =====================================================================
	// V2 datasets
	// =====================================================================

	app.post("/api/v2/datasets", upload.single("archive"), async (req, res) => {
		const fields: Record<string, string> = {};

		const kind = req.body?.kind;
		if (kind === undefined) {
			fields.kind = "required but missing";
		} else if (typeof kind !== "string") {
			fields.kind = "expected a string";
		} else if (kind !== "course_offerings" && kind !== "facilities") {
			fields.kind = "expected to be course_offerings or facilities";
		}

		const file = req.file;
		if (!file) fields.archive = "required but missing";
		else if (!file.buffer || file.size === 0) fields.archive = "expected non-empty file";

		if (Object.keys(fields).length > 0) {
			res.status(422).send({ error: "Validation failed", fields });
			return;
		}

		const datasetKind = kind as DatasetKind;
		const buf = file!.buffer;

		const model = new Model(datadir);
		const id = `upload_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

		await model.createDatasetJob(id, datasetKind);

		res.status(202).send({
			id,
			status: "processing",
			kind: datasetKind,
			message: "Dataset accepted for processing",
		});

		setImmediate(async () => {
			let zip: JSZip;

			// Step 1: Validate ZIP format exclusively
			try {
				zip = await JSZip.loadAsync(buf);
			} catch {
				await model.failDatasetJob(id, "Data is not in a valid zip format");
				return;
			}

			// Step 2: Process contents (safely catch unexpected parse errors)
			try {
				if (datasetKind === "course_offerings") {
					const fileNames = Object.keys(zip.files);
					const hasCoursesDir =
						zip.files["courses/"]?.dir === true || fileNames.some((n) => n.startsWith("courses/") && n !== "courses/");

					if (!hasCoursesDir) {
						await model.failDatasetJob(id, "Missing root courses directory");
						return;
					}

					await model.processCourseOfferingsZip(id, zip);
					return;
				}

				await model.processFacilitiesZip(id, zip);
			} catch (err) {
				console.error("Dataset processing error:", err);
				// A fallback for unexpected processing errors so it doesn't falsely blame the zip format
				await model.failDatasetJob(id, "Processing failed" as any);
			}
		});
	});

	app.get("/api/v2/datasets/:id", async (req, res) => {
		const model = new Model(datadir);
		const job = await model.getDatasetJob(req.params.id);
		if (!job) {
			res.status(404).send({ error: "Not found", message: `no dataset with id '${req.params.id}'` });
			return;
		}
		res.status(200).send(job);
	});

	// =====================================================================
	// V2 search
	// =====================================================================

	app.post("/api/v2/search", async (req, res) => {
		const fields: Record<string, string> = {};

		if (!req.body || typeof req.body !== "object" || req.body === null) {
			res.status(422).send({
				error: "Validation failed",
				fields: { kind: "required but missing", query: "required but missing" },
			});
			return;
		}

		if (req.body.kind === undefined) fields.kind = "required but missing";
		else if (req.body.kind !== "course_offerings" && req.body.kind !== "facilities") {
			fields.kind = "expected to be course_offerings or facilities";
		}

		if (req.body.query === undefined) fields.query = "required but missing";
		else if (typeof req.body.query !== "object" || req.body.query === null || Array.isArray(req.body.query)) {
			fields.query = "expected an object";
		}

		if (Object.keys(fields).length > 0) {
			res.status(422).send({ error: "Validation failed", fields });
			return;
		}

		const kind = req.body.kind as DatasetKind;
		const q = req.body.query;

		const v = validateSearchQueryV2(q, kind);
		if (!v.ok) {
			res.status(400).send({ error: "Invalid query", message: v.message });
			return;
		}

		const model = new Model(datadir);
		const results = await model.searchV2(kind, q);

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

	// =====================================================================
	// V2 buildings
	// =====================================================================

	app.get("/api/v2/buildings", async (req, res) => {
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
		const all = await model.listBuildingsSorted();
		const items = all.slice(offset, offset + limit).map((b) => ({
			id: b.id,
			name: b.name,
			address: b.address,
			lat: b.lat,
			lon: b.lon,
			links: {
				self: `/api/v2/buildings/${b.id}`,
				rooms: `/api/v2/buildings/${b.id}/rooms`,
			},
		}));

		res.status(200).send({ total: all.length, limit, offset, items });
	});

	app.get("/api/v2/buildings/:building", async (req, res) => {
		const model = new Model(datadir);
		const building = await model.getBuilding(req.params.building);

		if (!building) {
			res.status(404).send({ error: "Not found", message: `no building with id '${req.params.building}'` });
			return;
		}

		res.status(200).send({
			id: building.id,
			name: building.name,
			address: building.address,
			lat: building.lat,
			lon: building.lon,
			links: {
				self: `/api/v2/buildings/${building.id}`,
				rooms: `/api/v2/buildings/${building.id}/rooms`,
			},
		});
	});

	app.put("/api/v2/buildings/:building", async (req, res) => {
		const fields: Record<string, string> = {};

		if (!req.body || typeof req.body !== "object" || req.body === null) {
			res.status(422).send({
				error: "Validation failed",
				fields: {
					name: "required but missing",
					address: "required but missing",
					lat: "required but missing",
					lon: "required but missing",
				},
			});
			return;
		}

		if (req.body.name === undefined) fields.name = "required but missing";
		else if (typeof req.body.name !== "string" || req.body.name.trim().length === 0) {
			fields.name = "expected a non-empty string";
		}

		if (req.body.address === undefined) fields.address = "required but missing";
		else if (typeof req.body.address !== "string" || req.body.address.trim().length === 0) {
			fields.address = "expected a non-empty string";
		}

		if (req.body.lat === undefined) fields.lat = "required but missing";
		else if (typeof req.body.lat !== "number") fields.lat = "expected a number";

		if (req.body.lon === undefined) fields.lon = "required but missing";
		else if (typeof req.body.lon !== "number") fields.lon = "expected a number";

		if (Object.keys(fields).length > 0) {
			res.status(422).send({ error: "Validation failed", fields });
			return;
		}

		const model = new Model(datadir);
		const out = await model.setBuilding(
			req.params.building,
			req.body.name.trim(),
			req.body.address.trim(),
			req.body.lat,
			req.body.lon
		);

		if (out.created) {
			res.status(201).send({
				id: out.building.id,
				name: out.building.name,
				address: out.building.address,
				lat: out.building.lat,
				lon: out.building.lon,
				links: {
					self: `/api/v2/buildings/${out.building.id}`,
					rooms: `/api/v2/buildings/${out.building.id}/rooms`,
				},
			});
		} else {
			res.sendStatus(204);
		}
	});

	app.delete("/api/v2/buildings/:building", async (req, res) => {
		const model = new Model(datadir);
		const out = await model.deleteBuilding(req.params.building);

		if (!out.building) {
			res.status(404).send({ error: "Not found", message: `no building with id '${req.params.building}'` });
			return;
		}

		res.status(200).send({
			id: out.building.id,
			name: out.building.name,
			address: out.building.address,
			lat: out.building.lat,
			lon: out.building.lon,
			rooms: out.removedRooms,
		});
	});

	// =====================================================================
	// V2 rooms
	// =====================================================================

	app.get("/api/v2/buildings/:building/rooms", async (req, res) => {
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
		const list = await model.listRoomsSorted(req.params.building);
		if (list === "NO_BUILDING") {
			res.status(404).send({ error: "Not found", message: `no building with id '${req.params.building}'` });
			return;
		}

		const items = list.slice(offset, offset + limit).map((r) => ({
			id: r.id,
			building: r.building,
			number: r.number,
			type: r.type,
			furniture: r.furniture,
			href: r.href,
			seats: r.seats,
			links: {
				self: `/api/v2/buildings/${req.params.building}/rooms/${r.id}`,
				building: `/api/v2/buildings/${req.params.building}`,
			},
		}));

		res.status(200).send({ total: list.length, limit, offset, items });
	});

	app.get("/api/v2/buildings/:building/rooms/:room", async (req, res) => {
		const model = new Model(datadir);
		const room = await model.getRoom(req.params.building, req.params.room);

		if (room === "NO_BUILDING") {
			res.status(404).send({ error: "Not found", message: `no building with id '${req.params.building}'` });
			return;
		}
		if (!room) {
			res.status(404).send({ error: "Not found", message: `no room with id '${req.params.room}'` });
			return;
		}

		res.status(200).send({
			id: room.id,
			building: room.building,
			number: room.number,
			type: room.type,
			furniture: room.furniture,
			href: room.href,
			seats: room.seats,
			links: {
				self: `/api/v2/buildings/${req.params.building}/rooms/${room.id}`,
				building: `/api/v2/buildings/${req.params.building}`,
			},
		});
	});

	app.put("/api/v2/buildings/:building/rooms/:room", async (req, res) => {
		const fields: Record<string, string> = {};

		if (!req.body || typeof req.body !== "object" || req.body === null || Array.isArray(req.body)) {
			res.status(422).send({
				error: "Validation failed",
				fields: {
					building: "required but missing",
					number: "required but missing",
					type: "required but missing",
					furniture: "required but missing",
					href: "required but missing",
					seats: "required but missing",
				},
			});
			return;
		}

		if (req.body.building === undefined) fields.building = "required but missing";
		else if (typeof req.body.building !== "string") fields.building = "expected a string";

		if (req.body.number === undefined) fields.number = "required but missing";
		else if (typeof req.body.number !== "string") fields.number = "expected a string";

		if (req.body.type === undefined) fields.type = "required but missing";
		else if (typeof req.body.type !== "string") fields.type = "expected a string";

		if (req.body.furniture === undefined) fields.furniture = "required but missing";
		else if (typeof req.body.furniture !== "string") fields.furniture = "expected a string";

		if (req.body.href === undefined) fields.href = "required but missing";
		else if (typeof req.body.href !== "string") fields.href = "expected a string";

		if (req.body.seats === undefined) fields.seats = "required but missing";
		else if (!Number.isInteger(req.body.seats) || req.body.seats < 0) {
			fields.seats = "expected a number >= 0";
		}

		if (req.body.building !== undefined && typeof req.body.building === "string") {
			if (req.body.building !== req.params.building) {
				fields.building = "must match parent building in path";
			}
		}

		if (Object.keys(fields).length > 0) {
			res.status(422).send({ error: "Validation failed", fields });
			return;
		}

		const model = new Model(datadir);
		const out = await model.setRoom(req.params.building, req.params.room, {
			building: req.body.building,
			number: req.body.number,
			type: req.body.type,
			furniture: req.body.furniture,
			href: req.body.href,
			seats: req.body.seats,
		});

		if (out === "NO_BUILDING") {
			res.status(404).send({ error: "Not found", message: `no building with id '${req.params.building}'` });
			return;
		}

		if (out.created) {
			res.status(201).send({
				id: out.room.id,
				building: out.room.building,
				number: out.room.number,
				type: out.room.type,
				furniture: out.room.furniture,
				href: out.room.href,
				seats: out.room.seats,
				links: {
					self: `/api/v2/buildings/${req.params.building}/rooms/${out.room.id}`,
					building: `/api/v2/buildings/${req.params.building}`,
				},
			});
		} else {
			res.sendStatus(204);
		}
	});

	app.delete("/api/v2/buildings/:building/rooms/:room", async (req, res) => {
		const model = new Model(datadir);
		const out = await model.deleteRoom(req.params.building, req.params.room);

		if (out === "NO_BUILDING") {
			res.status(404).send({ error: "Not found", message: `no building with id '${req.params.building}'` });
			return;
		}
		if (!out) {
			res.status(404).send({ error: "Not found", message: `no room with id '${req.params.room}'` });
			return;
		}

		res.status(200).send({
			id: out.id,
			building: out.building,
			number: out.number,
			type: out.type,
			furniture: out.furniture,
			href: out.href,
			seats: out.seats,
		});
	});

	return app;
}

type Course = { id: string; title: string; dept: string; code: string };
type Section = { id: string; instructor: string; year: number; avg: number; pass: number; fail: number; audit: number };

type Building = { id: string; name: string; address: string; lat: number; lon: number };
type Room = {
	id: string;
	building: string;
	number: string;
	type: string;
	furniture: string;
	href: string;
	seats: number;
};

type CourseUploadStats = {
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

type FacilitiesUploadStats = {
	buildings_added: number;
	buildings_modified: number;
	rooms_added: number;
	rooms_modified: number;
};

type UploadStats = CourseUploadStats | FacilitiesUploadStats;

type DatasetKind = "course_offerings" | "facilities";

type DatasetJob = {
	id: string;
	status: "processing" | "completed" | "failed";
	kind: DatasetKind;
	stats: UploadStats;
	message:
		| "Processing in progress"
		| "Dataset processing complete"
		| "Data is not in a valid zip format"
		| "Missing root courses directory"
		| "Missing index.htm file"
		| "index.htm could not be parsed"
		| "No building table found in index.htm";
};

type Db = {
	courses: Record<string, Course>;
	sections: Record<string, Record<string, Section>>;
	buildings: Record<string, Building>;
	rooms: Record<string, Record<string, Room>>;
	datasets: Record<string, DatasetJob>;
};

class Model {
	private file: string;
	private data: Db = { courses: {}, sections: {}, buildings: {}, rooms: {}, datasets: {} };

	constructor(datadir: string) {
		this.file = `${datadir}/db.json`;
	}

	private async load(): Promise<void> {
		try {
			const txt = await fs.readFile(this.file, "utf-8");
			const parsed = JSON.parse(txt) as Partial<Db>;
			this.data = {
				courses: parsed.courses ?? {},
				sections: parsed.sections ?? {},
				buildings: parsed.buildings ?? {},
				rooms: parsed.rooms ?? {},
				datasets: parsed.datasets ?? {},
			};
		} catch {
			this.data = { courses: {}, sections: {}, buildings: {}, rooms: {}, datasets: {} };
		}
	}

	private async save(): Promise<void> {
		await fs.writeFile(this.file, JSON.stringify(this.data, null, 2), "utf-8");
	}

	// ============================================================
	// v1 course/section model (kept)
	// ============================================================

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

	// ============================================================
	// v2 building/room model
	// ============================================================

	async listBuildingsSorted(): Promise<Building[]> {
		await this.load();
		return Object.values(this.data.buildings).sort((a, b) => a.id.localeCompare(b.id));
	}

	async getBuilding(buildingId: string): Promise<Building | undefined> {
		await this.load();
		return this.data.buildings[buildingId];
	}

	async setBuilding(
		buildingId: string,
		name: string,
		address: string,
		lat: number,
		lon: number
	): Promise<{ created: boolean; building: Building }> {
		await this.load();
		const existed = !!this.data.buildings[buildingId];

		const building: Building = { id: buildingId, name, address, lat, lon };
		this.data.buildings[buildingId] = building;
		if (!this.data.rooms[buildingId]) this.data.rooms[buildingId] = {};

		await this.save();
		return { created: !existed, building };
	}

	async deleteBuilding(buildingId: string): Promise<{ building?: Building; removedRooms: number }> {
		await this.load();
		const building = this.data.buildings[buildingId];
		if (!building) return { removedRooms: 0 };

		const removedRooms = this.data.rooms[buildingId] ? Object.keys(this.data.rooms[buildingId]).length : 0;
		delete this.data.buildings[buildingId];
		delete this.data.rooms[buildingId];

		await this.save();
		return { building, removedRooms };
	}

	async listRoomsSorted(buildingId: string): Promise<Room[] | "NO_BUILDING"> {
		await this.load();
		if (!this.data.buildings[buildingId]) return "NO_BUILDING";
		const map = this.data.rooms[buildingId] ?? {};
		return Object.values(map).sort((a, b) => a.id.localeCompare(b.id));
	}

	async getRoom(buildingId: string, roomId: string): Promise<Room | "NO_BUILDING" | undefined> {
		await this.load();
		if (!this.data.buildings[buildingId]) return "NO_BUILDING";
		return this.data.rooms[buildingId]?.[roomId];
	}

	async setRoom(
		buildingId: string,
		roomId: string,
		payload: Omit<Room, "id">
	): Promise<{ created: boolean; room: Room } | "NO_BUILDING"> {
		await this.load();
		if (!this.data.buildings[buildingId]) return "NO_BUILDING";
		if (!this.data.rooms[buildingId]) this.data.rooms[buildingId] = {};

		const existed = !!this.data.rooms[buildingId][roomId];
		const room: Room = { id: roomId, ...payload };
		this.data.rooms[buildingId][roomId] = room;

		await this.save();
		return { created: !existed, room };
	}

	async deleteRoom(buildingId: string, roomId: string): Promise<Room | "NO_BUILDING" | undefined> {
		await this.load();
		if (!this.data.buildings[buildingId]) return "NO_BUILDING";

		const room = this.data.rooms[buildingId]?.[roomId];
		if (!room) return undefined;

		delete this.data.rooms[buildingId][roomId];
		await this.save();
		return room;
	}

	private upsertBuildingInMemory(
		buildingId: string,
		name: string,
		address: string,
		lat: number,
		lon: number
	): { existed: boolean; changed: boolean } {
		const existing = this.data.buildings[buildingId];

		const next: Building = {
			id: buildingId,
			name,
			address,
			lat,
			lon,
		};

		if (!existing) {
			this.data.buildings[buildingId] = next;
			if (!this.data.rooms[buildingId]) {
				this.data.rooms[buildingId] = {};
			}
			return { existed: false, changed: true };
		}

		const changed =
			existing.name !== next.name ||
			existing.address !== next.address ||
			existing.lat !== next.lat ||
			existing.lon !== next.lon;

		if (changed) {
			this.data.buildings[buildingId] = next;
		}
		if (!this.data.rooms[buildingId]) {
			this.data.rooms[buildingId] = {};
		}
		return { existed: true, changed };
	}

	private upsertRoomInMemory(
		buildingId: string,
		roomId: string,
		payload: Omit<Room, "id">
	): { existed: boolean; changed: boolean } {
		if (!this.data.rooms[buildingId]) {
			this.data.rooms[buildingId] = {};
		}

		const existing = this.data.rooms[buildingId][roomId];
		const next: Room = {
			id: roomId,
			...payload,
		};

		if (!existing) {
			this.data.rooms[buildingId][roomId] = next;
			return { existed: false, changed: true };
		}

		const changed =
			existing.building !== next.building ||
			existing.number !== next.number ||
			existing.type !== next.type ||
			existing.furniture !== next.furniture ||
			existing.href !== next.href ||
			existing.seats !== next.seats;

		if (changed) {
			this.data.rooms[buildingId][roomId] = next;
		}

		return { existed: true, changed };
	}

	// ============================================================
	// dataset jobs
	// ============================================================

	private emptyCourseStats(): CourseUploadStats {
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

	private emptyFacilitiesStats(): FacilitiesUploadStats {
		return {
			buildings_added: 0,
			buildings_modified: 0,
			rooms_added: 0,
			rooms_modified: 0,
		};
	}

	private emptyStatsForKind(kind: DatasetKind): UploadStats {
		return kind === "course_offerings" ? this.emptyCourseStats() : this.emptyFacilitiesStats();
	}

	async createDatasetJob(id: string, kind: DatasetKind = "course_offerings"): Promise<void> {
		await this.load();
		this.data.datasets[id] = {
			id,
			status: "processing",
			kind,
			stats: this.emptyStatsForKind(kind),
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
		job.stats = this.emptyStatsForKind(job.kind);
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

		const stats = this.emptyCourseStats();

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
					typeof r.Course !== "string" ||
					typeof r.Title !== "string" ||
					typeof r.Professor !== "string" ||
					typeof r.Subject !== "string" ||
					typeof r.Section !== "string" ||
					typeof r.Year !== "string"
				) {
					continue;
				}

				const idNum = toNum(r.id);
				if (idNum === null) continue;
				const idStr = String(idNum);

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
					id: idStr,
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

				if (maxYear[courseId] === undefined || yearNum >= maxYear[courseId]) {
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

	// ============================================================
	// shared search helpers
	// ============================================================

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

	private buildAllFacilities(): Array<Record<string, any>> {
		const out: Array<Record<string, any>> = [];
		for (const buildingId of Object.keys(this.data.buildings)) {
			const b = this.data.buildings[buildingId];
			const roomMap = this.data.rooms[buildingId] ?? {};
			for (const roomId of Object.keys(roomMap)) {
				const r = roomMap[roomId];
				out.push({
					name: b.name,
					building: r.building,
					address: b.address,
					lat: b.lat,
					lon: b.lon,
					number: r.number,
					type: r.type,
					furniture: r.furniture,
					href: r.href,
					seats: r.seats,
				});
			}
		}
		return out;
	}

	private matchIs(value: string, pattern: string): boolean {
		if (pattern.startsWith("*") && pattern.endsWith("*")) return value.includes(pattern.slice(1, -1));
		if (pattern.startsWith("*")) return value.endsWith(pattern.slice(1));
		if (pattern.endsWith("*")) return value.startsWith(pattern.slice(0, -1));
		return value === pattern;
	}

	private evalFilter(records: any[], filterObj: any): any[] {
		if (!filterObj || typeof filterObj !== "object" || Array.isArray(filterObj)) return [];
		const keys = Object.keys(filterObj);
		if (keys.length === 0) return records;
		if (keys.length !== 1) return [];

		const op = keys[0];
		const body = filterObj[op];

		const keyOf = (r: any) => JSON.stringify(r);

		if (op === "AND" || op === "OR") {
			if (!Array.isArray(body) || body.length === 0) return [];
			const parts = body.map((sub) => this.evalFilter(records, sub));

			if (op === "AND") {
				let set = new Set(parts[0].map(keyOf));
				for (let i = 1; i < parts.length; i++) {
					const next = new Set(parts[i].map(keyOf));
					set = new Set([...set].filter((k) => next.has(k)));
				}
				return records.filter((r) => set.has(keyOf(r)));
			}

			const set = new Set<string>();
			for (const p of parts) for (const r of p) set.add(keyOf(r));
			return records.filter((r) => set.has(keyOf(r)));
		}

		if (op === "NOT") {
			if (!body || typeof body !== "object" || Array.isArray(body)) return [];
			const neg = this.evalFilter(records, body);
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

	private sortProjected(projected: any[], order: any): any[] {
		if (order === undefined) return projected;

		if (typeof order === "string") {
			return projected.sort((a, b) => {
				const va = a[order];
				const vb = b[order];
				if (va === vb) return 0;
				return va < vb ? -1 : 1;
			});
		}

		const dir = order.dir;
		const keys: string[] = order.keys;

		return projected.sort((a, b) => {
			for (const k of keys) {
				const va = a[k];
				const vb = b[k];
				if (va === vb) continue;

				if (dir === "UP") return va < vb ? -1 : 1;
				return va < vb ? 1 : -1;
			}
			return 0;
		});
	}

	private aggregateGroup(rows: any[], applyRule: any): Record<string, any> {
		const applyKey = Object.keys(applyRule)[0];
		const tokenObj = applyRule[applyKey];
		const token = Object.keys(tokenObj)[0];
		const field = tokenObj[token];

		if (token === "MAX") {
			return { [applyKey]: Math.max(...rows.map((r) => r[field])) };
		}
		if (token === "MIN") {
			return { [applyKey]: Math.min(...rows.map((r) => r[field])) };
		}
		if (token === "AVG") {
			let total = new Decimal(0);
			for (const row of rows) {
				total = total.add(new Decimal(row[field]));
			}
			const avg = total.toNumber() / rows.length;
			return { [applyKey]: Number(avg.toFixed(2)) };
		}
		if (token === "SUM") {
			let total = 0;
			for (const row of rows) total += row[field];
			return { [applyKey]: Number(total.toFixed(2)) };
		}
		const unique = new Set(rows.map((r) => JSON.stringify(r[field])));
		return { [applyKey]: unique.size };
	}

	async searchCourseOfferings(queryObj: any): Promise<any[]> {
		await this.load();

		const where = queryObj.WHERE;
		const columns: string[] = queryObj.OPTIONS.COLUMNS;
		const order: string | undefined = queryObj.OPTIONS.ORDER;

		let records = this.buildAllOfferings();

		const whereKeys = Object.keys(where);
		if (whereKeys.length === 1) {
			const filterKey = whereKeys[0];
			const filterObj = { [filterKey]: where[filterKey] };
			records = this.evalFilter(records, filterObj);
		}

		if (records.length > 5000) return new Array(5001);

		let projected = records.map((r) => {
			const o: any = {};
			for (const c of columns) o[c] = r[c];
			return o;
		});

		if (projected.length > 5000) return new Array(5001);

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

	async searchV2(kind: DatasetKind, queryObj: any): Promise<any[]> {
		await this.load();

		const where = queryObj.WHERE;
		const columns: string[] = queryObj.OPTIONS.COLUMNS;
		const order = queryObj.OPTIONS.ORDER;
		const transformations = queryObj.TRANSFORMATIONS;

		let records = kind === "course_offerings" ? this.buildAllOfferings() : this.buildAllFacilities();

		const whereKeys = Object.keys(where);
		if (whereKeys.length === 1) {
			const filterKey = whereKeys[0];
			const filterObj = { [filterKey]: where[filterKey] };
			records = this.evalFilter(records, filterObj);
		}

		if (transformations !== undefined) {
			const groupKeys: string[] = transformations.GROUP;
			const applyRules: any[] = transformations.APPLY;

			const grouped = new Map<string, any[]>();
			for (const row of records) {
				const groupObj: Record<string, any> = {};
				for (const k of groupKeys) groupObj[k] = row[k];
				const groupId = JSON.stringify(groupObj);
				if (!grouped.has(groupId)) grouped.set(groupId, []);
				grouped.get(groupId)!.push(row);
			}

			const transformed: any[] = [];
			for (const rows of grouped.values()) {
				const base: Record<string, any> = {};
				for (const k of groupKeys) base[k] = rows[0][k];
				for (const rule of applyRules) {
					Object.assign(base, this.aggregateGroup(rows, rule));
				}
				transformed.push(base);
			}
			records = transformed;
		}

		if (records.length > 5000) return new Array(5001);

		let projected = records.map((r) => {
			const o: any = {};
			for (const c of columns) o[c] = r[c];
			return o;
		});

		if (projected.length > 5000) return new Array(5001);

		projected = this.sortProjected(projected, order);
		return projected;
	}

	private async parseHtml(html: string): Promise<any> {
		const parse5 = await import("parse5");
		return parse5.parse(html);
	}

	private getNodeChildren(node: any): any[] {
		return Array.isArray(node?.childNodes) ? node.childNodes : [];
	}

	private getTagName(node: any): string | undefined {
		return typeof node?.tagName === "string" ? node.tagName : undefined;
	}

	private getAttr(node: any, name: string): string | undefined {
		const attrs = Array.isArray(node?.attrs) ? node.attrs : [];
		const found = attrs.find((a: any) => a?.name === name);
		return found?.value;
	}

	private hasClass(node: any, className: string): boolean {
		const cls = this.getAttr(node, "class");
		if (!cls) return false;
		return cls.split(/\s+/).includes(className);
	}

	private findAllByTag(node: any, tag: string): any[] {
		const out: any[] = [];
		if (this.getTagName(node) === tag) out.push(node);
		for (const child of this.getNodeChildren(node)) {
			out.push(...this.findAllByTag(child, tag));
		}
		return out;
	}

	private findFirstByTag(node: any, tag: string): any | undefined {
		if (this.getTagName(node) === tag) return node;
		for (const child of this.getNodeChildren(node)) {
			const found = this.findFirstByTag(child, tag);
			if (found) return found;
		}
		return undefined;
	}

	private getTextContent(node: any): string {
		if (!node) return "";
		if (node.nodeName === "#text") return node.value ?? "";
		return this.getNodeChildren(node)
			.map((c) => this.getTextContent(c))
			.join("")
			.trim();
	}

	private getTableRows(table: any): any[] {
		return this.findAllByTag(table, "tr");
	}

	private getDirectCells(row: any): any[] {
		return this.getNodeChildren(row).filter((n) => this.getTagName(n) === "td");
	}

	private extractBuildingsFromIndex(document: any): Array<{
		fullname: string;
		shortname: string;
		address: string;
		link: string;
	}> {
		const tables = this.findAllByTag(document, "table");
		const buildingTable = tables.find((t) => this.hasClass(t, "views-table"));
		if (!buildingTable) {
			throw new Error("No building table found in index.htm");
		}

		const rows = this.getTableRows(buildingTable);
		const buildings: Array<{ fullname: string; shortname: string; address: string; link: string }> = [];

		for (const row of rows) {
			const cells = this.getDirectCells(row);

			const titleCell = cells.find((c) => this.hasClass(c, "views-field-title"));
			const shortCell = cells.find((c) => this.hasClass(c, "views-field-field-building-code"));
			const addrCell = cells.find((c) => this.hasClass(c, "views-field-field-building-address"));

			if (!titleCell || !shortCell || !addrCell) continue;

			const a = this.findFirstByTag(titleCell, "a");
			if (!a) continue;

			const fullname = this.getTextContent(a).trim();
			const shortname = this.getTextContent(shortCell).trim();
			const address = this.getTextContent(addrCell).trim();
			const link = this.getAttr(a, "href") ?? "";

			if (!fullname || !shortname || !address || !link) continue;

			buildings.push({ fullname, shortname, address, link });
		}

		return buildings;
	}

	private extractRoomsFromPage(document: any): Array<{
		number: string;
		seats: number;
		furniture: string;
		type: string;
		href: string;
	}> {
		const tables = this.findAllByTag(document, "table");
		const roomTable = tables.find((t) => this.hasClass(t, "views-table"));
		if (!roomTable) return [];

		const rows = this.getTableRows(roomTable);
		const rooms: Array<{ number: string; seats: number; furniture: string; type: string; href: string }> = [];

		for (const row of rows) {
			const cells = this.getDirectCells(row);

			const numberCell = cells.find((c) => this.hasClass(c, "views-field-field-room-number"));
			const seatsCell = cells.find((c) => this.hasClass(c, "views-field-field-room-capacity"));
			const furnitureCell = cells.find((c) => this.hasClass(c, "views-field-field-room-furniture"));
			const typeCell = cells.find((c) => this.hasClass(c, "views-field-field-room-type"));
			const hrefCell = cells.find((c) => this.hasClass(c, "views-field-nothing"));

			if (!numberCell || !seatsCell || !furnitureCell || !typeCell || !hrefCell) continue;

			const numberA = this.findFirstByTag(numberCell, "a");
			const hrefA = this.findFirstByTag(hrefCell, "a");
			if (!numberA || !hrefA) continue;

			const number = this.getTextContent(numberA).trim();
			const seatsRaw = this.getTextContent(seatsCell).trim();
			const furniture = this.getTextContent(furnitureCell).trim();
			const type = this.getTextContent(typeCell).trim();
			const href = (this.getAttr(hrefA, "href") ?? "").trim();

			const seats = parseInt(seatsRaw, 10);
			// Skip only if seats is not a non-negative integer; empty strings for other fields are NOT skipped
			if (!number || !Number.isInteger(seats) || seats < 0) continue;

			rooms.push({ number, seats, furniture, type, href });
		}

		return rooms;
	}

	private async lookupGeolocation(address: string): Promise<{ lat: number; lon: number } | undefined> {
		const teamNumber = "083";

		try {
			const url = `http://cs310.students.cs.ubc.ca:11316/api/v1/project_team${teamNumber}/${encodeURIComponent(address)}`;
			const res = await fetch(url);
			const data = await res.json();

			if (!res.ok || data?.error !== undefined) return undefined;
			if (typeof data.lat !== "number" || typeof data.lon !== "number") return undefined;

			return { lat: data.lat, lon: data.lon };
		} catch {
			return undefined;
		}
	}

	async processFacilitiesZip(id: string, zip: JSZip): Promise<void> {
		await this.load();

		const job = this.data.datasets[id];
		if (!job) return;

		const stats = this.emptyFacilitiesStats();

		const indexFile = zip.files["index.htm"];
		if (!indexFile) {
			await this.failDatasetJob(id, "Missing index.htm file");
			return;
		}

		let indexText: string;
		try {
			indexText = await indexFile.async("text");
		} catch {
			await this.failDatasetJob(id, "index.htm could not be parsed");
			return;
		}

		let indexDoc: any;
		try {
			indexDoc = await this.parseHtml(indexText);
		} catch {
			await this.failDatasetJob(id, "index.htm could not be parsed");
			return;
		}

		let buildings: Array<{ fullname: string; shortname: string; address: string; link: string }>;
		try {
			buildings = this.extractBuildingsFromIndex(indexDoc);
		} catch (err: any) {
			if (err?.message === "No building table found in index.htm") {
				await this.failDatasetJob(id, "No building table found in index.htm");
				return;
			}
			throw err;
		}

		for (const b of buildings) {
			const geo = await this.lookupGeolocation(b.address);
			if (!geo) {
				continue;
			}

			const buildingResult = this.upsertBuildingInMemory(b.shortname, b.fullname, b.address, geo.lat, geo.lon);

			if (!buildingResult.existed) {
				stats.buildings_added++;
			} else if (buildingResult.changed) {
				stats.buildings_modified++;
			}

			// Normalize path: strip leading ./ or /
			const relativePath = b.link.replace(/^\.?\/+/, "");
			const roomFile = zip.files[relativePath];
			if (!roomFile) {
				continue;
			}

			let roomText: string;
			try {
				roomText = await roomFile.async("text");
			} catch {
				continue;
			}

			let roomDoc: any;
			try {
				roomDoc = await this.parseHtml(roomText);
			} catch {
				continue;
			}

			const rooms = this.extractRoomsFromPage(roomDoc);

			for (const r of rooms) {
				const roomId = `${b.shortname}_${r.number}`;

				const roomResult = this.upsertRoomInMemory(b.shortname, roomId, {
					building: b.shortname,
					number: r.number,
					seats: r.seats,
					type: r.type,
					furniture: r.furniture,
					href: r.href,
				});

				if (!roomResult.existed) {
					stats.rooms_added++;
				} else if (roomResult.changed) {
					stats.rooms_modified++;
				}
			}
		}

		await this.save();
		await this.completeDatasetJob(id, stats);
	}
}

type ValidationOk = { ok: true };
type ValidationBad = { ok: false; message: string };

function validateSearchQuery(q: any): ValidationOk | ValidationBad {
	if (q.WHERE === undefined) return { ok: false, message: "Missing WHERE" };
	if (q.OPTIONS === undefined) return { ok: false, message: "Missing OPTIONS" };

	if (q.WHERE === null || typeof q.WHERE !== "object" || Array.isArray(q.WHERE) || Object.keys(q.WHERE).length > 1) {
		return { ok: false, message: "WHERE must be an object with at most one FILTER" };
	}

	if (q.OPTIONS === null || typeof q.OPTIONS !== "object" || Array.isArray(q.OPTIONS)) {
		return { ok: false, message: "OPTIONS must be an object with COLUMNS and optional ORDER" };
	}

	if (q.OPTIONS.COLUMNS === undefined) return { ok: false, message: "Missing COLUMNS" };
	if (!Array.isArray(q.OPTIONS.COLUMNS) || q.OPTIONS.COLUMNS.length === 0) {
		return { ok: false, message: "Missing COLUMNS" };
	}

	const mfields = new Set(["avg", "pass", "fail", "audit", "year"]);
	const sfields = new Set(["title", "dept", "code", "instructor"]);
	const allowed = new Set([...mfields, ...sfields]);

	for (const k of q.OPTIONS.COLUMNS) {
		if (typeof k !== "string" || !allowed.has(k)) return { ok: false, message: "Unknown key in COLUMNS" };
	}

	if (q.OPTIONS.ORDER !== undefined) {
		if (typeof q.OPTIONS.ORDER !== "string" || !q.OPTIONS.COLUMNS.includes(q.OPTIONS.ORDER)) {
			return { ok: false, message: "ORDER must be a key in COLUMNS" };
		}
	}

	const whereKeys = Object.keys(q.WHERE);
	if (whereKeys.length === 0) return { ok: true };

	const rootOp = whereKeys[0];
	const rootBody = q.WHERE[rootOp];
	return validateFilterNode(rootOp, rootBody, mfields, sfields);
}

function validateSearchQueryV2(q: any, kind: DatasetKind): ValidationOk | ValidationBad {
	if (q.WHERE === undefined) return { ok: false, message: "Missing WHERE" };
	if (q.OPTIONS === undefined) return { ok: false, message: "Missing OPTIONS" };

	if (q.WHERE === null || typeof q.WHERE !== "object" || Array.isArray(q.WHERE) || Object.keys(q.WHERE).length > 1) {
		return { ok: false, message: "WHERE must be an object with at most one FILTER" };
	}

	if (q.OPTIONS === null || typeof q.OPTIONS !== "object" || Array.isArray(q.OPTIONS)) {
		return { ok: false, message: "OPTIONS must be an object with COLUMNS and optional ORDER" };
	}

	if (q.OPTIONS.COLUMNS === undefined) return { ok: false, message: "Missing COLUMNS" };
	if (!Array.isArray(q.OPTIONS.COLUMNS) || q.OPTIONS.COLUMNS.length === 0) {
		return { ok: false, message: "Missing COLUMNS" };
	}

	const courseM = new Set(["avg", "pass", "fail", "audit", "year"]);
	const courseS = new Set(["title", "dept", "code", "instructor"]);
	const facM = new Set(["lat", "lon", "seats"]);
	const facS = new Set(["name", "building", "address", "number", "type", "furniture", "href"]);

	const mfields = kind === "course_offerings" ? courseM : facM;
	const sfields = kind === "course_offerings" ? courseS : facS;
	const allowed = new Set([...mfields, ...sfields]);
	const otherAllowed = new Set([...(kind === "course_offerings" ? [...facM, ...facS] : [...courseM, ...courseS])]);

	const whereKeys = Object.keys(q.WHERE);
	if (whereKeys.length === 1) {
		const rootOp = whereKeys[0];
		const rootBody = q.WHERE[rootOp];
		const fv = validateFilterNode(rootOp, rootBody, mfields, sfields);
		if (!fv.ok) return fv;
	}

	if (q.TRANSFORMATIONS === undefined) {
		for (const k of q.OPTIONS.COLUMNS) {
			if (typeof k !== "string") return { ok: false, message: "Unknown key in COLUMNS" };
			if (!allowed.has(k)) {
				if (otherAllowed.has(k)) {
					return { ok: false, message: "Cannot mix course_offerings and facilities fields in one query" };
				}
				return { ok: false, message: "Unknown key in COLUMNS" };
			}
		}

		if (q.OPTIONS.ORDER !== undefined) {
			if (typeof q.OPTIONS.ORDER === "string") {
				if (!q.OPTIONS.COLUMNS.includes(q.OPTIONS.ORDER)) {
					return { ok: false, message: "ORDER must be a key in COLUMNS" };
				}
			} else {
				const order = q.OPTIONS.ORDER;
				if (!order || typeof order !== "object" || Array.isArray(order)) {
					return { ok: false, message: "All ORDER keys must be in COLUMNS" };
				}
				if (order.dir !== "UP" && order.dir !== "DOWN") {
					return { ok: false, message: "Invalid sort direction (must be UP or DOWN)" };
				}
				if (!Array.isArray(order.keys) || order.keys.length === 0) {
					return { ok: false, message: "All ORDER keys must be in COLUMNS" };
				}
				for (const k of order.keys) {
					if (typeof k !== "string" || !q.OPTIONS.COLUMNS.includes(k)) {
						return { ok: false, message: "All ORDER keys must be in COLUMNS" };
					}
				}
			}
		}

		return { ok: true };
	}

	const t = q.TRANSFORMATIONS;
	if (t.GROUP === undefined) return { ok: false, message: "Missing GROUP in TRANSFORMATIONS" };
	if (t.APPLY === undefined) return { ok: false, message: "Missing APPLY in TRANSFORMATIONS" };

	if (!Array.isArray(t.GROUP) || t.GROUP.length === 0) {
		return { ok: false, message: "GROUP must be a non-empty array" };
	}
	if (!Array.isArray(t.APPLY)) {
		return { ok: false, message: "APPLY must be an array" };
	}

	const groupKeys = new Set<string>();
	for (const g of t.GROUP) {
		if (typeof g !== "string") return { ok: false, message: "GROUP must be a non-empty array" };
		if (!allowed.has(g)) {
			if (otherAllowed.has(g)) {
				return { ok: false, message: "Cannot mix course_offerings and facilities fields in one query" };
			}
			return { ok: false, message: "Unknown key in COLUMNS" };
		}
		groupKeys.add(g);
	}

	const applyKeys = new Set<string>();
	for (const rule of t.APPLY) {
		if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
			return { ok: false, message: "APPLY must be an array" };
		}

		const applyKeyNames = Object.keys(rule);
		if (applyKeyNames.length !== 1) {
			return { ok: false, message: "APPLY must be an array" };
		}

		const applyKey = applyKeyNames[0];
		if (applyKey.length === 0 || applyKey.includes("_")) {
			return { ok: false, message: "applykey cannot be empty or contain underscore" };
		}
		if (applyKeys.has(applyKey)) {
			return { ok: false, message: "Duplicate APPLY key" };
		}
		applyKeys.add(applyKey);

		const tokenObj = rule[applyKey];
		if (!tokenObj || typeof tokenObj !== "object" || Array.isArray(tokenObj)) {
			return { ok: false, message: "Invalid APPLY rule" };
		}

		const tokenNames = Object.keys(tokenObj);
		if (tokenNames.length !== 1) {
			return { ok: false, message: "Invalid APPLY rule" };
		}

		const token = tokenNames[0];
		const field = tokenObj[token];

		if (typeof field !== "string") {
			return { ok: false, message: "Invalid APPLY rule" };
		}

		if (token === "COUNT") {
			if (!allowed.has(field)) {
				if (otherAllowed.has(field)) {
					return { ok: false, message: "Cannot mix course_offerings and facilities fields in one query" };
				}
				return { ok: false, message: "Invalid APPLY rule" };
			}
		} else {
			if (!["MAX", "MIN", "AVG", "SUM"].includes(token)) {
				return { ok: false, message: "Invalid APPLY rule" };
			}
			if (!mfields.has(field)) {
				return { ok: false, message: "Invalid APPLY rule" };
			}
		}
	}

	for (const c of q.OPTIONS.COLUMNS) {
		if (typeof c !== "string") {
			return { ok: false, message: "When TRANSFORMATIONS is present, all COLUMNS must be in GROUP or APPLY" };
		}
		if (!groupKeys.has(c) && !applyKeys.has(c)) {
			if (allowed.has(c) || otherAllowed.has(c)) {
				return { ok: false, message: "When TRANSFORMATIONS is present, all COLUMNS must be in GROUP or APPLY" };
			}
			return { ok: false, message: "When TRANSFORMATIONS is present, all COLUMNS must be in GROUP or APPLY" };
		}
	}

	if (q.OPTIONS.ORDER !== undefined) {
		if (typeof q.OPTIONS.ORDER === "string") {
			if (!q.OPTIONS.COLUMNS.includes(q.OPTIONS.ORDER)) {
				return { ok: false, message: "ORDER must be a key in COLUMNS" };
			}
		} else {
			const order = q.OPTIONS.ORDER;
			if (!order || typeof order !== "object" || Array.isArray(order)) {
				return { ok: false, message: "All ORDER keys must be in COLUMNS" };
			}
			if (order.dir !== "UP" && order.dir !== "DOWN") {
				return { ok: false, message: "Invalid sort direction (must be UP or DOWN)" };
			}
			if (!Array.isArray(order.keys) || order.keys.length === 0) {
				return { ok: false, message: "All ORDER keys must be in COLUMNS" };
			}
			for (const k of order.keys) {
				if (typeof k !== "string" || !q.OPTIONS.COLUMNS.includes(k)) {
					return { ok: false, message: "All ORDER keys must be in COLUMNS" };
				}
			}
		}
	}

	return { ok: true };
}

function validateFilterNode(
	op: string,
	body: any,
	mfields: Set<string>,
	sfields: Set<string>
): ValidationOk | ValidationBad {
	if (op === "AND" || op === "OR") {
		if (!Array.isArray(body) || body.length === 0) {
			return { ok: false, message: `${op} must be a non-empty array of FILTER objects` };
		}
		for (const item of body) {
			if (!item || typeof item !== "object" || Array.isArray(item)) {
				return { ok: false, message: `${op} must be a non-empty array of FILTER objects` };
			}
			const ks = Object.keys(item);
			if (ks.length !== 1) return { ok: false, message: `${op} must be a non-empty array of FILTER objects` };
			const subOp = ks[0];
			const subBody = item[subOp];
			const sub = validateFilterNode(subOp, subBody, mfields, sfields);
			if (!sub.ok) return sub;
		}
		return { ok: true };
	}

	if (op === "NOT") {
		if (!body || typeof body !== "object" || Array.isArray(body)) {
			return { ok: false, message: "NOT must be a FILTER object" };
		}
		const ks = Object.keys(body);
		if (ks.length !== 1) return { ok: false, message: "NOT must be a FILTER object" };
		return validateFilterNode(ks[0], body[ks[0]], mfields, sfields);
	}

	if (op === "LT" || op === "GT" || op === "EQ") {
		if (!body || typeof body !== "object" || Array.isArray(body)) {
			return { ok: false, message: `${op} must be an object with one mfield of type number` };
		}
		const ks = Object.keys(body);
		if (ks.length !== 1) return { ok: false, message: `${op} must be an object with one mfield of type number` };
		const k = ks[0];
		if (!mfields.has(k) || typeof body[k] !== "number") {
			return { ok: false, message: `${op} must be an object with one mfield of type number` };
		}
		return { ok: true };
	}

	if (op === "IS") {
		if (!body || typeof body !== "object" || Array.isArray(body)) {
			return { ok: false, message: "IS must be an object with one sfield of type string" };
		}
		const ks = Object.keys(body);
		if (ks.length !== 1) return { ok: false, message: "IS must be an object with one sfield of type string" };
		const k = ks[0];
		const v = body[k];
		if (!sfields.has(k) || typeof v !== "string") {
			return { ok: false, message: "IS must be an object with one sfield of type string" };
		}
		if (v.length >= 3 && v.slice(1, -1).includes("*")) {
			return { ok: false, message: "IS asterisks can only be first or last character" };
		}
		return { ok: true };
	}

	return { ok: false, message: "WHERE must be an object with at most one FILTER" };
}
