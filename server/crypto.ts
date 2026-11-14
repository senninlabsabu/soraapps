import crypto from "node:crypto";
import { config } from "./config.js";

// 更新トークンなどを AES-256-GCM で暗号化して保存する
const key = crypto.createHash("sha256").update(config.encryptionKey).digest();

export function encryptText(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), body.toString("base64")].join(".");
}

export function decryptText(value: string): string {
  const [version, iv, tag, body] = value.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("暗号文の形式が正しくありません。");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}

export const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
