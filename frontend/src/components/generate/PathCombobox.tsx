import { useEffect, useRef, useState } from "react";

interface PathComboboxProps {
  value: string;
  root: string;
  files: string[];
  onChange: (path: string) => void;
  placeholder?: string;
  noFilesPlaceholder?: string;
}

export function PathCombobox({ value, root, files, onChange, placeholder, noFilesPlaceholder }: PathComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query.trim()
    ? files.filter((f) => f.toLowerCase().includes(query.toLowerCase()))
    : files;

  function handleFocus() {
    setQuery("");
    setOpen(true);
  }

  function handleSelect(relativePath: string) {
    const sep = root.endsWith("/") ? "" : "/";
    onChange(`${root}${sep}${relativePath}`);
    setOpen(false);
    setQuery("");
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (open) {
      setQuery(e.target.value);
    } else {
      onChange(e.target.value);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
    }
  }

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  const displayValue = open ? query : value;

  return (
    <div className="lora-combobox" ref={containerRef}>
      <input
        ref={inputRef}
        value={displayValue}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder={open && files.length === 0 ? (noFilesPlaceholder ?? "No root configured") : (placeholder ?? "/path/to/file.safetensors")}
        autoComplete="off"
        spellCheck={false}
      />
      {open && files.length > 0 ? (
        <div className="lora-combobox-dropdown">
          {filtered.length === 0 ? (
            <div className="lora-combobox-empty">No matches</div>
          ) : (
            filtered.map((f) => (
              <button
                key={f}
                type="button"
                className="lora-combobox-option"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(f);
                }}
              >
                {f}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
