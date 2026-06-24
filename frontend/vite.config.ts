import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Course Data Explorer frontend build config.
// Dev server proxies /api to the Express backend (started separately via
// `yarn start` from the project root, default port 4321).
// Production build output goes to dist/, which the backend serves statically
// (see src/App.ts: app.use(express.static("frontend/dist"))).
export default defineConfig({
	plugins: [react()],
	server: {
		port: 5173,
		proxy: {
			"/api": {
				target: "http://localhost:4321",
				changeOrigin: true,
			},
		},
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
});
