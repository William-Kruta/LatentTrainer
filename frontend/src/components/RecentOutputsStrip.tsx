import { useEffect, useState } from "react";

import { api, type MediaVideo } from "../lib/api";

export function RecentOutputsStrip() {
  const [items, setItems] = useState<MediaVideo[]>([]);

  useEffect(() => {
    void api.getSystemOverview().then(overview => setItems(overview.recent_outputs.slice(0, 8))).catch(() => {});
    const id = window.setInterval(() => {
      void api.getSystemOverview().then(overview => setItems(overview.recent_outputs.slice(0, 8))).catch(() => {});
    }, 10000);
    return () => window.clearInterval(id);
  }, []);

  if (items.length === 0) return null;
  return (
    <div className="recent-output-strip">
      <span className="recent-output-label">Recent</span>
      {items.map(item => (
        <a key={item.filename} href={item.video_url} target="_blank" rel="noreferrer" title={item.title}>
          {item.media_type === "image" ? (
            <img src={item.video_url} alt={item.title} />
          ) : (
            <span className="recent-video-thumb">▶</span>
          )}
          <span>{item.title}</span>
        </a>
      ))}
    </div>
  );
}
