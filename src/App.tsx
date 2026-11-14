import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { SessionProvider, useSession } from "./session";
import { Shell } from "./components/Shell";
import { Login } from "./pages/Login";
import { Store } from "./pages/Store";
import { AppDetail } from "./pages/AppDetail";
import { AuthorPage } from "./pages/AuthorPage";
import { Library } from "./pages/Library";
import { Runner } from "./pages/Runner";
import { Dev } from "./pages/Dev";
import { DevEditor } from "./pages/DevEditor";

// ログインが必要なページの入口
function RequireLogin({ children }: { children: JSX.Element }) {
  const { me, loading } = useSession();
  if (loading) return <p className="center muted pad">読み込み中…</p>;
  if (!me) return <Navigate to="/login" replace />;
  return children;
}

function RunnerRoute() {
  const { id } = useParams();
  return (
    <RequireLogin>
      <Runner id={id ?? ""} />
    </RequireLogin>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          {/* 拡張機能は全画面で開く（ストアの枠を使わない） */}
          <Route path="/run/:id" element={<RunnerRoute />} />
          <Route element={<Shell />}>
            <Route index element={<Store />} />
            <Route path="apps/:id" element={<AppDetail />} />
            <Route path="authors/:id" element={<AuthorPage />} />
            <Route path="library" element={<RequireLogin><Library /></RequireLogin>} />
            <Route path="dev" element={<RequireLogin><Dev /></RequireLogin>} />
            <Route path="dev/new" element={<RequireLogin><DevEditor /></RequireLogin>} />
            <Route path="dev/apps/:id/edit" element={<RequireLogin><DevEditor /></RequireLogin>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  );
}
