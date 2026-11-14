import type { NextFunction, Request, Response } from "express";
import { sb } from "./supabase.js";
import { randomToken, sha256 } from "./crypto.js";

export const SESSION_COOKIE = "sa_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export const cookieBase = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/"
};

export async function startSession(res: Response, userId: string) {
  const token = randomToken();
  const { error } = await sb.from("sa_sessions").insert({
    token_hash: sha256(token),
    user_id: userId,
    expires_at: new Date(Date.now() + SESSION_MS).toISOString()
  });
  if (error) throw error;
  res.cookie(SESSION_COOKIE, token, { ...cookieBase, maxAge: SESSION_MS });
}

export async function endSession(token: unknown) {
  if (typeof token === "string" && token) {
    await sb.from("sa_sessions").delete().eq("token_hash", sha256(token));
  }
}

// Cookie から、ログイン中のユーザーIDを取り出す（無効・期限切れは null）
export async function sessionUserId(token: unknown): Promise<string | null> {
  if (typeof token !== "string" || !token) return null;
  const { data, error } = await sb
    .from("sa_sessions")
    .select("user_id, expires_at")
    .eq("token_hash", sha256(token))
    .maybeSingle();
  if (error) throw error;
  if (!data || new Date(data.expires_at as string).getTime() < Date.now()) return null;
  return data.user_id as string;
}

// ログインが必要な API
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = await sessionUserId(req.cookies?.[SESSION_COOKIE]);
    if (!userId) {
      res.status(401).json({ ok: false, error: "ログインしてください。" });
      return;
    }
    res.locals.userId = userId;
    next();
  } catch (error) {
    next(error);
  }
}

// ログインしていれば userId を入れる（していなくても進む）。一覧の「持っている」表示などに使う
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  try {
    res.locals.userId = (await sessionUserId(req.cookies?.[SESSION_COOKIE])) ?? null;
    next();
  } catch (error) {
    next(error);
  }
}

export const currentUserId = (res: Response): string => res.locals.userId as string;
export const maybeUserId = (res: Response): string | null => (res.locals.userId as string | null) ?? null;
