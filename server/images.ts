// 画像の保存と配信（保存先は Turso の sa_blobs）。
// 画像は中身で形式を確かめてから保存する。配信は /api/images/:id。ID はランダムな32文字の16進数。
import { randomBytes } from "node:crypto";
import { Router } from "express";
import { ensureBlobTable, tursoExecute, type TursoValue } from "./turso.js";

export const images = Router();

const ID_PATTERN = /^[0-9a-f]{32}$/;

export const imageUrl = (id: string) => `/api/images/${id}`;

// 画像の URL から ID を取り出す（前に保存したものを消すため）
export const imageIdFromUrl = (url: string | null | undefined): string | null => {
  const id = url?.split("/").pop() ?? "";
  return ID_PATTERN.test(id) ? id : null;
};

// 検査が済んだ画像を保存し、ID を返す
export async function saveImageBlob(buffer: Buffer, mime: string): Promise<string> {
  await ensureBlobTable();
  const id = randomBytes(16).toString("hex");
  await tursoExecute("insert into sa_blobs (id, content_type, size, data) values (?, ?, ?, ?)", [
    { type: "text", value: id },
    { type: "text", value: mime },
    { type: "integer", value: String(buffer.length) },
    { type: "blob", base64: buffer.toString("base64") }
  ]);
  return id;
}

export async function deleteImageBlobs(ids: string[]): Promise<void> {
  for (const id of ids.filter((x) => ID_PATTERN.test(x))) {
    await tursoExecute("delete from sa_blobs where id = ?", [{ type: "text", value: id }]);
  }
}

// 配信：長くキャッシュする（ID が変わると別の画像になるため、中身は変わらない）
images.get("/images/:id", async (req, res) => {
  const id = String(req.params.id);
  if (!ID_PATTERN.test(id)) {
    res.status(404).end();
    return;
  }
  try {
    const rows = await tursoExecute("select content_type, data from sa_blobs where id = ? limit 1", [{ type: "text", value: id }]);
    const row = rows[0] as TursoValue[] | undefined;
    if (!row) {
      res.status(404).end();
      return;
    }
    const type = row[0].type === "text" ? row[0].value : "application/octet-stream";
    const data = row[1].type === "blob" ? Buffer.from(row[1].base64, "base64") : Buffer.alloc(0);
    res.set({
      "Content-Type": type,
      "Content-Length": String(data.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(data);
  } catch (error) {
    console.error("[images] 画像の読み込みに失敗:", error);
    res.status(502).end();
  }
});
