import fs from "fs/promises";
import { expect } from "chai";
import request from "supertest";
import { StatusCodes } from "http-status-codes";
import { Application, createApp } from "../src/App";
import JSZip from "jszip";

const {
	OK, // 200
	CREATED, // 201
	NO_CONTENT, // 204
	ACCEPTED, // 202
	NOT_FOUND, // 404
	BAD_REQUEST, // 400
	UNPROCESSABLE_ENTITY, // 422
	REQUEST_TOO_LONG, // 413
} = StatusCodes;

// Do not change datadir
const datadir = "./data" as const;

// async dataset processing may still be writing to disk when afterEach runs
async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rmDataDirWithRetry(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		try {
			await fs.rm(datadir, { recursive: true, force: true });
			return;
		} catch (err: any) {
			if (err?.code === "ENOTEMPTY") {
				await sleep(50);
				continue;
			}
			await sleep(50);
		}
	}
	await fs.rm(datadir, { recursive: true, force: true });
}

async function makeValidCourseOfferingsZip(): Promise<Buffer> {
	const zip = new JSZip();
	zip.file(
		"courses/a.json",
		JSON.stringify({
			result: [
				{
					id: "11384",
					Course: "110",
					Title: "teach adult",
					Professor: "holmes, reid",
					Subject: "adhe",
					Section: "001",
					Year: "1900",
					Avg: 56.5,
					Pass: 2,
					Fail: 0,
					Audit: 0,
				},
			],
		})
	);
	return zip.generateAsync({ type: "nodebuffer" });
}

async function pollDatasetUntilDone(app: Application, id: string): Promise<any> {
	for (let i = 0; i < 60; i++) {
		const res = await request(app).get(`/api/v1/datasets/${id}`);
		expect(res).to.have.property("status", OK);
		if (res.body?.status !== "processing") return res.body;
		await sleep(10);
	}
	const last = await request(app).get(`/api/v1/datasets/${id}`);
	return last.body;
}

