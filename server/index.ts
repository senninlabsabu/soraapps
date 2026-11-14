import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import multer from "multer";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { auth } from "./auth.js";
import { store } from "./store.js";
import { dev } from "./dev.js";
import { run } from "./run.js";
import { admin } from "./admin.js";
import { images } from "./images.js";
import { sendError } from "./errors.js";

const app = express();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "soraapps" });
});

app.use("/api", images);
app.use("/api", auth);
app.use("/api", store);
app.use("/api", dev);
app.use("/api", run);
app.use("/api", admin);
app.use("/api", (_req, res) => {
  res.status(404).json({ ok: false, error: "見つかりません。" });
});

// 本番では、ビルドした画面（dist）を同じサーバーから配る
const dist = path.join(root, "dist");
if (existsSync(path.join(dist, "index.html"))) {
  app.use(express.static(dist, { index: false, maxAge: "1h" }));
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    res.sendFile(path.join(dist, "index.html"));
  });
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof multer.MulterError) {
    res.status(413).json({ ok: false, error: "ファイルまたは入力が大きすぎます。" });
    return;
  }
  if (error instanceof SyntaxError) {
    res.status(400).json({ ok: false, error: "入力の形式が正しくありません。" });
    return;
  }
  sendError(res, error);
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`soraapps listening on ${config.port}`);
});
