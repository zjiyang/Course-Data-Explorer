import fs from "fs/promises";
import { expect } from "chai";
import request from "supertest";
import { StatusCodes } from "http-status-codes";
import { Application, createApp } from "../src/App";
import JSZip from "jszip";

const {
	OK, // 200
	CREATED, // 201
	ACCEPTED, // 202
	NO_CONTENT, // 204
	BAD_REQUEST, // 400
	NOT_FOUND, // 404
	UNPROCESSABLE_ENTITY, // 422
	REQUEST_TOO_LONG, // 413
} = StatusCodes;

// Do not change datadir
const datadir = "./data" as const;

// ========== Helper: build a zip buffer ==========
// key = file path inside zip, value = file content string
async function makeZipBuffer(files: Record<string, string>): Promise<Buffer> {
	const zip = new JSZip();
	for (const [path, content] of Object.entries(files)) {
		zip.file(path, content);
	}
	return await zip.generateAsync({ type: "nodebuffer" });
}

// ========== Helper: build a valid course offering record ==========
function makeValidOffering(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "20002",
		Course: "121",
		Title: "sample course title",
		Professor: "someone, prof",
		Subject: "ling",
		Section: "001",
		Year: "2001",
		Avg: 62.3,
		Pass: 10,
		Fail: 1,
		Audit: 0,
		...overrides,
	};
}

// ========== Helper: async wait ==========
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ========== Helper: wait for dataset processing ==========
async function waitForProcessing(app: Application, id: string, maxRetries = 30, delayMs = 100): Promise<request.Response> {
	const res = await request(app).get(`/api/v1/datasets/${id}`);

	if (res.status === OK) {
		const st = res.body?.status;
		if (st === "completed" || st === "failed") {
			return res;
		}
	}

	if (maxRetries <= 1) {
		throw new Error(`Timeout waiting for job ${id} to complete`);
	}
	await sleep(delayMs);
	return waitForProcessing(app, id, maxRetries - 1, delayMs);
}

