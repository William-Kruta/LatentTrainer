import { useState, type PropsWithChildren } from "react";

interface CollapsibleSectionProps extends PropsWithChildren {
  title: string;
  defaultOpen?: boolean;
}

export function CollapsibleSection({ title, defaultOpen = true, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="section-card">
      <div className="collapsible-header" onClick={() => setOpen((o) => !o)}>
        <span className="collapsible-title">{title}</span>
        <span className={`collapsible-chevron${open ? " open" : ""}`}>▼</span>
      </div>
      {open ? <div className="collapsible-body">{children}</div> : null}
    </div>
  );
}
