// ============================================================
// src/App.jsx — route shell. Every page and component lives in its
// own module (src/pages, src/components, src/hooks, src/lib).
//
// `version` is a global refresh token: any sync or mutation bumps it
// (via onSyncDone), and every page's data hooks refetch when it
// changes — instant refresh, no reload.
// ============================================================
import { useState } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import { CommandPalette } from "./components/CommandPalette";
import { Home } from "./pages/Home";
import { Backlog } from "./pages/Backlog";
import { Recommend } from "./pages/Recommend";
import { Wishlist } from "./pages/Wishlist";
import { Upcoming } from "./pages/Upcoming";

export default function App() {
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  return (
    <HashRouter>
      <CommandPalette onSyncDone={bump} />
      <Routes>
        <Route path="/" element={<Home version={version} onSyncDone={bump} />} />
        <Route path="/backlog" element={<Backlog version={version} onSyncDone={bump} />} />
        <Route path="/recommend" element={<Recommend version={version} onSyncDone={bump} />} />
        <Route path="/wishlist" element={<Wishlist version={version} onSyncDone={bump} />} />
        <Route path="/upcoming" element={<Upcoming version={version} onSyncDone={bump} />} />
      </Routes>
    </HashRouter>
  );
}
