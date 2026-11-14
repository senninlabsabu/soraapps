import type { Response } from "express";
import { SenninError } from "./sennin.js";

// 画面へ返す理由つきのエラー（HTTP の状態と、画面で分岐するための code を持つ）
export class ApiError extends Error {
  status: number;
  code: string;
  remaining?: number;
  constructor(status: number, code: string, message: string, remaining?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.remaining = remaining;
  }
}

const SENNIN_STATUS: Record<string, number> = {
  not_linked: 403,
  scope: 403,
  insufficient_points: 402,
  owned: 409,
  failed: 409,
  invalid: 400,
  daily_limit: 429,
  unavailable: 503,
  unknown: 503
};

export function sendError(res: Response, error: unknown) {
  if (error instanceof ApiError) {
    res.status(error.status).json({ ok: false, error: error.message, code: error.code, remaining: error.remaining });
    return;
  }
  if (error instanceof SenninError) {
    res.status(SENNIN_STATUS[error.code] ?? 500).json({ ok: false, error: error.message, code: error.code, points: error.points });
    return;
  }
  console.error(error);
  res.status(500).json({ ok: false, error: "サーバーでエラーが発生しました。" });
}