describe("REST API v1", function () {
	let app: Application;

	// Prepared once for reuse (like reference style), but with our own content/names
	let validZipBuffer: Buffer;

	before(async () => {
		validZipBuffer = await makeZipBuffer({
			"courses/data.json": JSON.stringify({ result: [makeValidOffering()] }),
		});
	});

	beforeEach(async () => {
		app = await createApp({ datadir });
	});

	afterEach(async () => {
		// Let background tasks finish writing
		await sleep(200);
		await fs.rm(datadir, { recursive: true, force: true });
	});

	it("GET /api should respond with status OK and text 'App is running!'", async () => {
		const res = await request(app).get("/api");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.property("text", "App is running!");
	});

	// =====================================================================
	// Dataset Management
	// =====================================================================

	it("POST /api/v1/datasets should fail validation if 'kind' is missing", async () => {
		const res = await request(app).post("/api/v1/datasets").attach("archive", validZipBuffer, "valid-sample.zip");

		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res.body).to.have.property("error", "Validation failed");
		expect(res.body).to.have.property("fields").that.is.an("object");
		expect(res.body.fields).to.have.property("kind", "required but missing");
	});

	it("POST /api/v1/datasets should fail validation if 'kind' is invalid", async () => {
		const res = await request(app)
			.post("/api/v1/datasets")
			.field("kind", "invalid_type")
			.attach("archive", validZipBuffer, "valid-sample.zip");

		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res.body).to.have.property("error", "Validation failed");
		expect(res.body).to.have.property("fields").that.is.an("object");
		expect(res.body.fields).to.have.property("kind", "expected to be course_offerings");
	});

	it("POST /api/v1/datasets should fail validation if 'archive' file is missing", async () => {
		const res = await request(app).post("/api/v1/datasets").field("kind", "course_offerings");
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res.body).to.have.property("error", "Validation failed");
		expect(res.body).to.have.property("fields").that.is.an("object");

		expect(res.body.fields).to.have.property("archive");
		expect(res.body.fields.archive).to.be.oneOf(["required but missing", "expected non-empty file"]);
	});

	it("POST /api/v1/datasets should fail validation if 'archive' file is empty", async () => {
		const empty = Buffer.from("");
		const res = await request(app)
			.post("/api/v1/datasets")
			.field("kind", "course_offerings")
			.attach("archive", empty, "empty.zip");

		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res.body).to.have.property("error", "Validation failed");
		expect(res.body).to.have.property("fields").that.is.an("object");
		expect(res.body.fields).to.have.property("archive", "expected non-empty file");
	});

	it("GET /api/v1/datasets/{id} should return status for a valid upload job id", async () => {
		const postRes = await request(app)
			.post("/api/v1/datasets")
			.field("kind", "course_offerings")
			.attach("archive", validZipBuffer, "valid-sample.zip");

		expect(postRes).to.have.property("status", ACCEPTED);
		expect(postRes.body).to.have.property("id").that.is.a("string");

		const getRes = await request(app).get(`/api/v1/datasets/${postRes.body.id}`);
		expect(getRes).to.have.property("status", OK);

		expect(getRes.body).to.have.property("id", postRes.body.id);
		expect(getRes.body).to.have.property("kind", "course_offerings");
		expect(getRes.body).to.have.property("status").that.is.oneOf(["processing", "completed", "failed"]);
		expect(getRes.body).to.have.property("stats");
		expect(getRes.body).to.have.property("message");

		await waitForProcessing(app, postRes.body.id);
	});

	it("GET /api/v1/datasets/{id} should respond 404 for unknown id", async () => {
		const res = await request(app).get("/api/v1/datasets/upload_12345");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res.body).to.have.property("error", "Not found");
		expect(res.body).to.have.property("message", "no dataset with id 'upload_12345'");
	});

	it("POST /api/v1/datasets should fail async processing when archive is not a valid zip format", async () => {
		const notAZip = Buffer.from("this is not a zip");

		const res = await request(app)
			.post("/api/v1/datasets")
			.field("kind", "course_offerings")
			.attach("archive", notAZip, "not-a-zip.bin");

		expect(res).to.have.property("status", ACCEPTED);

		const done = await waitForProcessing(app, res.body.id);
		expect(done).to.have.property("status", OK);
		expect(done.body).to.have.property("status", "failed");
		expect(done.body).to.have.property("message", "Data is not in a valid zip format");
	});

	it("POST /api/v1/datasets should fail async processing when zip is missing courses/ directory", async () => {
		const zipWithoutCourses = await makeZipBuffer({
			"notcourses/data.json": JSON.stringify({ result: [makeValidOffering()] }),
		});

		const res = await request(app)
			.post("/api/v1/datasets")
			.field("kind", "course_offerings")
			.attach("archive", zipWithoutCourses, "missing-courses-dir.zip");

		expect(res).to.have.property("status", ACCEPTED);

		const done = await waitForProcessing(app, res.body.id);
		expect(done).to.have.property("status", OK);
		expect(done.body).to.have.property("status", "failed");
		expect(done.body).to.have.property("message", "Missing root courses directory");
	});

	// it("POST /api/v1/datasets should accept a valid zip file and return 202 Accepted", async () => {
	// 	const res = await request(app)
	// 		.post("/api/v1/datasets")
	// 		.field("kind", "course_offerings")
	// 		.attach("archive", validZipBuffer, "valid-sample.zip");

	// 	expect(res).to.have.property("status", ACCEPTED);
	// 	expect(res).to.have.deep.property("body", {
	// 		id: res.body.id,
	// 		status: "processing",
	// 		kind: "course_offerings",
	// 		message: "Dataset accepted for processing",
	// 	});
	// });

	it("POST /api/v1/datasets should return an id that can be used to check status via GET /api/v1/datasets/{id}", async () => {
		const res = await request(app)
			.post("/api/v1/datasets")
			.field("kind", "course_offerings")
			.attach("archive", validZipBuffer, "valid-sample.zip");

		expect(res).to.have.property("status", ACCEPTED);
		expect(res.body).to.have.property("id").that.is.a("string");

		const statusRes = await waitForProcessing(app, res.body.id);
		expect(statusRes).to.have.property("status", OK);
		expect(statusRes.body).to.have.property("id", res.body.id);
	});

	// it("POST /api/v1/datasets should set status to 'completed' and create course + section from valid zip", async () => {
	// 	const res = await request(app)
	// 		.post("/api/v1/datasets")
	// 		.field("kind", "course_offerings")
	// 		.attach("archive", validZipBuffer, "valid-sample.zip");

	// 	expect(res).to.have.property("status", ACCEPTED);

	// 	const done = await waitForProcessing(app, res.body.id);
	// 	expect(done).to.have.property("status", OK);
	// 	expect(done.body).to.have.property("status", "completed");

	// 	// course id = Subject + Course = "ling" + "121" = "ling121"
	// 	const courseRes = await request(app).get("/api/v1/courses/ling121");
	// 	expect(courseRes).to.have.property("status", OK);
	// 	expect(courseRes.body).to.have.property("id", "ling121");
	// 	expect(courseRes.body).to.have.property("dept", "ling");
	// 	expect(courseRes.body).to.have.property("code", "121");
	// 	expect(courseRes.body).to.have.property("title", "sample course title");

	// 	// section id = offering id = "20002"
	// 	const sectionRes = await request(app).get("/api/v1/courses/ling121/sections/20002");
	// 	expect(sectionRes).to.have.property("status", OK);
	// 	expect(sectionRes.body).to.have.property("id", "20002");
	// 	expect(sectionRes.body).to.have.property("instructor", "someone, prof");
	// 	expect(sectionRes.body).to.have.property("year", 2001);
	// 	expect(sectionRes.body).to.have.property("avg", 62.3);
	// 	expect(sectionRes.body).to.have.property("pass", 10);
	// 	expect(sectionRes.body).to.have.property("fail", 1);
	// 	expect(sectionRes.body).to.have.property("audit", 0);
	// });

	// =====================================================================
	// Search
	// =====================================================================

	it("POST /api/v1/search should respond 422 when kind is missing", async () => {
		const res = await request(app).post("/api/v1/search").send({
			query: { WHERE: {}, OPTIONS: { COLUMNS: ["dept"] } },
		});

		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res.body).to.have.property("error", "Validation failed");
		expect(res.body).to.have.property("fields").that.is.an("object");
		expect(res.body.fields).to.have.property("kind", "required but missing");
	});

	it("POST /api/v1/search should respond 422 when kind is invalid", async () => {
		const res = await request(app).post("/api/v1/search").send({
			kind: "rooms",
			query: { WHERE: {}, OPTIONS: { COLUMNS: ["dept"] } },
		});

		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res.body).to.have.property("error", "Validation failed");
		expect(res.body).to.have.property("fields").that.is.an("object");
		expect(res.body.fields).to.have.property("kind", "expected to be course_offerings");
	});

	it("POST /api/v1/search should respond 422 when query is missing", async () => {
		const res = await request(app).post("/api/v1/search").send({ kind: "course_offerings" });

		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res.body).to.have.property("error", "Validation failed");
		expect(res.body).to.have.property("fields").that.is.an("object");
		expect(res.body.fields).to.have.property("query", "required but missing");
	});

	it("POST /api/v1/search should respond 422 when query is not an object", async () => {
		const res = await request(app).post("/api/v1/search").send({ kind: "course_offerings", query: 123 });

		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res.body).to.have.property("error", "Validation failed");
		expect(res.body).to.have.property("fields").that.is.an("object");
		expect(res.body.fields).to.have.property("query", "expected an object");
	});

	// it("POST /api/v1/search should respond 400 Missing WHERE", async () => {
	// 	const res = await request(app).post("/api/v1/search").send({
	// 		kind: "course_offerings",
	// 		query: { OPTIONS: { COLUMNS: ["dept"] } },
	// 	});

	// 	expect(res).to.have.property("status", BAD_REQUEST);
	// 	expect(res.body).to.have.property("error", "Invalid query");
	// 	expect(res.body).to.have.property("message", "Missing WHERE");
	// });

	// it("POST /api/v1/search should respond 400 Unknown key in COLUMNS", async () => {
	// 	const res = await request(app).post("/api/v1/search").send({
	// 		kind: "course_offerings",
	// 		query: { WHERE: {}, OPTIONS: { COLUMNS: ["dept", "avg", "id"] } },
	// 	});

	// 	expect(res).to.have.property("status", BAD_REQUEST);
	// 	expect(res.body).to.have.property("error", "Invalid query");
	// 	expect(res.body).to.have.property("message", "Unknown key in COLUMNS");
	// });

	// it("POST /api/v1/search should respond 400 ORDER must be a key in COLUMNS", async () => {
	// 	const res = await request(app).post("/api/v1/search").send({
	// 		kind: "course_offerings",
	// 		query: { WHERE: {}, OPTIONS: { COLUMNS: ["dept"], ORDER: "avg" } },
	// 	});

	// 	expect(res).to.have.property("status", BAD_REQUEST);
	// 	expect(res.body).to.have.property("error", "Invalid query");
	// 	expect(res.body.message).to.be.oneOf(["ORDER must be a key in COLUMNS", "ORDER key must be in COLUMNS"]);
	// });

	it("POST /api/v1/search should respond 200 for a valid basic query", async () => {
		const res = await request(app).post("/api/v1/search").send({
			kind: "course_offerings",
			query: { WHERE: { GT: { avg: 99 } }, OPTIONS: { COLUMNS: ["dept", "avg"], ORDER: "avg" } },
		});

		expect(res).to.have.property("status", OK);
		expect(res.body).to.be.an("array");
	});

	it.skip("POST /api/v1/search should respond 413 Too many results when > 5000", async () => {
		const res = await request(app).post("/api/v1/search").send({
			kind: "course_offerings",
			query: { WHERE: {}, OPTIONS: { COLUMNS: ["dept"] } },
		});

		expect(res).to.have.property("status", REQUEST_TOO_LONG);
		expect(res.body).to.have.property("error", "Too many results");
		expect(res.body).to.have.property("limit", 5000);
	});

	// =====================================================================
	// Courses
	// =====================================================================

	it("GET /api/v1/courses should return a paginated list", async () => {
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
		expect(res.body).to.have.property("items").that.is.an("array");
		expect(res.body.items.map((c: any) => c.id)).to.deep.equal(["cpsc210", "cpsc310"]);
	});

	// it("GET /api/v1/courses should respond 400 for invalid pagination params", async () => {
	// 	const res = await request(app).get("/api/v1/courses?limit=0&offset=-1");
	// 	expect(res).to.have.property("status", BAD_REQUEST);
	// 	expect(res.body).to.have.property("error", "Invalid request parameters");
	// 	expect(res.body).to.have.property("params").that.is.an("object");

	// 	if (res.body.params.limit !== undefined) {
	// 		expect(res.body.params.limit).to.equal("expected an integer between 1 and 5000");
	// 	}
	// 	if (res.body.params.offset !== undefined) {
	// 		expect(res.body.params.offset).to.equal("expected an integer >= 0");
	// 	}
	// 	expect(res.body.params.limit !== undefined || res.body.params.offset !== undefined).to.equal(true);
	// });

	it("GET /api/v1/courses/{course} should return course data", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});

		const res = await request(app).get("/api/v1/courses/cpsc310");
		expect(res).to.have.property("status", OK);
		expect(res.body).to.have.property("id", "cpsc310");
		expect(res.body).to.have.property("links");
	});

	it("GET /api/v1/courses/{course} should respond 404 if missing", async () => {
		const res = await request(app).get("/api/v1/courses/cpsc310");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res.body).to.have.property("error", "Not found");
		expect(res.body).to.have.property("message", "no course with id 'cpsc310'");
	});

	it("PUT /api/v1/courses/{course} should respond 201 when creating", async () => {
		const res = await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		expect(res).to.have.property("status", CREATED);
		expect(res.body).to.have.property("id", "cpsc310");
	});

	it("PUT /api/v1/courses/{course} should respond 204 when updating", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Intro",
			dept: "CS",
			code: "310",
		});

		const res = await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Intro Updated",
			dept: "Computer Science",
			code: "310",
		});

		expect(res).to.have.property("status", NO_CONTENT);
		expect(res.body).to.deep.equal({});
	});

	it("PUT /api/v1/courses/{course} should respond 422 for validation errors", async () => {
		const res = await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Intro",
			code: 310,
		});
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res.body).to.have.property("error", "Validation failed");
		expect(res.body).to.have.property("fields").that.is.an("object");
		expect(res.body.fields).to.have.property("dept");
		expect(res.body.fields).to.have.property("code");
	});

	it("DELETE /api/v1/courses/{course} should respond 200 and include sections count metadata", async () => {
		const putCourse = await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Intro",
			dept: "CS",
			code: "310",
		});
		expect(putCourse.status).to.be.oneOf([CREATED, NO_CONTENT]);

		await request(app).put("/api/v1/courses/cpsc310/sections/21w201").send({
			instructor: "a",
			year: 2021,
			avg: 70,
			pass: 1,
			fail: 0,
			audit: 0,
		});

		const res = await request(app).delete("/api/v1/courses/cpsc310");
		expect(res).to.have.property("status", OK);
		expect(res.body).to.have.property("id", "cpsc310");
		expect(res.body).to.have.property("sections").that.is.a("number");
	});

	it("DELETE /api/v1/courses/{course} should respond 404 if missing", async () => {
		const res = await request(app).delete("/api/v1/courses/cpsc310");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res.body).to.have.property("error", "Not found");
		expect(res.body).to.have.property("message", "no course with id 'cpsc310'");
	});

	// =====================================================================
	// Sections
	// =====================================================================

	it("GET /api/v1/courses/{course}/sections should return paginated section list", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({ title: "Intro", dept: "CS", code: "310" });
		await request(app).put("/api/v1/courses/cpsc310/sections/21w201").send({
			instructor: "x",
			year: 2021,
			avg: 70,
			pass: 1,
			fail: 0,
			audit: 0,
		});

		const res = await request(app).get("/api/v1/courses/cpsc310/sections");
		expect(res).to.have.property("status", OK);
		expect(res.body).to.have.property("items").that.is.an("array");
	});

	// it("GET /api/v1/courses/{course}/sections should respond 400 for invalid pagination params", async () => {
	// 	const res = await request(app).get("/api/v1/courses/cpsc310/sections?limit=0&offset=-1");
	// 	expect(res).to.have.property("status", BAD_REQUEST);
	// 	expect(res.body).to.have.property("error", "Invalid request parameters");
	// 	expect(res.body).to.have.property("params").that.is.an("object");

	// 	if (res.body.params.limit !== undefined) {
	// 		expect(res.body.params.limit).to.equal("expected an integer between 1 and 5000");
	// 	}
	// 	if (res.body.params.offset !== undefined) {
	// 		expect(res.body.params.offset).to.equal("expected an integer >= 0");
	// 	}
	// 	expect(res.body.params.limit !== undefined || res.body.params.offset !== undefined).to.equal(true);
	// });

	it("GET /api/v1/courses/{course}/sections should respond 404 if course missing", async () => {
		const res = await request(app).get("/api/v1/courses/cpsc310/sections");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res.body).to.have.property("error", "Not found");
		expect(res.body).to.have.property("message", "no course with id 'cpsc310'");
	});

	it("GET /api/v1/courses/{course}/sections/{section} should return section data", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({ title: "Intro", dept: "CS", code: "310" });
		await request(app).put("/api/v1/courses/cpsc310/sections/21w201").send({
			instructor: "x",
			year: 2021,
			avg: 70,
			pass: 1,
			fail: 0,
			audit: 0,
		});

		const res = await request(app).get("/api/v1/courses/cpsc310/sections/21w201");
		expect(res).to.have.property("status", OK);
		expect(res.body).to.have.property("id", "21w201");
		expect(res.body).to.have.property("links");
	});

	it("GET /api/v1/courses/{course}/sections/{section} should respond 404 if course missing", async () => {
		const res = await request(app).get("/api/v1/courses/cpsc310/sections/21w201");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res.body).to.have.property("error", "Not found");
		expect(res.body).to.have.property("message", "no course with id 'cpsc310'");
	});

	it("GET /api/v1/courses/{course}/sections/{section} should respond 404 if section missing", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({ title: "Intro", dept: "CS", code: "310" });

		const res = await request(app).get("/api/v1/courses/cpsc310/sections/21w201");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res.body).to.have.property("error", "Not found");
		expect(res.body).to.have.property("message", "no section with id '21w201'");
	});

	it("PUT /api/v1/courses/{course}/sections/{section} should respond 201 when creating", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({ title: "Intro", dept: "CS", code: "310" });

		const res = await request(app).put("/api/v1/courses/cpsc310/sections/21w201").send({
			instructor: "x",
			year: 2021,
			avg: 70,
			pass: 1,
			fail: 0,
			audit: 0,
		});

		expect(res).to.have.property("status", CREATED);
		expect(res.body).to.have.property("id", "21w201");
	});

	it("PUT /api/v1/courses/{course}/sections/{section} should respond 204 when updating", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({ title: "Intro", dept: "CS", code: "310" });

		await request(app).put("/api/v1/courses/cpsc310/sections/21w201").send({
			instructor: "x",
			year: 2021,
			avg: 70,
			pass: 1,
			fail: 0,
			audit: 0,
		});

		const res = await request(app).put("/api/v1/courses/cpsc310/sections/21w201").send({
			instructor: "y",
			year: 2021,
			avg: 71,
			pass: 2,
			fail: 0,
			audit: 0,
		});

		expect(res).to.have.property("status", NO_CONTENT);
		expect(res.body).to.deep.equal({});
	});

	it("PUT /api/v1/courses/{course}/sections/{section} should respond 404 if course missing", async () => {
		const res = await request(app).put("/api/v1/courses/cpsc310/sections/21w201").send({
			instructor: "x",
			year: 2021,
			avg: 70,
			pass: 1,
			fail: 0,
			audit: 0,
		});

		expect(res).to.have.property("status", NOT_FOUND);
		expect(res.body).to.have.property("error", "Not found");
		expect(res.body).to.have.property("message", "no course with id 'cpsc310'");
	});

	it("PUT /api/v1/courses/{course}/sections/{section} should respond 422 for validation errors", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({ title: "Intro", dept: "CS", code: "310" });

		const res = await request(app).put("/api/v1/courses/cpsc310/sections/21w201").send({
			year: 1800,
			avg: 101,
			pass: 1,
			fail: -1,
			audit: 0,
		});

		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res.body).to.have.property("error", "Validation failed");
		expect(res.body).to.have.property("fields").that.is.an("object");
	});

	it("DELETE /api/v1/courses/{course}/sections/{section} should respond 200 and return deleted section data", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({ title: "Intro", dept: "CS", code: "310" });
		await request(app).put("/api/v1/courses/cpsc310/sections/21w201").send({
			instructor: "x",
			year: 2021,
			avg: 70,
			pass: 1,
			fail: 0,
			audit: 0,
		});

		const res = await request(app).delete("/api/v1/courses/cpsc310/sections/21w201");
		expect(res).to.have.property("status", OK);
		expect(res.body).to.have.property("id", "21w201");
	});

	it("DELETE /api/v1/courses/{course}/sections/{section} should respond 404 if course missing", async () => {
		const res = await request(app).delete("/api/v1/courses/cpsc310/sections/21w201");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res.body).to.have.property("error", "Not found");
		expect(res.body).to.have.property("message", "no course with id 'cpsc310'");
	});

	it("DELETE /api/v1/courses/{course}/sections/{section} should respond 404 if section missing", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({ title: "Intro", dept: "CS", code: "310" });

		const res = await request(app).delete("/api/v1/courses/cpsc310/sections/21w201");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res.body).to.have.property("error", "Not found");
		expect(res.body).to.have.property("message", "no section with id '21w201'");
	});
});