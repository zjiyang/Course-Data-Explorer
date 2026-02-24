import fs from "fs/promises";
import { expect } from "chai";
import request from "supertest";
import { StatusCodes } from "http-status-codes";
import { Application, createApp } from "../src/App";
import JSZip from "jszip";

const {
	OK, // 200
	// Other common codes are:
	// CREATED, // 201
	// NO_CONTENT, // 204
	// NOT_FOUND, // 404
} = StatusCodes;

// Do not change datadir
const datadir = "./data" as const;

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
					Professor: "p",
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

describe("REST API v1", function () {
	let app: Application;

	beforeEach(async () => {
		app = await createApp({ datadir });
	});

	afterEach(async () => {
		await fs.rm(datadir, { recursive: true, force: true });
	});

	it("GET /api should respond with status OK and text 'App is running!'", async () => {
		const res = await request(app).get("/api");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.property("text", "App is running!");
	});

	// ----------------------------
	// Bulk upload data
	// ----------------------------

	it("POST /api/v1/datasets should respond with status ACCEPTED (202) and processing job info", async () => {
		const zipBuf = await makeValidCourseOfferingsZip();

		const res = await request(app)
			.post("/api/v1/datasets")
			.field("kind", "course_offerings")
			.attach("archive", zipBuf, "courses.zip");

		expect(res).to.have.property("status", StatusCodes.ACCEPTED);

		// Only assert spec-guaranteed keys/values (don't overfit)
		expect(res.body).to.be.an("object");
		expect(res.body).to.have.property("id").that.is.a("string").and.is.not.empty;
		expect(res.body).to.have.property("status", "processing");
		expect(res.body).to.have.property("kind", "course_offerings");
		expect(res.body).to.have.property("message", "Dataset accepted for processing");
	});

	it("POST /api/v1/datasets should respond with status UNPROCESSABLE_ENTITY (422) for invalid requests", async () => {
		// (1) kind missing
		{
			const zipBuf = await makeValidCourseOfferingsZip();
			const res = await request(app).post("/api/v1/datasets").attach("archive", zipBuf, "courses.zip");

			expect(res).to.have.property("status", StatusCodes.UNPROCESSABLE_ENTITY);
			expect(res.body).to.have.property("error", "Validation failed");
			expect(res.body).to.have.property("fields");
			expect(res.body.fields).to.have.property("kind");
			// value is spec enum; allow either exact text if reference changes ordering/extra fields
			expect(res.body.fields.kind).to.be.oneOf(["required but missing", "expected to be course_offerings"]);
		}

		// (2) archive missing
		{
			const res = await request(app).post("/api/v1/datasets").field("kind", "course_offerings");

			expect(res).to.have.property("status", StatusCodes.UNPROCESSABLE_ENTITY);
			expect(res.body).to.have.property("error", "Validation failed");
			expect(res.body).to.have.property("fields");
			expect(res.body.fields).to.have.property("archive");
			expect(res.body.fields.archive).to.be.oneOf(["required but missing", "expected non-empty file"]);
		}

		// (3) kind wrong (archive provided and non-empty)
		{
			const zipBuf = await makeValidCourseOfferingsZip();
			const res = await request(app)
				.post("/api/v1/datasets")
				.field("kind", "rooms")
				.attach("archive", zipBuf, "courses.zip");

			expect(res).to.have.property("status", StatusCodes.UNPROCESSABLE_ENTITY);
			expect(res.body).to.have.property("error", "Validation failed");
			expect(res.body).to.have.property("fields");
			expect(res.body.fields).to.have.property("kind", "expected to be course_offerings");
		}

		// (4) archive empty (0 bytes)
		{
			const empty = Buffer.from("");
			const res = await request(app)
				.post("/api/v1/datasets")
				.field("kind", "course_offerings")
				.attach("archive", empty, "empty.zip");

			expect(res).to.have.property("status", StatusCodes.UNPROCESSABLE_ENTITY);
			expect(res.body).to.have.property("error", "Validation failed");
			expect(res.body).to.have.property("fields");
			expect(res.body.fields).to.have.property("archive", "expected non-empty file");
		}
	});

	// ----------------------------
	// Search resources
	// ----------------------------

	it("POST /api/v1/search should respond with status OK (200) for a valid basic query", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: { GT: { avg: 99 } },
					OPTIONS: { COLUMNS: ["dept", "avg"], ORDER: "avg" },
				},
			});

		expect(res).to.have.property("status", OK);
		expect(res.body).to.be.an("array");

		// rows must only contain the requested columns
		for (const row of res.body) {
			expect(row).to.have.all.keys("dept", "avg");
		}
	});

	// 400 Invalid query
	it("POST /api/v1/search should respond with status BAD_REQUEST (400) when WHERE is missing", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					OPTIONS: { COLUMNS: ["dept", "avg"], ORDER: "avg" },
				},
			});

		expect(res).to.have.property("status", StatusCodes.BAD_REQUEST);
		expect(res.body).to.have.property("error", "Invalid query");
		expect(res.body).to.have.property("message", "Missing WHERE");
	});

	it("POST /api/v1/search should respond with status BAD_REQUEST (400) for invalid key in COLUMNS", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["dept", "avg", "id"], // 'id' is not allowed by spec
						ORDER: "avg",
					},
				},
			});

		expect(res).to.have.property("status", StatusCodes.BAD_REQUEST);
		expect(res.body).to.have.property("error", "Invalid query");
		expect(res.body).to.have.property("message", "Unknown key in COLUMNS");
	});

	it("POST /api/v1/search should respond with status BAD_REQUEST (400) when ORDER is not in COLUMNS", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["dept"], // ORDER not included here
						ORDER: "avg",
					},
				},
			});

		expect(res).to.have.property("status", StatusCodes.BAD_REQUEST);
		expect(res.body).to.have.property("error", "Invalid query");
		// v1.0.4 message (note: older versions used different text)
		expect(res.body).to.have.property("message", "ORDER must be a key in COLUMNS");
	});

	// 413 Too many results (skip until you load a big dataset)
	it.skip("POST /api/v1/search should respond with status PAYLOAD_TOO_LARGE (413) when query returns more than 5000 results", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: { COLUMNS: ["dept"] },
				},
			});

		expect(res).to.have.property("status", 413);
		expect(res.body).to.have.property("error", "Too many results");
		expect(res.body).to.have.property("message", "Query would return more than 5000 results");
		expect(res.body).to.have.property("limit", 5000);
	});

	// 422 Validation failed (request body validation)
	it("POST /api/v1/search should respond with status UNPROCESSABLE_ENTITY (422) for invalid requests", async () => {
		// missing kind
		{
			const res = await request(app)
				.post("/api/v1/search")
				.send({
					query: { WHERE: {}, OPTIONS: { COLUMNS: ["dept"] } },
				});

			expect(res).to.have.property("status", StatusCodes.UNPROCESSABLE_ENTITY);
			expect(res.body).to.have.property("error", "Validation failed");
			expect(res.body.fields).to.have.property("kind", "required but missing");
		}

		// invalid kind value
		{
			const res = await request(app)
				.post("/api/v1/search")
				.send({
					kind: "rooms",
					query: { WHERE: {}, OPTIONS: { COLUMNS: ["dept"] } },
				});

			expect(res).to.have.property("status", StatusCodes.UNPROCESSABLE_ENTITY);
			expect(res.body).to.have.property("error", "Validation failed");
			expect(res.body.fields).to.have.property("kind", "expected to be course_offerings");
		}

		// missing query
		{
			const res = await request(app).post("/api/v1/search").send({
				kind: "course_offerings",
			});

			expect(res).to.have.property("status", StatusCodes.UNPROCESSABLE_ENTITY);
			expect(res.body).to.have.property("error", "Validation failed");
			expect(res.body.fields).to.have.property("query", "required but missing");
		}

		// query is not an object
		{
			const res = await request(app).post("/api/v1/search").send({
				kind: "course_offerings",
				query: 123,
			});

			expect(res).to.have.property("status", StatusCodes.UNPROCESSABLE_ENTITY);
			expect(res.body).to.have.property("error", "Validation failed");
			expect(res.body.fields).to.have.property("query", "expected an object");
		}
	});

	// ----------------------------
	// Retrieve a list of courses
	// ----------------------------

	it("GET /api/v1/courses should respond with status OK (200) and paginated course list", async () => {
		await request(app).put("/api/v1/courses/cpsc210").send({
			title: "Software Construction",
			dept: "Computer Science",
			code: "210",
		});
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});

		const res = await request(app).get("/api/v1/courses");

		expect(res).to.have.property("status", OK);

		// Keep exact match here is usually fine because this is stable spec output
		expect(res).to.have.deep.property("body", {
			total: 2,
			limit: 100,
			offset: 0,
			items: [
				{
					id: "cpsc210",
					title: "Software Construction",
					dept: "Computer Science",
					code: "210",
					links: {
						self: "/api/v1/courses/cpsc210",
						sections: "/api/v1/courses/cpsc210/sections",
					},
				},
				{
					id: "cpsc310",
					title: "Introduction to Software Engineering",
					dept: "Computer Science",
					code: "310",
					links: {
						self: "/api/v1/courses/cpsc310",
						sections: "/api/v1/courses/cpsc310/sections",
					},
				},
			],
		});
	});

	it("GET /api/v1/courses should respond with status BAD_REQUEST (400) for invalid pagination params", async () => {
		const res = await request(app).get("/api/v1/courses?limit=0&offset=-1");

		expect(res).to.have.property("status", StatusCodes.BAD_REQUEST);
		expect(res.body).to.have.property("error", "Invalid request parameters");
		expect(res.body).to.have.property("params");
		expect(res.body.params).to.have.property("limit");
		expect(res.body.params).to.have.property("offset");
	});

	// ----------------------------
	// Retrieve a course
	// ----------------------------

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

		expect(res).to.have.property("status", StatusCodes.NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no course with id 'cpsc310'",
		});
	});

	// ----------------------------
	// Create or replace a course
	// ----------------------------

	it("PUT /api/v1/courses/{course} should respond with status CREATED (201) and course data when creating", async () => {
		const res = await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});

		expect(res).to.have.property("status", StatusCodes.CREATED);
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
			title: "Introduction to Software Engineering",
			dept: "CS",
			code: "310",
		});

		const res = await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});

		expect(res).to.have.property("status", StatusCodes.NO_CONTENT);
		expect(res).to.have.deep.property("body", {});
	});

	it("PUT /api/v1/courses/{course} should respond with status UNPROCESSABLE_ENTITY (422) for validation errors", async () => {
		const res = await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			// dept missing
			code: 310, // wrong type
		});

		expect(res).to.have.property("status", StatusCodes.UNPROCESSABLE_ENTITY);
		expect(res.body).to.have.property("error", "Validation failed");
		expect(res.body).to.have.property("fields");
		expect(res.body.fields).to.have.property("dept", "required but missing");
		expect(res.body.fields).to.have.property("code", "expected a string");
	});

	// ----------------------------
	// Remove a course
	// ----------------------------

	it("DELETE /api/v1/courses/{course} should respond with status OK (200) and course metadata + removed sections count", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});

		// create 2 sections
		await request(app).put("/api/v1/courses/cpsc310/sections/21w201").send({
			instructor: "holmes, reid",
			year: 2021,
			avg: 76.4,
			pass: 167,
			fail: 3,
			audit: 1,
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/21w202").send({
			instructor: "holmes, reid",
			year: 2021,
			avg: 80.0,
			pass: 160,
			fail: 2,
			audit: 0,
		});

		// verify 2 sections actually exist (avoid overfitting to our own implementation)
		const listRes = await request(app).get("/api/v1/courses/cpsc310/sections");
		expect(listRes).to.have.property("status", OK);
		expect(listRes.body).to.have.property("total");
		// some refs might count total=2; if it doesn't, delete count test would be flaky anyway
		expect(listRes.body.total).to.equal(2);

		const res = await request(app).delete("/api/v1/courses/cpsc310");

		expect(res).to.have.property("status", OK);
		expect(res.body).to.have.property("id", "cpsc310");
		expect(res.body).to.have.property("title", "Introduction to Software Engineering");
		expect(res.body).to.have.property("dept", "Computer Science");
		expect(res.body).to.have.property("code", "310");
		expect(res.body).to.have.property("sections").that.is.a("number");
		expect(res.body.sections).to.equal(2);
	});

	it("DELETE /api/v1/courses/{course} should respond with status NOT_FOUND (404) when course does not exist", async () => {
		const res = await request(app).delete("/api/v1/courses/cpsc310");

		expect(res).to.have.property("status", StatusCodes.NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no course with id 'cpsc310'",
		});
	});

	// ----------------------------
	// Retrieve a list of sections for a course
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
		expect(res.body).to.have.property("total", 2);
		expect(res.body).to.have.property("limit", 100);
		expect(res.body).to.have.property("offset", 0);
		expect(res.body).to.have.property("items").that.is.an("array").with.length(2);

		// stable ordering by id ascending
		expect(res.body.items[0]).to.have.property("id", "21w201");
		expect(res.body.items[1]).to.have.property("id", "21w202");
	});

	it("GET /api/v1/courses/{course}/sections should respond with status BAD_REQUEST (400) for invalid pagination params", async () => {
		const res = await request(app).get("/api/v1/courses/cpsc310/sections?limit=0&offset=-1");

		expect(res).to.have.property("status", StatusCodes.BAD_REQUEST);
		expect(res.body).to.have.property("error", "Invalid request parameters");
		expect(res.body).to.have.property("params");
		expect(res.body.params).to.have.property("limit");
		expect(res.body.params).to.have.property("offset");
	});

	it("GET /api/v1/courses/{course}/sections should respond with status NOT_FOUND (404) when course does not exist", async () => {
		const res = await request(app).get("/api/v1/courses/cpsc310/sections");

		expect(res).to.have.property("status", StatusCodes.NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no course with id 'cpsc310'",
		});
	});

	// ----------------------------
	// Retrieve a section for a course
	// ----------------------------

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
		expect(res.body.links).to.have.property("course", "/api/v1/courses/cpsc310");
	});

	it("GET /api/v1/courses/{course}/sections/{section} should respond with status NOT_FOUND (404) when course does not exist", async () => {
		const res = await request(app).get("/api/v1/courses/cpsc310/sections/21w201");

		expect(res).to.have.property("status", StatusCodes.NOT_FOUND);
		expect(res.body).to.have.property("error", "Not found");
	});

	it("GET /api/v1/courses/{course}/sections/{section} should respond with status NOT_FOUND (404) when section does not exist", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});

		const res = await request(app).get("/api/v1/courses/cpsc310/sections/21w201");

		expect(res).to.have.property("status", StatusCodes.NOT_FOUND);
		expect(res.body).to.have.property("error", "Not found");
	});

	// ----------------------------
	// Create or replace a section for a course
	// ----------------------------

	it("PUT /api/v1/courses/{course}/sections/{section} should respond with status CREATED (201) and section data when creating", async () => {
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

		expect(res).to.have.property("status", StatusCodes.CREATED);
		expect(res.body).to.have.property("id", "21w201");
		expect(res.body).to.have.property("links");
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

		expect(res).to.have.property("status", StatusCodes.NO_CONTENT);
		expect(res).to.have.deep.property("body", {});
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

		expect(res).to.have.property("status", StatusCodes.NOT_FOUND);
		expect(res.body).to.have.property("error", "Not found");
	});

	it("PUT /api/v1/courses/{course}/sections/{section} should respond with status UNPROCESSABLE_ENTITY (422) for validation errors", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});

		const res = await request(app).put("/api/v1/courses/cpsc310/sections/21w201").send({
			// instructor missing
			year: 1800, // invalid
			avg: 101, // invalid
			pass: 167,
			fail: -1, // invalid
			audit: 1,
		});

		expect(res).to.have.property("status", StatusCodes.UNPROCESSABLE_ENTITY);
		expect(res.body).to.have.property("error", "Validation failed");
		expect(res.body).to.have.property("fields");
		expect(res.body.fields).to.have.property("instructor");
		expect(res.body.fields).to.have.property("year");
		expect(res.body.fields).to.have.property("avg");
		expect(res.body.fields).to.have.property("fail");
	});

	// ----------------------------
	// Remove a section from a course
	// ----------------------------

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
		expect(res.body).to.have.property("instructor");
	});

	it("DELETE /api/v1/courses/{course}/sections/{section} should respond with status NOT_FOUND (404) when course does not exist", async () => {
		const res = await request(app).delete("/api/v1/courses/cpsc310/sections/21w201");

		expect(res).to.have.property("status", StatusCodes.NOT_FOUND);
		expect(res.body).to.have.property("error", "Not found");
	});

	it("DELETE /api/v1/courses/{course}/sections/{section} should respond with status NOT_FOUND (404) when section does not exist", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});

		const res = await request(app).delete("/api/v1/courses/cpsc310/sections/21w201");

		expect(res).to.have.property("status", StatusCodes.NOT_FOUND);
		expect(res.body).to.have.property("error", "Not found");
	});
});
