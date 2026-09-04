import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve(process.cwd(), "out");
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

async function resolveFile(urlPath) {
  const pathname = decodeURIComponent(urlPath.split("?")[0]);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;

  try {
    const info = await stat(candidate);
    if (info.isFile()) return candidate;
    if (info.isDirectory()) return path.join(candidate, "index.html");
  } catch {
    if (!path.extname(candidate)) {
      try {
        const html = `${candidate}.html`;
        if ((await stat(html)).isFile()) return html;
      } catch {
        // The normal 404 response below handles missing extensionless routes.
      }
    }
  }
  return null;
}

createServer(async (request, response) => {
  const file = await resolveFile(request.url ?? "/");
  if (!file) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("見つかりません");
    return;
  }

  const extension = path.extname(file);
  const fallbackType = file.endsWith(`${path.sep}api${path.sep}health`) ? "application/json; charset=utf-8" : "application/octet-stream";
  response.writeHead(200, { "content-type": contentTypes.get(extension) ?? fallbackType });
  createReadStream(file).pipe(response);
}).listen(port, host, () => console.log(`AI会社を http://${host}:${port} で起動しました`));
