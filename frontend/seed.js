const fs = require("fs");
const path = require("path");
const http = require("http");

const ZIP_PATH = path.join(__dirname, "data", "partial-pair.zip");
const PORT = 4321;
const MAX_TRIES = 30;
const RETRY_DELAY = 2000;

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpGet(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: "localhost", port: PORT, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: {} }); }
      });
    }).on("error", reject);
  });
}

async function serverReady() {
  for (let i = 0; i < MAX_TRIES; i++) {
    try {
      await httpGet("/api/v1/courses?limit=1");
      console.log("Server is ready.");
      return true;
    } catch {
      console.log(`Waiting for server... (${i + 1}/${MAX_TRIES})`);
      await wait(RETRY_DELAY);
    }
  }
  return false;
}

async function hasData() {
  try {
    const res = await httpGet("/api/v1/courses?limit=1");
    return (res.data.total ?? 0) > 0;
  } catch {
    return false;
  }
}

function httpPost(urlPath, body, contentType) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body);
    const req = http.request(
      {
        hostname: "localhost",
        port: PORT,
        path: urlPath,
        method: "POST",
        headers: {
          "Content-Type": contentType,
          "Content-Length": buf.length,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, data: {} }); }
        });
      }
    );
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
}

function uploadZip() {
  return new Promise((resolve, reject) => {
    const boundary = "----FormBoundary" + Date.now();
    const fileBuffer = fs.readFileSync(ZIP_PATH);
    const filename = path.basename(ZIP_PATH);

    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="kind"\r\n\r\ncourse_offerings\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="archive"; filename="${filename}"\r\n` +
      `Content-Type: application/zip\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, fileBuffer, footer]);

    const req = http.request(
      {
        hostname: "localhost",
        port: PORT,
        path: "/api/v1/datasets",
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, data: {} }); }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function pollJob(id) {
  // Try v2 first (C2 spec), fall back to v1 for backwards compatibility
  const pollPath = `/api/v2/datasets/${encodeURIComponent(id)}`;
  const fallbackPath = `/api/v1/datasets/${encodeURIComponent(id)}`;
  for (let i = 0; i < 60; i++) {
    await wait(1000);
    let res = await httpGet(pollPath);
    if (res.status === 404) res = await httpGet(fallbackPath);
    console.log(`Job status: ${res.data.status}`);
    if (res.data.status === "completed" || res.data.status === "failed") return res.data;
  }
  throw new Error("Timed out waiting for job");
}

async function main() {
  console.log("Waiting for server...");
  const ready = await serverReady();
  if (!ready) { console.error("Server did not start."); process.exit(1); }

  if (await hasData()) {
    console.log("Data already loaded, skipping upload.");
    return;
  }

  console.log("Uploading partial-pair.zip...");
  const upload = await uploadZip();
  if (upload.status !== 202) {
    console.error("Upload failed:", upload.data);
    process.exit(1);
  }

  console.log(`Job created: ${upload.data.id}`);
  const result = await pollJob(upload.data.id);

  if (result.status === "completed") {
    console.log("Dataset loaded successfully ✅");
  } else {
    console.error("Dataset upload failed:", result.message);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });