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

// ============================================================
// Helpers
// ============================================================

async function makeZipBuffer(files: Record<string, string>): Promise<Buffer> {
	const zip = new JSZip();
	for (const [path, content] of Object.entries(files)) {
		zip.file(path, content);
	}
	return await zip.generateAsync({ type: "nodebuffer" });
}

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

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForProcessingV2(
	app: Application,
	id: string,
	maxRetries = 40,
	delayMs = 100
): Promise<request.Response> {
	const res = await request(app).get(`/api/v2/datasets/${id}`);

	if (res.status === OK) {
		const st = res.body?.status;
		if (st === "completed" || st === "failed") {
			return res;
		}
	}

	if (maxRetries <= 1) {
		throw new Error(`Timeout waiting for v2 job ${id} to complete`);
	}
	await sleep(delayMs);
	return waitForProcessingV2(app, id, maxRetries - 1, delayMs);
}

async function seedManyCourseSections(n: number): Promise<void> {
	const courseId = "cpsc310";
	const course = { id: courseId, title: "Intro", dept: "CS", code: "310" };

	const sections: Record<string, any> = {};
	for (let i = 0; i < n; i++) {
		const sid = `s${i}`;
		sections[sid] = {
			id: sid,
			instructor: "x",
			year: 2021,
			avg: 80,
			pass: 1,
			fail: 0,
			audit: 0,
		};
	}

	const db = {
		courses: { [courseId]: course },
		sections: { [courseId]: sections },
		buildings: {},
		rooms: {},
		datasets: {},
	};

	await fs.mkdir(datadir, { recursive: true });
	await fs.writeFile(`${datadir}/db.json`, JSON.stringify(db, null, 2), "utf-8");
}

async function createBuilding(app: Application, id: string, body?: Partial<any>): Promise<request.Response> {
	return request(app)
		.put(`/api/v2/buildings/${id}`)
		.send({
			name: "Hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26125,
			lon: -123.24807,
			...body,
		});
}

async function createRoom(
	app: Application,
	buildingId: string,
	roomId: string,
	body?: Partial<any>
): Promise<request.Response> {
	return request(app)
		.put(`/api/v2/buildings/${buildingId}/rooms/${roomId}`)
		.send({
			building: buildingId,
			number: roomId.includes("_") ? roomId.split("_")[1] : "101",
			type: "Open Design General Purpose",
			furniture: "Classroom-Movable Tables & Chairs",
			href: `http://students.ubc.ca/campus/discover/buildings-and-classrooms/room/${buildingId}-101`,
			seats: 40,
			...body,
		});
}

async function makeMinimalFacilitiesZip(filesAtRoot: Record<string, string>): Promise<Buffer> {
	const zip = new JSZip();
	for (const [path, content] of Object.entries(filesAtRoot)) {
		zip.file(path, content);
	}
	return await zip.generateAsync({ type: "nodebuffer" });
}

function makeIndexHtmlWithBuildings(rowsHtml: string): string {
	return `
	<html>
		<body>
			<table class="views-table">
				<tbody>
					${rowsHtml}
				</tbody>
			</table>
		</body>
	</html>
	`;
}

function makeBuildingRow(fullname: string, shortname: string, address: string, link: string): string {
	return `
	<tr>
		<td class="views-field-title"><a href="${link}">${fullname}</a></td>
		<td class="views-field-field-building-code">${shortname}</td>
		<td class="views-field-field-building-address">${address}</td>
	</tr>
	`;
}

function makeRoomPage(rowsHtml: string): string {
	return `
	<html>
		<body>
			<table class="views-table">
				<tbody>
					${rowsHtml}
				</tbody>
			</table>
		</body>
	</html>
	`;
}

function makeRoomRow(number: string, seats: string, furniture: string, type: string, href: string): string {
	return `
	<tr>
		<td class="views-field-field-room-number"><a href="${href}">${number}</a></td>
		<td class="views-field-field-room-capacity">${seats}</td>
		<td class="views-field-field-room-furniture">${furniture}</td>
		<td class="views-field-field-room-type">${type}</td>
		<td class="views-field-nothing"><a href="${href}">More info</a></td>
	</tr>
	`;
}

// ============================================================
// Tests
// ============================================================

