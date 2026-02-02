import { Log } from "@ubccpsc310/project-support";
import { createApp } from "./App";

Log.info("App - starting");

// Read configuration values from environment variables; if unset, use default values.
const port = process.env.PORT || "4321";
const datadir = process.env.DATA_DIR || "./data";

// Start the server
(async (): Promise<void> => {
	const app = await createApp({ datadir });
	const server = app
		.listen(port, () => {
			const address = server.address();
			const host = address && typeof address === "object" ? address.address : "localhost";
			const actualHost = host === "::" ? "localhost" : host;
			const url = `http://${actualHost}:${port}`;

			Log.info(`Server running at ${url}`);
		})
		.on("error", (err: Error) => {
			Log.error(`Failed to start server: ${err.message}`);
		});
})();
