import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, type SystemOverview } from "../lib/api";

interface Command {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

export function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [overview, setOverview] = useState<SystemOverview | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(value => !value);
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) void api.getSystemOverview().then(setOverview).catch(console.error);
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      { id: "home", label: "Go to Home", hint: "Navigate", run: () => navigate("/") },
      { id: "training", label: "Go to Training", hint: "Navigate", run: () => navigate("/training") },
      { id: "generate", label: "Go to Generate", hint: "Navigate", run: () => navigate("/generate") },
      { id: "media", label: "Go to Media", hint: "Navigate", run: () => navigate("/media") },
      { id: "gallery", label: "Go to Gallery", hint: "Navigate", run: () => navigate("/gallery") },
      { id: "datasets", label: "Go to Datasets", hint: "Navigate", run: () => navigate("/datasets") },
      { id: "chat", label: "Go to Chat", hint: "Navigate", run: () => navigate("/chat") },
      { id: "health", label: "Open Model/Env Health", hint: "System", run: () => navigate("/health") },
      { id: "download", label: "Open Media Download", hint: "Media", run: () => navigate("/media") },
    ];
    for (const item of overview?.recent_outputs ?? []) {
      base.push({
        id: `recent-${item.filename}`,
        label: `Open ${item.title}`,
        hint: "Recent output",
        run: () => navigate("/media"),
      });
    }
    return base;
  }, [navigate, overview]);

  const filtered = commands.filter(command =>
    `${command.label} ${command.hint}`.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 12);

  if (!open) return null;
  return (
    <div className="command-backdrop" onClick={() => setOpen(false)}>
      <div className="command-palette" onClick={event => event.stopPropagation()}>
        <input
          autoFocus
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Run command..."
        />
        <div className="command-list">
          {filtered.map(command => (
            <button
              key={command.id}
              type="button"
              onClick={() => {
                command.run();
                setOpen(false);
                setQuery("");
              }}
            >
              <span>{command.label}</span>
              <small>{command.hint}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
