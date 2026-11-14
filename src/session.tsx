import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import type { Me } from "./types";

type Session = {
  me: Me;
  loading: boolean;
  reload: () => Promise<void>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

// ログイン中の人の情報を、画面全体で共有する
export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const data = await api<{ user: Me }>("/api/me");
      setMe(data.user);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setMe(null);
  }, []);

  return <SessionContext.Provider value={{ me, loading, reload, logout }}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const value = useContext(SessionContext);
  if (!value) throw new Error("SessionProvider の中で使ってください。");
  return value;
}
