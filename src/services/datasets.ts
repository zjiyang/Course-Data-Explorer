import JSZip from "jszip";

export type DatasetKind = "course_offerings" | "facilities";

export type AcceptedDatasetJob = {
	id: string;
	status: "processing";
	kind: DatasetKind;
	message: string;
};

type DatasetModel = {
	createDatasetJob(id: string, kind: DatasetKind): Promise<void>;
	failDatasetJob(id: string, message: string): Promise<void>;
	processCourseOfferingsZip(id: string, zip: JSZip): Promise<void>;
	processFacilitiesZip(id: string, zip: JSZip): Promise<void>;
};

export async function acceptV2DatasetUpload(input: {
	kind: DatasetKind;
	archiveBuffer: Buffer;
	model: DatasetModel;
}): Promise<AcceptedDatasetJob> {
	const { kind, archiveBuffer, model } = input;

	const id = `upload_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

	await model.createDatasetJob(id, kind);

	setImmediate(async () => {
		let zip: JSZip;

		try {
			zip = await JSZip.loadAsync(archiveBuffer);
		} catch {
			await model.failDatasetJob(id, "Data is not in a valid zip format");
			return;
		}

		try {
			if (kind === "course_offerings") {
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
			await model.failDatasetJob(id, "Processing failed");
		}
	});

	return {
		id,
		status: "processing",
		kind,
		message: "Dataset accepted for processing",
	};
}