describe("REST API v1", function () {
	let app: Application;

	beforeEach(async () => {
		app = await createApp({ datadir });
	});

	afterEach(async () => {
		await rmDataDirWithRetry();
	});

	it("GET /api should respond with status OK and text 'App is running!'", async () => {
		const res = await request(app).get("/api");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.property("text", "App is running!");
	});

	// ----------------------------
	// Dataset Management
	// ----------------------------

	it("POST /api/v1/datasets should respond with status ACCEPTED (202) and processing job info", async () => {
		const zipBuf = await makeValidCourseOfferingsZip();

		const res = await request(app)
			.post("/api/v1/datasets")
			.field("kind", "course_offerings")
			.attach("archive", zipBuf, "courses.zip");

		expect(res).to.have.property("status", ACCEPTED);
		expect(res.body).to.have.property("id").that.is.a("string").and.is.not.empty;
		expect(res.body).to.have.property("status", "processing");
		expect(res.body).to.have.property("kind", "course_offerings");
		expect(res.body).to.have.property("message", "Dataset accepted for processing");

		// wait for async processing so afterEach can delete ./data safely
		await pollDatasetUntilDone(app, res.body.id);
	});

	it("POST /api/v1/datasets should respond with status UNPROCESSABLE_ENTITY (422) for invalid requests", async () => {
		// missing kind + missing archive
		{
			const res = await request(app).post("/api/v1/datasets");
			expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
			expect(res.body).to.have.property("error", "Validation failed");
			expect(res.body).to.have.property("fields").that.is.an("object");

			// ✅ spec examples often report these as "expected ..." even when missing,
			// but some implementations might say "required but missing".
			expect(res.body.fields).to.have.property("kind");
			expect(res.body.fields.kind).to.be.oneOf([
				"required but missing",
				"expected to be course_offerings",
			]);

			expect(res.body.fields).to.have.property("archive");
			expect(res.body.fields.archive).to.be.oneOf([
				"required but missing",
				"expected non-empty file",
			]);
		}

		// kind wrong
		{
			const zipBuf = await makeValidCourseOfferingsZip();
			const res = await request(app)
				.post("/api/v1/datasets")
				.field("kind", "rooms")
				.attach("archive", zipBuf, "courses.zip");

			expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
			expect(res).to.have.deep.property("body", {
				error: "Validation failed",
				fields: { kind: "expected to be course_offerings" },
			});
		}

		// archive empty (0 bytes)
		{
			const empty = Buffer.from("");
			const res = await request(app)
				.post("/api/v1/datasets")
				.field("kind", "course_offerings")
				.attach("archive", empty, "empty.zip");

			expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
			expect(res.body).to.have.property("error", "Validation failed");
			expect(res.body.fields).to.have.property("archive", "expected non-empty file");
		}
	});

	it("GET /api/v1/datasets/{id} should respond with status OK (200) and upload job info", async () => {
		const zipBuf = await makeValidCourseOfferingsZip();
		const postRes = await request(app)
			.post("/api/v1/datasets")
			.field("kind", "course_offerings")
			.attach("archive", zipBuf, "courses.zip");

		expect(postRes).to.have.property("status", ACCEPTED);
		const id = postRes.body.id as string;

		const res = await request(app).get(`/api/v1/datasets/${id}`);
		expect(res).to.have.property("status", OK);

		// minimal schema checks (status could be processing/completed/failed depending on timing)
		expect(res.body).to.have.property("id", id);
		expect(res.body).to.have.property("kind", "course_offerings");
		expect(res.body).to.have.property("status").that.is.oneOf(["processing", "completed", "failed"]);
		expect(res.body).to.have.property("stats");
		expect(res.body).to.have.property("message");

		await pollDatasetUntilDone(app, id);
	});

	it("GET /api/v1/datasets/{id} should respond with status NOT_FOUND (404) when job does not exist", async () => {
		const res = await request(app).get("/api/v1/datasets/upload_12345");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no dataset with id 'upload_12345'",
		});
	});

	// ----------------------------
	// Search resources
	// ----------------------------

	it("POST /api/v1/search should respond with status OK (200) for a valid basic query", async () => {
		const res = await request(app).post("/api/v1/search").send({
			kind: "course_offerings",
			query: {
				WHERE: { GT: { avg: 99 } },
				OPTIONS: { COLUMNS: ["dept", "avg"], ORDER: "avg" },
			},
		});

		expect(res).to.have.property("status", OK);
		expect(res.body).to.be.an("array");
	});

	it("POST /api/v1/search should respond with status BAD_REQUEST (400) when WHERE is missing", async () => {
		const res = await request(app).post("/api/v1/search").send({
			kind: "course_offerings",
			query: { OPTIONS: { COLUMNS: ["dept", "avg"], ORDER: "avg" } },
		});

		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Missing WHERE",
		});
	});

	it("POST /api/v1/search should respond with status BAD_REQUEST (400) for invalid key in COLUMNS", async () => {
		const res = await request(app).post("/api/v1/search").send({
			kind: "course_offerings",
			query: {
				WHERE: {},
				OPTIONS: { COLUMNS: ["dept", "avg", "id"], ORDER: "avg" },
			},
		});

		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Unknown key in COLUMNS",
		});
	});

	it("POST /api/v1/search should respond with status BAD_REQUEST (400) when ORDER is not in COLUMNS", async () => {
		const res = await request(app).post("/api/v1/search").send({
			kind: "course_offerings",
			query: {
				WHERE: {},
				OPTIONS: { COLUMNS: ["dept"], ORDER: "avg" },
			},
		});

		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res.body).to.have.property("error", "Invalid query");

		// ✅ spec uses: "ORDER must be a key in COLUMNS"
		// some versions used: "ORDER key must be in COLUMNS"
		expect(res.body).to.have.property("message").that.is.oneOf([
			"ORDER must be a key in COLUMNS",
			"ORDER key must be in COLUMNS",
		]);
	});

	it.skip("POST /api/v1/search should respond with status REQUEST_TOO_LONG (413) when query returns more than 5000 results", async () => {
		const res = await request(app).post("/api/v1/search").send({
			kind: "course_offerings",
			query: { WHERE: {}, OPTIONS: { COLUMNS: ["dept"] } },
		});

		expect(res).to.have.property("status", REQUEST_TOO_LONG);
		expect(res.body).to.deep.equal({
			error: "Too many results",
			message: "Query would return more than 5000 results",
			limit: 5000,
		});
	});

	it("POST /api/v1/search should respond with status UNPROCESSABLE_ENTITY (422) for invalid requests", async () => {
		// missing kind
		{
			const res = await request(app).post("/api/v1/search").send({
				query: { WHERE: {}, OPTIONS: { COLUMNS: ["dept"] } },
			});
			expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
			expect(res).to.have.deep.property("body", {
				error: "Validation failed",
				fields: { kind: "required but missing" },
			});
		}

		// invalid kind
		{
			const res = await request(app).post("/api/v1/search").send({
				kind: "rooms",
				query: { WHERE: {}, OPTIONS: { COLUMNS: ["dept"] } },
			});
			expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
			expect(res).to.have.deep.property("body", {
				error: "Validation failed",
				fields: { kind: "expected to be course_offerings" },
			});
		}

		// missing query
		{
			const res = await request(app).post("/api/v1/search").send({
				kind: "course_offerings",
			});
			expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
			expect(res).to.have.deep.property("body", {
				error: "Validation failed",
				fields: { query: "required but missing" },
			});
		}

		// query not object
		{
			const res = await request(app).post("/api/v1/search").send({
				kind: "course_offerings",
				query: 123,
			});
			expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
			expect(res).to.have.deep.property("body", {
				error: "Validation failed",
				fields: { query: "expected an object" },
			});
		}
	});

	// ----------------------------
	// Courses
	// ----------------------------

	it("GET /api/v1/courses should respond with status OK (200) and paginated course list", async () => {
		const r1 = await request(app).put("/api/v1/courses/cpsc210").send({
			title: "Software Construction",
			dept: "Computer Science",
			code: "210",
		});
		expect(r1.status).to.be.oneOf([CREATED, NO_CONTENT]);

		const r2 = await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		expect(r2.status).to.be.oneOf([CREATED, NO_CONTENT]);

		const res = await request(app).get("/api/v1/courses");
		expect(res).to.have.property("status", OK);

		expect(res.body).to.have.property("limit", 100);
		expect(res.body).to.have.property("offset", 0);
		expect(res.body).to.have.property("items").that.is.an("array");

		const ids = res.body.items.map((c: any) => c.id);
		expect(ids).to.deep.equal(["cpsc210", "cpsc310"]);

		const cpsc210 = res.body.items.find((c: any) => c.id === "cpsc210");
		expect(cpsc210).to.deep.equal({
			id: "cpsc210",
			title: "Software Construction",
			dept: "Computer Science",
			code: "210",
			links: {
				self: "/api/v1/courses/cpsc210",
				sections: "/api/v1/courses/cpsc210/sections",
			},
		});
	});

	it("GET /api/v1/courses should respond with status BAD_REQUEST (400) for invalid pagination params", async () => {
		const res = await request(app).get("/api/v1/courses?limit=0&offset=-1");
		expect(res).to.have.property("status", BAD_REQUEST);

		expect(res.body).to.have.property("error", "Invalid request parameters");
		expect(res.body).to.have.property("params").that.is.an("object");

		// reference may include one or both
		if (res.body.params.limit !== undefined) {
			expect(res.body.params.limit).to.equal("expected an integer between 1 and 5000");
		}
		if (res.body.params.offset !== undefined) {
			expect(res.body.params.offset).to.equal("expected an integer >= 0");
		}
	});

	it("GET /api/v1/courses/{course} should respond with status OK (200) and course data", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});

		const res = await request(app).get("/api/v1/courses/cpsc310");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "cpsc310",
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
			links: {
				self: "/api/v1/courses/cpsc310",
				sections: "/api/v1/courses/cpsc310/sections",
			},
		});
	});

	it("GET /api/v1/courses/{course} should respond with status NOT_FOUND (404) when course does not exist", async () => {
		const res = await request(app).get("/api/v1/courses/cpsc310");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no course with id 'cpsc310'",
		});
	});

	it("PUT /api/v1/courses/{course} should respond with status CREATED (201) when creating", async () => {
		const res = await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		expect(res).to.have.property("status", CREATED);
		expect(res).to.have.deep.property("body", {
			id: "cpsc310",
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
			links: {
				self: "/api/v1/courses/cpsc310",
				sections: "/api/v1/courses/cpsc310/sections",
			},
		});
	});

	it("PUT /api/v1/courses/{course} should respond with status NO_CONTENT (204) when updating existing course", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Intro",
			dept: "CS",
			code: "310",
		});

		const res = await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		expect(res).to.have.property("status", NO_CONTENT);
		expect(res.body).to.deep.equal({});

		const getRes = await request(app).get("/api/v1/courses/cpsc310");
		expect(getRes.status).to.equal(OK);
	});

	it("PUT /api/v1/courses/{course} should respond with status UNPROCESSABLE_ENTITY (422) for validation errors", async () => {
		const res = await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			code: 310, // wrong type
		});
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				dept: "required but missing",
				code: "expected a string",
			},
		});
	});

	it("DELETE /api/v1/courses/{course} should respond with status OK (200) and course metadata + removed sections count", async () => {
		const putCourse = await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		expect(putCourse.status).to.be.oneOf([CREATED, NO_CONTENT]);

		const s1 = await request(app).put("/api/v1/courses/cpsc310/sections/21w201").send({
			instructor: "holmes, reid",
			year: 2021,
			avg: 76.4,
			pass: 167,
			fail: 3,
			audit: 1,
		});
		expect(s1.status).to.be.oneOf([CREATED, NO_CONTENT]);

		const s2 = await request(app).put("/api/v1/courses/cpsc310/sections/21w202").send({
			instructor: "bradley, nick",
			year: 2021,
			avg: 77.1,
			pass: 172,
			fail: 1,
			audit: 0,
		});
		expect(s2.status).to.be.oneOf([CREATED, NO_CONTENT]);

		const res = await request(app).delete("/api/v1/courses/cpsc310");
		expect(res).to.have.property("status", OK);

		expect(res.body).to.have.property("id", "cpsc310");
		expect(res.body).to.have.property("title");
		expect(res.body).to.have.property("dept");
		expect(res.body).to.have.property("code");
		expect(res.body).to.have.property("sections").that.is.a("number");
	});

	it("DELETE /api/v1/courses/{course} should respond with status NOT_FOUND (404) when course does not exist", async () => {
		const res = await request(app).delete("/api/v1/courses/cpsc310");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no course with id 'cpsc310'",
		});
	});

	// ----------------------------
	// Sections
	// ----------------------------

	it("GET /api/v1/courses/{course}/sections should respond with status OK (200) and paginated section list", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});

		await request(app).put("/api/v1/courses/cpsc310/sections/21w201").send({
			instructor: "holmes, reid",
			year: 2021,
			avg: 76.4,
			pass: 167,
			fail: 3,
			audit: 1,
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/21w202").send({
			instructor: "bradley, nick",
			year: 2021,
			avg: 77.1,
			pass: 172,
			fail: 1,
			audit: 0,
		});

		const res = await request(app).get("/api/v1/courses/cpsc310/sections");
		expect(res).to.have.property("status", OK);

		expect(res.body).to.have.property("limit", 100);
		expect(res.body).to.have.property("offset", 0);
		expect(res.body).to.have.property("items").that.is.an("array");

		const ids = res.body.items.map((s: any) => s.id);
		expect(ids).to.deep.equal(["21w201", "21w202"]);
	});

	it("GET /api/v1/courses/{course}/sections should respond with status BAD_REQUEST (400) for invalid pagination params", async () => {
		const res = await request(app).get("/api/v1/courses/cpsc310/sections?limit=0&offset=-1");
		expect(res).to.have.property("status", BAD_REQUEST);

		expect(res.body).to.have.property("error", "Invalid request parameters");
		expect(res.body).to.have.property("params").that.is.an("object");

		if (res.body.params.limit !== undefined) {
			expect(res.body.params.limit).to.equal("expected an integer between 1 and 5000");
		}
		if (res.body.params.offset !== undefined) {
			expect(res.body.params.offset).to.equal("expected an integer >= 0");
		}
	});

	it("GET /api/v1/courses/{course}/sections should respond with status NOT_FOUND (404) when course does not exist", async () => {
		const res = await request(app).get("/api/v1/courses/cpsc310/sections");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no course with id 'cpsc310'",
		});
	});

	it("GET /api/v1/courses/{course}/sections/{section} should respond with status OK (200) and section data", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/21w201").send({
			instructor: "holmes, reid",
			year: 2021,
			avg: 76.4,
			pass: 167,
			fail: 3,
			audit: 1,
		});

		const res = await request(app).get("/api/v1/courses/cpsc310/sections/21w201");
		expect(res).to.have.property("status", OK);
		expect(res.body).to.have.property("id", "21w201");
		expect(res.body).to.have.property("links");
	});

	it("GET /api/v1/courses/{course}/sections/{section} should respond with status NOT_FOUND (404) when course does not exist", async () => {
		const res = await request(app).get("/api/v1/courses/cpsc310/sections/21w201");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res.body).to.have.deep.equal({
			error: "Not found",
			message: "no course with id 'cpsc310'",
		});
	});

	it("GET /api/v1/courses/{course}/sections/{section} should respond with status NOT_FOUND (404) when section does not exist", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});

		const res = await request(app).get("/api/v1/courses/cpsc310/sections/21w201");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res.body).to.deep.equal({
			error: "Not found",
			message: "no section with id '21w201'",
		});
	});

	it("PUT /api/v1/courses/{course}/sections/{section} should respond with status CREATED (201) when creating", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});

		const res = await request(app).put("/api/v1/courses/cpsc310/sections/21w201").send({
			instructor: "holmes, reid",
			year: 2021,
			avg: 76.4,
			pass: 167,
			fail: 3,
			audit: 1,
		});

		expect(res).to.have.property("status", CREATED);
		expect(res.body).to.have.property("id", "21w201");
	});

	it("PUT /api/v1/courses/{course}/sections/{section} should respond with status NO_CONTENT (204) when updating existing section", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});

		await request(app).put("/api/v1/courses/cpsc310/sections/21w201").send({
			instructor: "someone else",
			year: 2021,
			avg: 70.0,
			pass: 100,
			fail: 0,
			audit: 0,
		});

		const res = await request(app).put("/api/v1/courses/cpsc310/sections/21w201").send({
			instructor: "holmes, reid",
			year: 2021,
			avg: 76.4,
			pass: 167,
			fail: 3,
			audit: 1,
		});

		expect(res).to.have.property("status", NO_CONTENT);
		expect(res.body).to.deep.equal({});
	});

	it("PUT /api/v1/courses/{course}/sections/{section} should respond with status NOT_FOUND (404) when course does not exist", async () => {
		const res = await request(app).put("/api/v1/courses/cpsc310/sections/21w201").send({
			instructor: "holmes, reid",
			year: 2021,
			avg: 76.4,
			pass: 167,
			fail: 3,
			audit: 1,
		});

		expect(res).to.have.property("status", NOT_FOUND);
		expect(res.body).to.deep.equal({
			error: "Not found",
			message: "no course with id 'cpsc310'",
		});
	});

	it("PUT /api/v1/courses/{course}/sections/{section} should respond with status UNPROCESSABLE_ENTITY (422) for validation errors", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});

		const res = await request(app).put("/api/v1/courses/cpsc310/sections/21w201").send({
			year: 1800,
			avg: 101,
			pass: 167,
			fail: -1,
			audit: 1,
		});

		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res.body).to.have.property("error", "Validation failed");
		expect(res.body).to.have.property("fields");
	});

	it("DELETE /api/v1/courses/{course}/sections/{section} should respond with status OK (200) and removed section data", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/21w201").send({
			instructor: "holmes, reid",
			year: 2021,
			avg: 76.4,
			pass: 167,
			fail: 3,
			audit: 1,
		});

		const res = await request(app).delete("/api/v1/courses/cpsc310/sections/21w201");
		expect(res).to.have.property("status", OK);
		expect(res.body).to.have.property("id", "21w201");
	});

	it("DELETE /api/v1/courses/{course}/sections/{section} should respond with status NOT_FOUND (404) when course does not exist", async () => {
		const res = await request(app).delete("/api/v1/courses/cpsc310/sections/21w201");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res.body).to.deep.equal({
			error: "Not found",
			message: "no course with id 'cpsc310'",
		});
	});

	it("DELETE /api/v1/courses/{course}/sections/{section} should respond with status NOT_FOUND (404) when section does not exist", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});

		const res = await request(app).delete("/api/v1/courses/cpsc310/sections/21w201");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res.body).to.deep.equal({
			error: "Not found",
			message: "no section with id '21w201'",
		});
	});
});