// App — routing shell. Data fetching lives in src/hooks, shared helpers in
// src/lib, UI in src/components, and full pages in src/pages. `version` is
// bumped after a sync so every mounted page's data hooks refetch.
import { useState } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import CommandPalette from "./components/CommandPalette";
import Home from "./pages/Home";
import Backlog from "./pages/Backlog";
import Recommend from "./pages/Recommend";
import Upcoming from "./pages/Upcoming";
import Wishlist from "./pages/Wishlist";

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
