import fs from "fs/promises";
import { expect } from "chai";
import request from "supertest";
import { StatusCodes } from "http-status-codes";
import { Application, createApp } from "../src/App";

const {
	OK, // 200
	// Other common codes are:
	// CREATED, // 201
	// NO_CONTENT, // 204
	// NOT_FOUND, // 404
} = StatusCodes;

// Do not change datadir
const datadir = "./data" as const;

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

	// Bulk upload data
	it("POST /api/v1/datasets should respond with status ACCEPTED (202) and processing job info", async () => {
		const dummy = Buffer.from("not-a-real-zip");
		const res = await request(app)
			.post("/api/v1/datasets")
			.field("kind", "course_offerings")
			.attach("archive", dummy, "courses.zip");

		expect(res).to.have.property("status", StatusCodes.ACCEPTED);
		expect(res.body).to.have.property("id").that.is.a("string").and.is.not.empty;

		expect(res).to.have.deep.property("body.status", "processing");
		expect(res).to.have.deep.property("body.kind", "course_offerings");
		expect(res).to.have.deep.property("body.message", "Dataset accepted for processing");
	});

	it("POST /api/v1/datasets should respond with status UNPROCESSABLE_ENTITY (422) for invalid requests", async () => {
		// kind missing + archive missing
		{
			const res = await request(app).post("/api/v1/datasets");
			expect(res).to.have.property("status", StatusCodes.UNPROCESSABLE_ENTITY);
			expect(res).to.have.deep.property("body", {
				error: "Validation failed",
				fields: {
					kind: "required but missing",
					archive: "required but missing",
				},
			});
		}

		// kind wrong (archive provided and non-empty)
		{
			const dummy = Buffer.from("non-empty");
			const res = await request(app)
				.post("/api/v1/datasets")
				.field("kind", "rooms")
				.attach("archive", dummy, "courses.zip");

			expect(res).to.have.property("status", StatusCodes.UNPROCESSABLE_ENTITY);
			expect(res).to.have.deep.property("body", {
				error: "Validation failed",
				fields: {
					kind: "expected to be course_offerings",
				},
			});
		}
	});

	// Search resources
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
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Missing WHERE",
		});
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
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Unknown key in COLUMNS",
		});
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
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "ORDER key must be in COLUMNS",
		});
	});

	// 413 Too many results
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
		expect(res).to.have.deep.property("body", {
			error: "Too many results",
			message: "Query would return more than 5000 results",
			limit: 5000,
		});
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
			expect(res).to.have.deep.property("body", {
				error: "Validation failed",
				fields: { kind: "required but missing" },
			});
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

			expect(res).to.have.property("status", StatusCodes.UNPROCESSABLE_ENTITY);
			expect(res).to.have.deep.property("body", {
				error: "Validation failed",
				fields: { query: "required but missing" },
			});
		}

		// query is not an object
		{
			const res = await request(app).post("/api/v1/search").send({
				kind: "course_offerings",
				query: 123,
			});

			expect(res).to.have.property("status", StatusCodes.UNPROCESSABLE_ENTITY);
			expect(res).to.have.deep.property("body", {
				error: "Validation failed",
				fields: { query: "expected an object" },
			});
		}
	});

	// Retrieve a list of courses

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
		expect(res).to.have.deep.property("body", {
			error: "Invalid request parameters",
			params: {
				limit: "expected an integer between 1 and 5000",
				offset: "expected an integer >= 0",
			},
		});
	});

	// Retrieve a course

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

	// Create or replace a course

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

		const getRes = await request(app).get("/api/v1/courses/cpsc310");
		expect(getRes).to.have.property("status", OK);
		expect(getRes).to.have.deep.property("body", {
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

	it("PUT /api/v1/courses/{course} should respond with status UNPROCESSABLE_ENTITY (422) for validation errors", async () => {
		const res = await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			// dept missing
			code: 310, // wrong type
		});

		expect(res).to.have.property("status", StatusCodes.UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				dept: "required but missing",
				code: "expected a string",
			},
		});
	});

	// Remove a course

	it("DELETE /api/v1/courses/{course} should respond with status OK (200) and course metadata + removed sections count", async () => {
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
			instructor: "holmes, reid",
			year: 2021,
			avg: 80.0,
			pass: 160,
			fail: 2,
			audit: 0,
		});

		const res = await request(app).delete("/api/v1/courses/cpsc310");

		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "cpsc310",
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
			sections: 2,
		});
	});

	it("DELETE /api/v1/courses/{course} should respond with status NOT_FOUND (404) when course does not exist", async () => {
		const res = await request(app).delete("/api/v1/courses/cpsc310");

		expect(res).to.have.property("status", StatusCodes.NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no course with id 'cpsc310'",
		});
	});

	// Retrieve a list of sections for a course

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
		expect(res).to.have.deep.property("body", {
			total: 2,
			limit: 100,
			offset: 0,
			items: [
				{
					id: "21w201",
					instructor: "holmes, reid",
					year: 2021,
					avg: 76.4,
					pass: 167,
					fail: 3,
					audit: 1,
					links: {
						self: "/api/v1/courses/cpsc310/sections/21w201",
						course: "/api/v1/courses/cpsc310",
					},
				},
				{
					id: "21w202",
					instructor: "bradley, nick",
					year: 2021,
					avg: 77.1,
					pass: 172,
					fail: 1,
					audit: 0,
					links: {
						self: "/api/v1/courses/cpsc310/sections/21w202",
						course: "/api/v1/courses/cpsc310",
					},
				},
			],
		});
	});

	it("GET /api/v1/courses/{course}/sections should respond with status BAD_REQUEST (400) for invalid pagination params", async () => {
		const res = await request(app).get("/api/v1/courses/cpsc310/sections?limit=0&offset=-1");

		expect(res).to.have.property("status", StatusCodes.BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid request parameters",
			params: {
				limit: "expected an integer between 1 and 5000",
				offset: "expected an integer >= 0",
			},
		});
	});

	it("GET /api/v1/courses/{course}/sections should respond with status NOT_FOUND (404) when course does not exist", async () => {
		const res = await request(app).get("/api/v1/courses/cpsc310/sections");

		expect(res).to.have.property("status", StatusCodes.NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no course with id 'cpsc310'",
		});
	});

	// Retrieve a section for a course

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
		expect(res).to.have.deep.property("body", {
			id: "21w201",
			instructor: "holmes, reid",
			year: 2021,
			avg: 76.4,
			pass: 167,
			fail: 3,
			audit: 1,
			links: {
				self: "/api/v1/courses/cpsc310/sections/21w201",
				course: "/api/v1/courses/cpsc310",
			},
		});
	});

	it("GET /api/v1/courses/{course}/sections/{section} should respond with status NOT_FOUND (404) when course does not exist", async () => {
		const res = await request(app).get("/api/v1/courses/cpsc310/sections/21w201");

		expect(res).to.have.property("status", StatusCodes.NOT_FOUND);
		expect(res).to.have.deep.property("body", {
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

		expect(res).to.have.property("status", StatusCodes.NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no section with id '21w201'",
		});
	});

	// Create or replace a section for a course

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
		expect(res).to.have.deep.property("body", {
			id: "21w201",
			instructor: "holmes, reid",
			year: 2021,
			avg: 76.4,
			pass: 167,
			fail: 3,
			audit: 1,
			links: {
				self: "/api/v1/courses/cpsc310/sections/21w201",
				course: "/api/v1/courses/cpsc310",
			},
		});
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

		const getRes = await request(app).get("/api/v1/courses/cpsc310/sections/21w201");
		expect(getRes).to.have.property("status", OK);
		expect(getRes).to.have.deep.property("body", {
			id: "21w201",
			instructor: "holmes, reid",
			year: 2021,
			avg: 76.4,
			pass: 167,
			fail: 3,
			audit: 1,
			links: {
				self: "/api/v1/courses/cpsc310/sections/21w201",
				course: "/api/v1/courses/cpsc310",
			},
		});
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
		expect(res).to.have.deep.property("body", {
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
			// instructor missing
			year: 1800, // invalid
			avg: 101, // invalid
			pass: 167,
			fail: -1, // invalid
			audit: 1,
		});

		expect(res).to.have.property("status", StatusCodes.UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				instructor: "required but missing",
				year: "expected a number between 1900 and 2099",
				avg: "expected a number between 0 and 100",
				fail: "expected a number >= 0",
			},
		});
	});

	// Remove a section from a course

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
		expect(res).to.have.deep.property("body", {
			id: "21w201",
			instructor: "holmes, reid",
			year: 2021,
			avg: 76.4,
			pass: 167,
			fail: 3,
			audit: 1,
		});
	});

	it("DELETE /api/v1/courses/{course}/sections/{section} should respond with status NOT_FOUND (404) when course does not exist", async () => {
		const res = await request(app).delete("/api/v1/courses/cpsc310/sections/21w201");

		expect(res).to.have.property("status", StatusCodes.NOT_FOUND);
		expect(res).to.have.deep.property("body", {
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

		expect(res).to.have.property("status", StatusCodes.NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no section with id '21w201'",
		});
	});
});
