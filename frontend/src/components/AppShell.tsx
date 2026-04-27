import { NavLink, useLocation } from "react-router-dom";
import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import { CommandPalette } from "./CommandPalette";
import { GlobalJobDrawer } from "./GlobalJobDrawer";
import { RecentOutputsStrip } from "./RecentOutputsStrip";

interface DropdownItem { to: string; label: string }
interface NavGroup { label: string; items: DropdownItem[] }
type NavEntry = { kind: "link"; to: string; label: string } | { kind: "group" } & NavGroup;

const NAV: NavEntry[] = [
  { kind: "link",  to: "/", label: "Home" },
  { kind: "group", label: "Studio",  items: [
    { to: "/training", label: "Training" },
    { to: "/generate", label: "Generate" },
  ]},
  { kind: "group", label: "Library", items: [
    { to: "/media",    label: "Media" },
    { to: "/gallery",  label: "Gallery" },
    { to: "/datasets", label: "Datasets" },
    { to: "/configs",  label: "Configs" },
  ]},
  { kind: "link", to: "/chat", label: "Chat" },
  { kind: "link", to: "/health", label: "Health" },
];

function NavDropdown({ label, items }: NavGroup) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const isActive = items.some((i) => location.pathname.startsWith(i.to));

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="nav-dropdown" ref={ref}>
      <button
        className={`nav-link nav-dropdown-trigger${isActive ? " active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        type="button"
        aria-expanded={open}
      >
        {label}
        <svg
          className={`nav-dropdown-caret${open ? " open" : ""}`}
          width="10" height="10" viewBox="0 0 10 10"
          fill="none" aria-hidden="true"
        >
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div className="nav-dropdown-menu">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive: a }) => `nav-dropdown-item${a ? " active" : ""}`}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">⚡</span>
          LatentTrainer
        </div>
        <nav className="topnav">
          {NAV.map((entry) =>
            entry.kind === "link" ? (
              <NavLink
                key={entry.to}
                to={entry.to}
                end={entry.to === "/"}
                className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
              >
                {entry.label}
              </NavLink>
            ) : (
              <NavDropdown key={entry.label} label={entry.label} items={entry.items} />
            )
          )}
        </nav>
        <GlobalJobDrawer />
        <NavLink
          to="/settings"
          className={({ isActive }) => `topbar-settings-btn${isActive ? " active" : ""}`}
          title="Settings"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </NavLink>
      </header>
      <CommandPalette />
      <main className="page">{children}</main>
      <RecentOutputsStrip />
    </div>
  );
}
