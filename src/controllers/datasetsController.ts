import { Request, Response, NextFunction } from "express";
import { acceptV2DatasetUpload, DatasetKind } from "../services/datasets";
import { JobRepository } from "../repositories/jobRepository";
import { NotFoundError } from "../models/errors";

// ============================================================
// DatasetsController — HTTP concerns only.
// Reads req, calls service/repository, writes res.
// No business logic, no direct persistence access.
// ============================================================

export type DatasetsControllerDeps = {
	datadir: string;
	model: {
		createDatasetJob(id: string, kind: DatasetKind): Promise<void>;
		failDatasetJob(id: string, message: string): Promise<void>;
		processCourseOfferingsZip(id: string, zip: any): Promise<void>;
		processFacilitiesZip(id: string, zip: any): Promise<void>;
	};
};

export function makeDatasetsController(deps: DatasetsControllerDeps) {
	const { datadir, model } = deps;

	async function uploadV2Dataset(req: Request, res: Response): Promise<void> {
		const kind = req.body?.kind as DatasetKind;
		const uploadedFile = req.file!;

		const accepted = await acceptV2DatasetUpload({
			kind,
			archiveBuffer: uploadedFile.buffer,
			model,
		});

		res.status(202).send(accepted);
	}

	async function getV2Dataset(req: Request, res: Response, next: NextFunction): Promise<void> {
		try {
			const jobRepo = new JobRepository(datadir);
			const job = await jobRepo.getById(req.params.id);

			if (!job) {
				throw new NotFoundError(`no dataset with id '${req.params.id}'`);
			}

			res.status(200).send(job);
		} catch (err) {
			next(err);
		}
	}

	return { uploadV2Dataset, getV2Dataset };
}