describe("REST API v2", function () {
	let app: Application;
	let validCourseZipBuffer: Buffer;

	before(async () => {
		validCourseZipBuffer = await makeZipBuffer({
			"courses/data.json": JSON.stringify({ result: [makeValidOffering()] }),
		});
	});

	beforeEach(async () => {
		app = await createApp({ datadir });
	});

	afterEach(async () => {
		await sleep(200);
		await fs.rm(datadir, { recursive: true, force: true });
	});

	// ============================================================
	// v2 Dataset Management
	// ============================================================

	describe("v2 datasets", function () {
		it("POST /api/v2/datasets should fail validation if kind is missing", async () => {
			const res = await request(app).post("/api/v2/datasets").attach("archive", validCourseZipBuffer, "courses.zip");

			expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
			expect(res.body).to.deep.equal({
				error: "Validation failed",
				fields: {
					kind: "required but missing",
				},
			});
		});

		it("POST /api/v2/datasets should fail validation if kind is invalid", async () => {
			const res = await request(app)
				.post("/api/v2/datasets")
				.field("kind", "rooms")
				.attach("archive", validCourseZipBuffer, "courses.zip");

			expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
			expect(res.body).to.have.property("error", "Validation failed");
			expect(res.body.fields).to.have.property("kind", "expected to be course_offerings or facilities");
		});

		it("POST /api/v2/datasets should fail validation if archive is missing", async () => {
			const res = await request(app).post("/api/v2/datasets").field("kind", "course_offerings");

			expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
			expect(res.body).to.have.property("error", "Validation failed");
			expect(res.body.fields).to.have.property("archive");
			expect(res.body.fields.archive).to.be.oneOf(["required but missing", "expected non-empty file"]);
		});

		it("POST /api/v2/datasets should fail validation if archive is empty", async () => {
			const empty = Buffer.from("");
			const res = await request(app)
				.post("/api/v2/datasets")
				.field("kind", "facilities")
				.attach("archive", empty, "empty.zip");

			expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
			expect(res.body).to.deep.equal({
				error: "Validation failed",
				fields: {
					archive: "expected non-empty file",
				},
			});
		});

		it("POST /api/v2/datasets should accept course_offerings uploads", async () => {
			const res = await request(app)
				.post("/api/v2/datasets")
				.field("kind", "course_offerings")
				.attach("archive", validCourseZipBuffer, "courses.zip");

			expect(res).to.have.property("status", ACCEPTED);
			expect(res.body).to.have.property("id").that.is.a("string");
			expect(res.body).to.include({
				status: "processing",
				kind: "course_offerings",
				message: "Dataset accepted for processing",
			});
		});

		it("POST /api/v2/datasets should accept facilities uploads", async () => {
			const facilitiesZip = await makeMinimalFacilitiesZip({
				"index.htm": "<html><body><p>placeholder</p></body></html>",
			});

			const res = await request(app)
				.post("/api/v2/datasets")
				.field("kind", "facilities")
				.attach("archive", facilitiesZip, "facilities.zip");

			expect(res).to.have.property("status", ACCEPTED);
			expect(res.body).to.have.property("id").that.is.a("string");
			expect(res.body).to.include({
				status: "processing",
				kind: "facilities",
				message: "Dataset accepted for processing",
			});
		});

		it("GET /api/v2/datasets/{id} should return 404 for unknown id", async () => {
			const res = await request(app).get("/api/v2/datasets/upload_12345");

			expect(res).to.have.property("status", NOT_FOUND);
			expect(res.body).to.deep.equal({
				error: "Not found",
				message: "no dataset with id 'upload_12345'",
			});
		});

		it("GET /api/v2/datasets/{id} should return job status for a valid v2 upload id", async () => {
			const postRes = await request(app)
				.post("/api/v2/datasets")
				.field("kind", "course_offerings")
				.attach("archive", validCourseZipBuffer, "courses.zip");

			expect(postRes.status).to.equal(ACCEPTED);

			const getRes = await request(app).get(`/api/v2/datasets/${postRes.body.id}`);
			expect(getRes.status).to.equal(OK);
			expect(getRes.body).to.have.property("id", postRes.body.id);
			expect(getRes.body).to.have.property("kind", "course_offerings");
			expect(getRes.body).to.have.property("status").that.is.oneOf(["processing", "completed", "failed"]);
			expect(getRes.body).to.have.property("stats");
			expect(getRes.body).to.have.property("message");
		});

		it("POST /api/v2/datasets should fail async processing for invalid zip format", async () => {
			const notAZip = Buffer.from("this is not a zip");

			const postRes = await request(app)
				.post("/api/v2/datasets")
				.field("kind", "course_offerings")
				.attach("archive", notAZip, "not-a-zip.bin");

			expect(postRes.status).to.equal(ACCEPTED);

			const done = await waitForProcessingV2(app, postRes.body.id);
			expect(done.status).to.equal(OK);
			expect(done.body).to.have.property("status", "failed");
			expect(done.body).to.have.property("message", "Data is not in a valid zip format");
		});

		it("POST /api/v2/datasets should fail course_offerings processing when courses/ root is missing", async () => {
			const badZip = await makeZipBuffer({
				"notcourses/data.json": JSON.stringify({ result: [makeValidOffering()] }),
			});

			const postRes = await request(app)
				.post("/api/v2/datasets")
				.field("kind", "course_offerings")
				.attach("archive", badZip, "bad-courses.zip");

			expect(postRes.status).to.equal(ACCEPTED);

			const done = await waitForProcessingV2(app, postRes.body.id);
			expect(done.status).to.equal(OK);
			expect(done.body).to.have.property("status", "failed");
			expect(done.body.message).to.be.oneOf(["Missing root courses directory", "Missing root rooms directory"]);
		});
	});

	// ============================================================
	// v2 Search Validation
	// ============================================================

	describe("v2 search validation", function () {
		it("POST /api/v2/search should respond 422 when kind is missing", async () => {
			const res = await request(app)
				.post("/api/v2/search")
				.send({
					query: { WHERE: {}, OPTIONS: { COLUMNS: ["dept"] } },
				});

			expect(res.status).to.equal(UNPROCESSABLE_ENTITY);
			expect(res.body).to.deep.equal({
				error: "Validation failed",
				fields: {
					kind: "required but missing",
				},
			});
		});

		it("POST /api/v2/search should respond 422 when kind is invalid", async () => {
			const res = await request(app)
				.post("/api/v2/search")
				.send({
					kind: "rooms",
					query: { WHERE: {}, OPTIONS: { COLUMNS: ["dept"] } },
				});

			expect(res.status).to.equal(UNPROCESSABLE_ENTITY);
			expect(res.body).to.deep.equal({
				error: "Validation failed",
				fields: {
					kind: "expected to be course_offerings or facilities",
				},
			});
		});

		it("POST /api/v2/search should respond 422 when query is missing", async () => {
			const res = await request(app).post("/api/v2/search").send({ kind: "course_offerings" });

			expect(res.status).to.equal(UNPROCESSABLE_ENTITY);
			expect(res.body).to.deep.equal({
				error: "Validation failed",
				fields: {
					query: "required but missing",
				},
			});
		});

		it("POST /api/v2/search should respond 422 when query is not an object", async () => {
			const res = await request(app).post("/api/v2/search").send({
				kind: "facilities",
				query: 123,
			});

			expect(res.status).to.equal(UNPROCESSABLE_ENTITY);
			expect(res.body).to.deep.equal({
				error: "Validation failed",
				fields: {
					query: "expected an object",
				},
			});
		});

		it("POST /api/v2/search should reject mixed course_offerings and facilities fields", async () => {
			const res = await request(app)
				.post("/api/v2/search")
				.send({
					kind: "course_offerings",
					query: {
						WHERE: {},
						OPTIONS: {
							COLUMNS: ["dept", "seats"],
						},
					},
				});

			expect(res.status).to.equal(BAD_REQUEST);
			expect(res.body).to.deep.equal({
				error: "Invalid query",
				message: "Cannot mix course_offerings and facilities fields in one query",
			});
		});

		it("POST /api/v2/search should reject ORDER object when some keys are not in COLUMNS", async () => {
			const res = await request(app)
				.post("/api/v2/search")
				.send({
					kind: "facilities",
					query: {
						WHERE: {},
						OPTIONS: {
							COLUMNS: ["building", "seats"],
							ORDER: {
								dir: "DOWN",
								keys: ["seats", "address"],
							},
						},
					},
				});

			expect(res.status).to.equal(BAD_REQUEST);
			expect(res.body).to.deep.equal({
				error: "Invalid query",
				message: "All ORDER keys must be in COLUMNS",
			});
		});

		it("POST /api/v2/search should reject invalid sort direction", async () => {
			const res = await request(app)
				.post("/api/v2/search")
				.send({
					kind: "course_offerings",
					query: {
						WHERE: {},
						OPTIONS: {
							COLUMNS: ["dept", "avg"],
							ORDER: {
								dir: "SIDEWAYS",
								keys: ["avg"],
							},
						},
					},
				});

			expect(res.status).to.equal(BAD_REQUEST);
			expect(res.body).to.deep.equal({
				error: "Invalid query",
				message: "Invalid sort direction (must be UP or DOWN)",
			});
		});

		it("POST /api/v2/search should reject TRANSFORMATIONS missing GROUP", async () => {
			const res = await request(app)
				.post("/api/v2/search")
				.send({
					kind: "course_offerings",
					query: {
						WHERE: {},
						OPTIONS: { COLUMNS: ["dept", "maxAvg"] },
						TRANSFORMATIONS: {
							APPLY: [{ maxAvg: { MAX: "avg" } }],
						},
					},
				});

			expect(res.status).to.equal(BAD_REQUEST);
			expect(res.body).to.deep.equal({
				error: "Invalid query",
				message: "Missing GROUP in TRANSFORMATIONS",
			});
		});

		it("POST /api/v2/search should reject TRANSFORMATIONS missing APPLY", async () => {
			const res = await request(app)
				.post("/api/v2/search")
				.send({
					kind: "course_offerings",
					query: {
						WHERE: {},
						OPTIONS: { COLUMNS: ["dept"] },
						TRANSFORMATIONS: {
							GROUP: ["dept"],
						},
					},
				});

			expect(res.status).to.equal(BAD_REQUEST);
			expect(res.body).to.deep.equal({
				error: "Invalid query",
				message: "Missing APPLY in TRANSFORMATIONS",
			});
		});

		it("POST /api/v2/search should reject empty GROUP array", async () => {
			const res = await request(app)
				.post("/api/v2/search")
				.send({
					kind: "facilities",
					query: {
						WHERE: {},
						OPTIONS: { COLUMNS: ["building"] },
						TRANSFORMATIONS: {
							GROUP: [],
							APPLY: [],
						},
					},
				});

			expect(res.status).to.equal(BAD_REQUEST);
			expect(res.body).to.deep.equal({
				error: "Invalid query",
				message: "GROUP must be a non-empty array",
			});
		});

		it("POST /api/v2/search should reject non-array APPLY", async () => {
			const res = await request(app)
				.post("/api/v2/search")
				.send({
					kind: "facilities",
					query: {
						WHERE: {},
						OPTIONS: { COLUMNS: ["building"] },
						TRANSFORMATIONS: {
							GROUP: ["building"],
							APPLY: {},
						},
					},
				});

			expect(res.status).to.equal(BAD_REQUEST);
			expect(res.body).to.deep.equal({
				error: "Invalid query",
				message: "APPLY must be an array",
			});
		});

		it("POST /api/v2/search should reject invalid applykey containing underscore", async () => {
			const res = await request(app)
				.post("/api/v2/search")
				.send({
					kind: "facilities",
					query: {
						WHERE: {},
						OPTIONS: { COLUMNS: ["building", "max_seats"] },
						TRANSFORMATIONS: {
							GROUP: ["building"],
							APPLY: [{ max_seats: { MAX: "seats" } }],
						},
					},
				});

			expect(res.status).to.equal(BAD_REQUEST);
			expect(res.body).to.deep.equal({
				error: "Invalid query",
				message: "applykey cannot be empty or contain underscore",
			});
		});

		it("POST /api/v2/search should reject COLUMNS that are not in GROUP or APPLY when TRANSFORMATIONS is present", async () => {
			const res = await request(app)
				.post("/api/v2/search")
				.send({
					kind: "course_offerings",
					query: {
						WHERE: {},
						OPTIONS: { COLUMNS: ["dept", "avg"] },
						TRANSFORMATIONS: {
							GROUP: ["dept"],
							APPLY: [],
						},
					},
				});

			expect(res.status).to.equal(BAD_REQUEST);
			expect(res.body).to.deep.equal({
				error: "Invalid query",
				message: "When TRANSFORMATIONS is present, all COLUMNS must be in GROUP or APPLY",
			});
		});
	});

	// ============================================================
	// v2 Search Execution
	// ============================================================

	describe("v2 search execution", function () {
		beforeEach(async () => {
			await request(app).put("/api/v1/courses/cpsc310").send({
				title: "Intro to SE",
				dept: "cpsc",
				code: "310",
			});

			await request(app).put("/api/v1/courses/cpsc310/sections/310_1").send({
				instructor: "alpha",
				year: 2021,
				avg: 95,
				pass: 100,
				fail: 1,
				audit: 0,
			});

			await request(app).put("/api/v1/courses/cpsc310/sections/310_2").send({
				instructor: "beta",
				year: 2020,
				avg: 98,
				pass: 80,
				fail: 0,
				audit: 0,
			});

			await request(app).put("/api/v1/courses/cpsc310/sections/310_3").send({
				instructor: "beta",
				year: 2021,
				avg: 98,
				pass: 90,
				fail: 2,
				audit: 1,
			});

			await createBuilding(app, "DMP", {
				name: "Hugh Dempster Pavilion",
				address: "6245 Agronomy Road V6T 1Z4",
				lat: 49.26125,
				lon: -123.24807,
			});

			await createBuilding(app, "ORCH", {
				name: "Orchard Commons",
				address: "6363 Agronomy Road",
				lat: 49.26048,
				lon: -123.25027,
			});

			await createRoom(app, "DMP", "DMP_101", {
				number: "101",
				seats: 40,
				type: "Open Design General Purpose",
				furniture: "Classroom-Movable Tables & Chairs",
				href: "http://students.ubc.ca/campus/discover/buildings-and-classrooms/room/DMP-101",
			});

			await createRoom(app, "DMP", "DMP_201", {
				number: "201",
				seats: 25,
				type: "Small Group",
				furniture: "Classroom-Movable Tables & Chairs",
				href: "http://students.ubc.ca/campus/discover/buildings-and-classrooms/room/DMP-201",
			});

			await createRoom(app, "ORCH", "ORCH_301", {
				building: "ORCH",
				number: "301",
				seats: 60,
				type: "Lecture Hall",
				furniture: "Fixed Tables/Movable Chairs",
				href: "http://students.ubc.ca/campus/discover/buildings-and-classrooms/room/ORCH-301",
			});
		});

		it("POST /api/v2/search should support basic facilities queries", async () => {
			const res = await request(app)
				.post("/api/v2/search")
				.send({
					kind: "facilities",
					query: {
						WHERE: { GT: { seats: 30 } },
						OPTIONS: {
							COLUMNS: ["building", "number", "seats"],
							ORDER: "seats",
						},
					},
				});

			expect(res.status).to.equal(OK);
			expect(res.body).to.deep.equal([
				{ building: "DMP", number: "101", seats: 40 },
				{ building: "ORCH", number: "301", seats: 60 },
			]);
		});

		it("POST /api/v2/search should support multi-key ORDER for course_offerings", async () => {
			const res = await request(app)
				.post("/api/v2/search")
				.send({
					kind: "course_offerings",
					query: {
						WHERE: { GT: { avg: 94 } },
						OPTIONS: {
							COLUMNS: ["year", "dept", "avg"],
							ORDER: {
								dir: "UP",
								keys: ["year", "avg"],
							},
						},
					},
				});

			expect(res.status).to.equal(OK);
			expect(res.body).to.deep.equal([
				{ year: 2020, dept: "cpsc", avg: 98 },
				{ year: 2021, dept: "cpsc", avg: 95 },
				{ year: 2021, dept: "cpsc", avg: 98 },
			]);
		});

		it("POST /api/v2/search should support multi-key ORDER for facilities", async () => {
			const res = await request(app)
				.post("/api/v2/search")
				.send({
					kind: "facilities",
					query: {
						WHERE: {},
						OPTIONS: {
							COLUMNS: ["seats", "address", "type"],
							ORDER: {
								dir: "DOWN",
								keys: ["seats", "address", "type"],
							},
						},
					},
				});

			expect(res.status).to.equal(OK);
			expect(res.body).to.have.length(3);
			expect(res.body[0]).to.deep.equal({
				seats: 60,
				address: "6363 Agronomy Road",
				type: "Lecture Hall",
			});
			expect(res.body[2]).to.deep.equal({
				seats: 25,
				address: "6245 Agronomy Road V6T 1Z4",
				type: "Small Group",
			});
		});

		it("POST /api/v2/search should support GROUP + MAX on facilities", async () => {
			const res = await request(app)
				.post("/api/v2/search")
				.send({
					kind: "facilities",
					query: {
						WHERE: {},
						OPTIONS: {
							COLUMNS: ["name", "maxSeats"],
							ORDER: {
								dir: "DOWN",
								keys: ["maxSeats"],
							},
						},
						TRANSFORMATIONS: {
							GROUP: ["name"],
							APPLY: [{ maxSeats: { MAX: "seats" } }],
						},
					},
				});

			expect(res.status).to.equal(OK);
			expect(res.body).to.deep.equal([
				{ name: "Orchard Commons", maxSeats: 60 },
				{ name: "Hugh Dempster Pavilion", maxSeats: 40 },
			]);
		});

		it("POST /api/v2/search should support GROUP + MIN on facilities", async () => {
			const res = await request(app)
				.post("/api/v2/search")
				.send({
					kind: "facilities",
					query: {
						WHERE: {},
						OPTIONS: { COLUMNS: ["building", "minSeats"], ORDER: "building" },
						TRANSFORMATIONS: {
							GROUP: ["building"],
							APPLY: [{ minSeats: { MIN: "seats" } }],
						},
					},
				});

			expect(res.status).to.equal(OK);
			expect(res.body).to.deep.equal([
				{ building: "DMP", minSeats: 25 },
				{ building: "ORCH", minSeats: 60 },
			]);
		});

		it("POST /api/v2/search should support GROUP + AVG on course_offerings and round to 2 decimals", async () => {
			const res = await request(app)
				.post("/api/v2/search")
				.send({
					kind: "course_offerings",
					query: {
						WHERE: {},
						OPTIONS: { COLUMNS: ["dept", "overallAvg"] },
						TRANSFORMATIONS: {
							GROUP: ["dept"],
							APPLY: [{ overallAvg: { AVG: "avg" } }],
						},
					},
				});

			expect(res.status).to.equal(OK);
			expect(res.body).to.deep.equal([{ dept: "cpsc", overallAvg: 97.0 }]);
		});

		it("POST /api/v2/search should support GROUP + SUM on course_offerings and round to 2 decimals", async () => {
			const res = await request(app)
				.post("/api/v2/search")
				.send({
					kind: "course_offerings",
					query: {
						WHERE: {},
						OPTIONS: { COLUMNS: ["dept", "totalAudit"] },
						TRANSFORMATIONS: {
							GROUP: ["dept"],
							APPLY: [{ totalAudit: { SUM: "audit" } }],
						},
					},
				});

			expect(res.status).to.equal(OK);
			expect(res.body).to.deep.equal([{ dept: "cpsc", totalAudit: 1.0 }]);
		});

		it("POST /api/v2/search should support GROUP + COUNT with unique values", async () => {
			const res = await request(app)
				.post("/api/v2/search")
				.send({
					kind: "facilities",
					query: {
						WHERE: {},
						OPTIONS: { COLUMNS: ["building", "uniqueTypes"], ORDER: "building" },
						TRANSFORMATIONS: {
							GROUP: ["building"],
							APPLY: [{ uniqueTypes: { COUNT: "type" } }],
						},
					},
				});

			expect(res.status).to.equal(OK);
			expect(res.body).to.deep.equal([
				{ building: "DMP", uniqueTypes: 2 },
				{ building: "ORCH", uniqueTypes: 1 },
			]);
		});

		it("POST /api/v2/search should still support old single-key ORDER form", async () => {
			const res = await request(app)
				.post("/api/v2/search")
				.send({
					kind: "course_offerings",
					query: {
						WHERE: { GT: { avg: 90 } },
						OPTIONS: {
							COLUMNS: ["avg", "dept"],
							ORDER: "avg",
						},
					},
				});

			expect(res.status).to.equal(OK);
			expect(res.body).to.deep.equal([
				{ avg: 95, dept: "cpsc" },
				{ avg: 98, dept: "cpsc" },
				{ avg: 98, dept: "cpsc" },
			]);
		});

		it("POST /api/v2/search should return 413 when more than 5000 results", async () => {
			await fs.rm(datadir, { recursive: true, force: true });
			await seedManyCourseSections(5001);
			app = await createApp({ datadir });

			const res = await request(app)
				.post("/api/v2/search")
				.send({
					kind: "course_offerings",
					query: {
						WHERE: {},
						OPTIONS: { COLUMNS: ["dept"] },
					},
				});

			expect(res.status).to.equal(REQUEST_TOO_LONG);
			expect(res.body).to.deep.equal({
				error: "Too many results",
				message: "Query would return more than 5000 results",
				limit: 5000,
			});
		});
	});

	// ============================================================
	// Buildings
	// ============================================================

	describe("v2 buildings endpoints", function () {
		it("GET /api/v2/buildings should return a paginated list", async () => {
			await createBuilding(app, "DMP", {
				name: "Hugh Dempster Pavilion",
				address: "6245 Agronomy Road V6T 1Z4",
				lat: 49.26125,
				lon: -123.24807,
			});

			await createBuilding(app, "ORCH", {
				name: "Orchard Commons",
				address: "6363 Agronomy Road",
				lat: 49.26048,
				lon: -123.25027,
			});

			const res = await request(app).get("/api/v2/buildings");

			expect(res.status).to.equal(OK);
			expect(res.body).to.have.property("items").that.is.an("array");
			expect(res.body.items.map((b: any) => b.id)).to.deep.equal(["DMP", "ORCH"]);
		});

		it("GET /api/v2/buildings should validate limit and offset", async () => {
			const res = await request(app).get("/api/v2/buildings?limit=0&offset=-1");

			expect(res.status).to.equal(BAD_REQUEST);
			expect(res.body).to.deep.equal({
				error: "Invalid request parameters",
				params: {
					limit: "expected an integer between 1 and 5000",
					offset: "expected an integer >= 0",
				},
			});
		});

		it("GET /api/v2/buildings/{building} should return building data", async () => {
			await createBuilding(app, "DMP");

			const res = await request(app).get("/api/v2/buildings/DMP");

			expect(res.status).to.equal(OK);
			expect(res.body).to.include({
				id: "DMP",
				name: "Hugh Dempster Pavilion",
				address: "6245 Agronomy Road V6T 1Z4",
				lat: 49.26125,
				lon: -123.24807,
			});
			expect(res.body).to.have.property("links");
		});

		it("GET /api/v2/buildings/{building} should respond 404 if missing", async () => {
			const res = await request(app).get("/api/v2/buildings/DMP");

			expect(res.status).to.equal(NOT_FOUND);
			expect(res.body).to.deep.equal({
				error: "Not found",
				message: "no building with id 'DMP'",
			});
		});

		it("PUT /api/v2/buildings/{building} should respond 201 when creating", async () => {
			const res = await createBuilding(app, "DMP");

			expect(res.status).to.equal(CREATED);
			expect(res.body).to.include({
				id: "DMP",
				name: "Hugh Dempster Pavilion",
				address: "6245 Agronomy Road V6T 1Z4",
				lat: 49.26125,
				lon: -123.24807,
			});
		});

		it("PUT /api/v2/buildings/{building} should respond 204 when updating", async () => {
			await createBuilding(app, "DMP");

			const res = await createBuilding(app, "DMP", {
				name: "Hugh Dempster Pavilion Updated",
				address: "6245 Agronomy Road V6T 1Z4",
				lat: 49.26125,
				lon: -123.24807,
			});

			expect(res.status).to.equal(NO_CONTENT);
			expect(res.body).to.deep.equal({});
		});

		it("PUT /api/v2/buildings/{building} should respond 422 for validation errors", async () => {
			const res = await request(app).put("/api/v2/buildings/DMP").send({
				address: "6245 Agronomy Road V6T 1Z4",
				lat: "49.26125",
			});

			expect(res.status).to.equal(UNPROCESSABLE_ENTITY);
			expect(res.body).to.have.property("error", "Validation failed");
			expect(res.body).to.have.property("fields").that.is.an("object");
			expect(res.body.fields).to.have.property("name");
			expect(res.body.fields).to.have.property("lat");
			expect(res.body.fields).to.have.property("lon");
		});

		it("PUT /api/v2/buildings/{building} should reject empty string name and address", async () => {
			const res = await request(app).put("/api/v2/buildings/DMP").send({
				name: "   ",
				address: "",
				lat: 49.26125,
				lon: -123.24807,
			});

			expect(res.status).to.equal(UNPROCESSABLE_ENTITY);
			expect(res.body).to.deep.equal({
				error: "Validation failed",
				fields: {
					name: "expected a non-empty string",
					address: "expected a non-empty string",
				},
			});
		});

		it("DELETE /api/v2/buildings/{building} should remove building and return deleted room count", async () => {
			await createBuilding(app, "DMP");
			await createRoom(app, "DMP", "DMP_101", { number: "101", seats: 40 });
			await createRoom(app, "DMP", "DMP_201", { number: "201", seats: 25 });

			const res = await request(app).delete("/api/v2/buildings/DMP");

			expect(res.status).to.equal(OK);
			expect(res.body).to.include({
				id: "DMP",
				name: "Hugh Dempster Pavilion",
				address: "6245 Agronomy Road V6T 1Z4",
				lat: 49.26125,
				lon: -123.24807,
				rooms: 2,
			});
		});

		it("DELETE /api/v2/buildings/{building} should respond 404 if missing", async () => {
			const res = await request(app).delete("/api/v2/buildings/DMP");

			expect(res.status).to.equal(NOT_FOUND);
			expect(res.body).to.deep.equal({
				error: "Not found",
				message: "no building with id 'DMP'",
			});
		});

		it("DELETE /api/v2/buildings/{building} should cascade delete its rooms", async () => {
			await createBuilding(app, "DMP");
			await createRoom(app, "DMP", "DMP_101", { number: "101" });

			const delRes = await request(app).delete("/api/v2/buildings/DMP");
			expect(delRes.status).to.equal(OK);

			const roomRes = await request(app).get("/api/v2/buildings/DMP/rooms/DMP_101");
			expect(roomRes.status).to.equal(NOT_FOUND);
			expect(roomRes.body).to.deep.equal({
				error: "Not found",
				message: "no building with id 'DMP'",
			});
		});
	});

	// ============================================================
	// Rooms
	// ============================================================

	describe("v2 rooms endpoints", function () {
		beforeEach(async () => {
			await createBuilding(app, "DMP");
		});

		it("GET /api/v2/buildings/{building}/rooms should return a paginated list", async () => {
			await createRoom(app, "DMP", "DMP_101", { number: "101" });
			await createRoom(app, "DMP", "DMP_201", { number: "201", seats: 25 });

			const res = await request(app).get("/api/v2/buildings/DMP/rooms");

			expect(res.status).to.equal(OK);
			expect(res.body).to.have.property("items").that.is.an("array");
			expect(res.body.items.map((r: any) => r.id)).to.deep.equal(["DMP_101", "DMP_201"]);
		});

		it("GET /api/v2/buildings/{building}/rooms should validate limit and offset", async () => {
			const res = await request(app).get("/api/v2/buildings/DMP/rooms?limit=0&offset=-1");

			expect(res.status).to.equal(BAD_REQUEST);
			expect(res.body).to.deep.equal({
				error: "Invalid request parameters",
				params: {
					limit: "expected an integer between 1 and 5000",
					offset: "expected an integer >= 0",
				},
			});
		});

		it("GET /api/v2/buildings/{building}/rooms should respond 404 if building missing", async () => {
			const res = await request(app).get("/api/v2/buildings/NOPE/rooms");

			expect(res.status).to.equal(NOT_FOUND);
			expect(res.body).to.deep.equal({
				error: "Not found",
				message: "no building with id 'NOPE'",
			});
		});

		it("GET /api/v2/buildings/{building}/rooms/{room} should return room data", async () => {
			await createRoom(app, "DMP", "DMP_101", {
				number: "101",
				seats: 40,
			});

			const res = await request(app).get("/api/v2/buildings/DMP/rooms/DMP_101");

			expect(res.status).to.equal(OK);
			expect(res.body).to.include({
				id: "DMP_101",
				building: "DMP",
				number: "101",
				seats: 40,
			});
			expect(res.body).to.have.property("links");
		});

		it("GET /api/v2/buildings/{building}/rooms/{room} should respond 404 if building missing", async () => {
			const res = await request(app).get("/api/v2/buildings/NOPE/rooms/DMP_101");

			expect(res.status).to.equal(NOT_FOUND);
			expect(res.body).to.deep.equal({
				error: "Not found",
				message: "no building with id 'NOPE'",
			});
		});

		it("GET /api/v2/buildings/{building}/rooms/{room} should respond 404 if room missing", async () => {
			const res = await request(app).get("/api/v2/buildings/DMP/rooms/DMP_101");

			expect(res.status).to.equal(NOT_FOUND);
			expect(res.body).to.deep.equal({
				error: "Not found",
				message: "no room with id 'DMP_101'",
			});
		});

		it("PUT /api/v2/buildings/{building}/rooms/{room} should respond 201 when creating", async () => {
			const res = await createRoom(app, "DMP", "DMP_101", { number: "101", seats: 40 });

			expect(res.status).to.equal(CREATED);
			expect(res.body).to.include({
				id: "DMP_101",
				building: "DMP",
				number: "101",
				seats: 40,
			});
		});

		it("PUT /api/v2/buildings/{building}/rooms/{room} should respond 204 when updating", async () => {
			await createRoom(app, "DMP", "DMP_101", { number: "101", seats: 40 });

			const res = await createRoom(app, "DMP", "DMP_101", {
				number: "101",
				seats: 45,
				type: "Small Group",
			});

			expect(res.status).to.equal(NO_CONTENT);
			expect(res.body).to.deep.equal({});
		});

		it("PUT /api/v2/buildings/{building}/rooms/{room} should respond 404 if parent building is missing", async () => {
			const res = await createRoom(app, "NOPE", "NOPE_101", {
				building: "NOPE",
				number: "101",
			});

			expect(res.status).to.equal(NOT_FOUND);
			expect(res.body).to.deep.equal({
				error: "Not found",
				message: "no building with id 'NOPE'",
			});
		});

		it("PUT /api/v2/buildings/{building}/rooms/{room} should respond 422 for validation errors", async () => {
			const res = await request(app).put("/api/v2/buildings/DMP/rooms/DMP_101").send({
				building: "DMP",
				number: 101,
				seats: "40",
			});

			expect(res.status).to.equal(UNPROCESSABLE_ENTITY);
			expect(res.body).to.have.property("error", "Validation failed");
			expect(res.body).to.have.property("fields").that.is.an("object");
			expect(res.body.fields).to.have.property("number");
			expect(res.body.fields).to.have.property("type");
			expect(res.body.fields).to.have.property("furniture");
			expect(res.body.fields).to.have.property("href");
			expect(res.body.fields).to.have.property("seats");
		});

		it("PUT /api/v2/buildings/{building}/rooms/{room} should reject body building that does not match path", async () => {
			const res = await request(app).put("/api/v2/buildings/DMP/rooms/DMP_101").send({
				building: "ORCH",
				number: "101",
				type: "Open Design General Purpose",
				furniture: "Classroom-Movable Tables & Chairs",
				href: "http://students.ubc.ca/campus/discover/buildings-and-classrooms/room/DMP-101",
				seats: 40,
			});

			expect(res.status).to.equal(UNPROCESSABLE_ENTITY);
			expect(res.body).to.deep.equal({
				error: "Validation failed",
				fields: {
					building: "must match parent building in path",
				},
			});
		});

		it("PUT /api/v2/buildings/{building}/rooms/{room} should reject negative seats", async () => {
			const res = await request(app).put("/api/v2/buildings/DMP/rooms/DMP_101").send({
				building: "DMP",
				number: "101",
				type: "Open Design General Purpose",
				furniture: "Classroom-Movable Tables & Chairs",
				href: "http://students.ubc.ca/campus/discover/buildings-and-classrooms/room/DMP-101",
				seats: -1,
			});

			expect(res.status).to.equal(UNPROCESSABLE_ENTITY);
			expect(res.body).to.deep.equal({
				error: "Validation failed",
				fields: {
					seats: "expected a number >= 0",
				},
			});
		});

		it("DELETE /api/v2/buildings/{building}/rooms/{room} should return deleted room data", async () => {
			await createRoom(app, "DMP", "DMP_101", { number: "101", seats: 40 });

			const res = await request(app).delete("/api/v2/buildings/DMP/rooms/DMP_101");

			expect(res.status).to.equal(OK);
			expect(res.body).to.include({
				id: "DMP_101",
				building: "DMP",
				number: "101",
				seats: 40,
			});
		});

		it("DELETE /api/v2/buildings/{building}/rooms/{room} should respond 404 if building missing", async () => {
			const res = await request(app).delete("/api/v2/buildings/NOPE/rooms/DMP_101");

			expect(res.status).to.equal(NOT_FOUND);
			expect(res.body).to.deep.equal({
				error: "Not found",
				message: "no building with id 'NOPE'",
			});
		});

		it("DELETE /api/v2/buildings/{building}/rooms/{room} should respond 404 if room missing", async () => {
			const res = await request(app).delete("/api/v2/buildings/DMP/rooms/DMP_101");

			expect(res.status).to.equal(NOT_FOUND);
			expect(res.body).to.deep.equal({
				error: "Not found",
				message: "no room with id 'DMP_101'",
			});
		});
	});

	// ============================================================
	// Facilities upload processing
	// ============================================================

	describe("v2 facilities upload processing", function () {
		it("POST /api/v2/datasets should fail facilities processing when index.htm is missing", async () => {
			const zipBuf = await makeMinimalFacilitiesZip({
				"campus/discover/buildings-and-classrooms/DMP.htm": "<html></html>",
			});

			const postRes = await request(app)
				.post("/api/v2/datasets")
				.field("kind", "facilities")
				.attach("archive", zipBuf, "facilities-missing-index.zip");

			expect(postRes.status).to.equal(ACCEPTED);

			const done = await waitForProcessingV2(app, postRes.body.id);
			expect(done.status).to.equal(OK);
			expect(done.body).to.include({
				status: "failed",
				message: "Missing index.htm file",
			});
		});

		it("POST /api/v2/datasets should fail facilities processing when no building table exists in index.htm", async () => {
			const zipBuf = await makeMinimalFacilitiesZip({
				"index.htm": "<html><body><p>No table here</p></body></html>",
			});

			const postRes = await request(app)
				.post("/api/v2/datasets")
				.field("kind", "facilities")
				.attach("archive", zipBuf, "facilities-no-building-table.zip");

			expect(postRes.status).to.equal(ACCEPTED);

			const done = await waitForProcessingV2(app, postRes.body.id);
			expect(done.status).to.equal(OK);
			expect(done.body).to.include({
				status: "failed",
				message: "No building table found in index.htm",
			});
		});

		it("POST /api/v2/datasets should create a building even if its linked room file is missing", async () => {
			const indexHtml = makeIndexHtmlWithBuildings(
				makeBuildingRow(
					"Hugh Dempster Pavilion",
					"DMP",
					"6245 Agronomy Road V6T 1Z4",
					"./campus/discover/buildings-and-classrooms/DMP.htm"
				)
			);

			const zipBuf = await makeMinimalFacilitiesZip({
				"index.htm": indexHtml,
			});

			const postRes = await request(app)
				.post("/api/v2/datasets")
				.field("kind", "facilities")
				.attach("archive", zipBuf, "facilities-missing-room-file.zip");

			expect(postRes.status).to.equal(ACCEPTED);

			const done = await waitForProcessingV2(app, postRes.body.id);
			expect(done.status).to.equal(OK);
			expect(done.body.status).to.equal("completed");
			expect(done.body.stats).to.deep.equal({
				files_total: 1,
				files_processed: 1,
				files_skipped: 0,
				buildings_seen: 1,
				buildings_added: 1,
				buildings_modified: 0,
				rooms_seen: 0,
				rooms_added: 0,
				rooms_modified: 0,
			});

			const buildingRes = await request(app).get("/api/v2/buildings/DMP");
			expect(buildingRes.status).to.equal(OK);
			expect(buildingRes.body).to.include({
				id: "DMP",
				name: "Hugh Dempster Pavilion",
				address: "6245 Agronomy Road V6T 1Z4",
			});

			const roomsRes = await request(app).get("/api/v2/buildings/DMP/rooms");
			expect(roomsRes.status).to.equal(OK);
			expect(roomsRes.body.items).to.be.an("array").that.is.empty;
		});

		it("POST /api/v2/datasets should create building and room resources from a minimal valid facilities archive", async () => {
			const indexHtml = makeIndexHtmlWithBuildings(
				makeBuildingRow(
					"Hugh Dempster Pavilion",
					"DMP",
					"6245 Agronomy Road V6T 1Z4",
					"./campus/discover/buildings-and-classrooms/DMP.htm"
				)
			);

			const roomHtml = makeRoomPage(
				makeRoomRow(
					"101",
					"40",
					"Classroom-Movable Tables & Chairs",
					"Open Design General Purpose",
					"http://students.ubc.ca/campus/discover/buildings-and-classrooms/room/DMP-101"
				)
			);

			const zipBuf = await makeMinimalFacilitiesZip({
				"index.htm": indexHtml,
				"campus/discover/buildings-and-classrooms/DMP.htm": roomHtml,
			});

			const postRes = await request(app)
				.post("/api/v2/datasets")
				.field("kind", "facilities")
				.attach("archive", zipBuf, "facilities-minimal-success.zip");

			expect(postRes.status).to.equal(ACCEPTED);

			const done = await waitForProcessingV2(app, postRes.body.id);
			expect(done.status).to.equal(OK);
			expect(done.body.status).to.equal("completed");
			expect(done.body.stats).to.deep.equal({
				files_total: 2,
				files_processed: 2,
				files_skipped: 0,
				buildings_seen: 1,
				buildings_added: 1,
				buildings_modified: 0,
				rooms_seen: 1,
				rooms_added: 1,
				rooms_modified: 0,
			});

			const buildingRes = await request(app).get("/api/v2/buildings/DMP");
			expect(buildingRes.status).to.equal(OK);
			expect(buildingRes.body).to.include({
				id: "DMP",
				name: "Hugh Dempster Pavilion",
				address: "6245 Agronomy Road V6T 1Z4",
			});

			const roomRes = await request(app).get("/api/v2/buildings/DMP/rooms/DMP_101");
			expect(roomRes.status).to.equal(OK);
			expect(roomRes.body).to.include({
				id: "DMP_101",
				building: "DMP",
				number: "101",
				seats: 40,
				type: "Open Design General Purpose",
				furniture: "Classroom-Movable Tables & Chairs",
				href: "http://students.ubc.ca/campus/discover/buildings-and-classrooms/room/DMP-101",
			});
		});

		it("POST /api/v2/datasets should mark existing facilities resources as modified on re-upload", async () => {
			const indexHtml = makeIndexHtmlWithBuildings(
				makeBuildingRow(
					"Hugh Dempster Pavilion",
					"DMP",
					"6245 Agronomy Road V6T 1Z4",
					"./campus/discover/buildings-and-classrooms/DMP.htm"
				)
			);

			const roomHtml1 = makeRoomPage(
				makeRoomRow(
					"101",
					"40",
					"Classroom-Movable Tables & Chairs",
					"Open Design General Purpose",
					"http://students.ubc.ca/campus/discover/buildings-and-classrooms/room/DMP-101"
				)
			);

			const roomHtml2 = makeRoomPage(
				makeRoomRow(
					"101",
					"45",
					"Classroom-Movable Tables & Chairs",
					"Small Group",
					"http://students.ubc.ca/campus/discover/buildings-and-classrooms/room/DMP-101"
				)
			);

			const zipBuf1 = await makeMinimalFacilitiesZip({
				"index.htm": indexHtml,
				"campus/discover/buildings-and-classrooms/DMP.htm": roomHtml1,
			});

			const zipBuf2 = await makeMinimalFacilitiesZip({
				"index.htm": indexHtml,
				"campus/discover/buildings-and-classrooms/DMP.htm": roomHtml2,
			});

			const postRes1 = await request(app)
				.post("/api/v2/datasets")
				.field("kind", "facilities")
				.attach("archive", zipBuf1, "facilities-first.zip");

			expect(postRes1.status).to.equal(ACCEPTED);
			const done1 = await waitForProcessingV2(app, postRes1.body.id);
			expect(done1.status).to.equal(OK);
			expect(done1.body.status).to.equal("completed");
			expect(done1.body.stats).to.deep.equal({
				files_total: 2,
				files_processed: 2,
				files_skipped: 0,
				buildings_seen: 1,
				buildings_added: 1,
				buildings_modified: 0,
				rooms_seen: 1,
				rooms_added: 1,
				rooms_modified: 0,
			});

			const postRes2 = await request(app)
				.post("/api/v2/datasets")
				.field("kind", "facilities")
				.attach("archive", zipBuf2, "facilities-second.zip");

			expect(postRes2.status).to.equal(ACCEPTED);
			const done2 = await waitForProcessingV2(app, postRes2.body.id);
			expect(done2.status).to.equal(OK);
			expect(done2.body.status).to.equal("completed");
			expect(done2.body.stats).to.deep.equal({
				files_total: 2,
				files_processed: 2,
				files_skipped: 0,
				buildings_seen: 1,
				buildings_added: 0,
				buildings_modified: 0,
				rooms_seen: 1,
				rooms_added: 0,
				rooms_modified: 1,
			});

			const roomRes = await request(app).get("/api/v2/buildings/DMP/rooms/DMP_101");
			expect(roomRes.status).to.equal(OK);
			expect(roomRes.body).to.include({
				id: "DMP_101",
				building: "DMP",
				number: "101",
				seats: 45,
				type: "Small Group",
			});
		});
	});
});
