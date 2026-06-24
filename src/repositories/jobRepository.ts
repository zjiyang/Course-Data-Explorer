import fs from "fs/promises";
import path from "path";

export type DatasetKind = "course_offerings" | "facilities";

export type DatasetJob = {
	id: string;
	status: "processing" | "completed" | "failed";
	kind: DatasetKind;
	stats: Record<string, number>;
	message: string;
};

// ============================================================
// JobRepository — the only place that reads/writes dataset
// job records from disk. Controllers and services never call
// fs directly for job state.
// ============================================================

export class JobRepository {
	private filePath: string;

	constructor(datadir: string) {
		this.filePath = path.join(datadir, "db.json");
	}

	private async readDb(): Promise<Record<string, any>> {
		try {
			const txt = await fs.readFile(this.filePath, "utf-8");
			return JSON.parse(txt);
		} catch {
			return { courses: {}, sections: {}, buildings: {}, rooms: {}, datasets: {} };
		}
	}

	private async writeDb(db: Record<string, any>): Promise<void> {
		await fs.writeFile(this.filePath, JSON.stringify(db, null, 2), "utf-8");
	}

	async getById(id: string): Promise<DatasetJob | undefined> {
		const db = await this.readDb();
		return db.datasets?.[id];
	}
}
