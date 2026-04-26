import type { PropsWithChildren, ReactNode } from "react";

interface PageSectionProps extends PropsWithChildren {
  eyebrow?: string;
  title: string;
  actions?: ReactNode;
  className?: string;
  bare?: boolean;
}

export function PageSection({ eyebrow, title, actions, className, bare, children }: PageSectionProps) {
  return (
    <section className={`${bare ? "" : "section-card"} ${className ?? ""}`.trim()}>
      <div className="section-header">
        <div>
          {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
          <h2>{title}</h2>
        </div>
        {actions ? <div className="section-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
