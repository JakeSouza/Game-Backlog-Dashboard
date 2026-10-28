// Layout — the page shell: background layers, nav bars, main content slot,
// and footer. Every page renders its content inside this wrapper.
import { BottomNav, TopNav } from "./Nav";

export default function Layout({ onSyncDone, children }) {
  return (
    <div className="min-h-screen font-body relative">
      <div className="cyber-bg" />
      <div className="relative z-10">
        <TopNav onSyncDone={onSyncDone} />
        <BottomNav onSyncDone={onSyncDone} />
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8">{children}</main>
        <footer className="hidden md:block text-center text-[11px] font-mono-tech py-6" style={{color:'var(--text-dim)'}}>
          // LIVE_DATA :: SUPABASE :: EDGE_FUNCTION :: sync-games //
        </footer>
      </div>
    </div>
  );
}
