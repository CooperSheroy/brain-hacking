import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { readFile } from "node:fs/promises";

const root = process.cwd();
const port = Number(process.env.PORT || 4175);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function resolvePath(url) {
  const requested = new URL(url, `http://localhost:${port}`).pathname;
  const clean = normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "");
  if (clean === "/" || !extname(clean)) {
    return join(root, "index.html");
  }
  return join(root, clean);
}

const server = createServer(async (req, res) => {
  try {
    const filePath = resolvePath(req.url || "/");
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": types[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`Brain Hacking is running at http://localhost:${port}`);
});
