// Nav — desktop top nav, mobile top bar + bottom nav, and the
// view-transition-aware NavLink wrapper they share.
import { Link, NavLink, useNavigate } from "react-router-dom";
import { prefersReducedMotion, startViewTransition } from "../lib/transitions";
import NavIcon from "./NavIcon";
import SyncButton from "./SyncButton";
import SyncDealsButton from "./SyncDealsButton";

// NavLink wrapper that runs navigation inside a native View Transition when
// the browser supports it (and the user hasn't asked for reduced motion).
function TNavLink({ to, ...props }) {
  const navigate = useNavigate();
  return (
    <NavLink
      to={to}
      onClick={(e) => {
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
        if (!document.startViewTransition || prefersReducedMotion()) return; // let default navigation happen
        e.preventDefault();
        startViewTransition(navigate, to);
      }}
      {...props}
    />
  );
}

export function TopNav({ onSyncDone }) {
  const link = ({ isActive }) =>
    `px-3 py-2 rounded text-sm font-display font-bold uppercase tracking-wider transition ${
      isActive ? "cyber-nav-active" : "hover:opacity-70"}`;
  return (
    <nav className="hidden md:flex items-center gap-1 px-6 py-3 border-b backdrop-blur-md sticky top-0 z-30" style={{borderColor:'var(--border)', background:'rgba(10,10,11,0.9)'}}>
      <Link to="/" className="mr-4 text-lg font-display font-black tracking-widest" style={{color:'var(--accent)'}}>
        ◈ BACKLOG<span style={{color:'var(--text-muted)'}}>.EXE</span>
      </Link>
      <TNavLink to="/" end className={link}>Home</TNavLink>
      <TNavLink to="/backlog" className={link}>Backlog</TNavLink>
      <TNavLink to="/recommend" className={link}>Recommend</TNavLink>
      <TNavLink to="/wishlist" className={link}>Wishlist</TNavLink>
      <TNavLink to="/upcoming" className={link}>Upcoming</TNavLink>
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => window.dispatchEvent(new Event("open-command-palette"))}
          className="cyber-btn flex items-center gap-2 px-3 py-2 rounded text-xs"
          style={{color:'var(--text-muted)'}}
        >
          <span>Search</span>
          <kbd className="palette-kbd">⌘K</kbd>
        </button>
        <SyncDealsButton />
        <SyncButton onDone={onSyncDone} />
      </div>
    </nav>
  );
}

export function BottomNav({ onSyncDone }) {
  const link = ({ isActive }) => isActive ? "active" : "";
  return (
    <>
      {/* mobile top bar — logo + sync only */}
      <div className="md:hidden flex items-center justify-between px-4 py-2.5 border-b backdrop-blur-md sticky top-0 z-30" style={{borderColor:'var(--border)', background:'rgba(10,10,11,0.9)'}}>
        <Link to="/" className="text-base font-display font-black tracking-widest" style={{color:'var(--accent)'}}>
          ◈ BACKLOG<span style={{color:'var(--text-muted)'}}>.EXE</span>
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.dispatchEvent(new Event("open-command-palette"))}
            className="cyber-btn px-2.5 py-2 rounded text-xs"
            aria-label="Search"
          >
            🔍
          </button>
          <SyncButton onDone={onSyncDone} compact />
        </div>
      </div>
      {/* mobile bottom nav */}
      <nav className="bottom-nav md:hidden">
        <TNavLink to="/" end className={link}><NavIcon name="home" /><span>Home</span></TNavLink>
        <TNavLink to="/backlog" className={link}><NavIcon name="backlog" /><span>Backlog</span></TNavLink>
        <TNavLink to="/recommend" className={link}><NavIcon name="recommend" /><span>Recs</span></TNavLink>
        <TNavLink to="/wishlist" className={link}><NavIcon name="wishlist" /><span>Wish</span></TNavLink>
        <TNavLink to="/upcoming" className={link}><NavIcon name="upcoming" /><span>Soon</span></TNavLink>
      </nav>
    </>
  );
}
