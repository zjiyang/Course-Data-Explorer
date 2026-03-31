import JSZip from "jszip";

export type DatasetKind = "course_offerings" | "facilities";

export type AcceptedDatasetJob = {
	id: string;
	status: "processing";
	kind: DatasetKind;
	message: string;
};

export async function acceptV2DatasetUpload(): Promise<AcceptedDatasetJob> {
	throw new Error("Not implemented yet");
}