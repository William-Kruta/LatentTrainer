import { PageSection } from "../components/PageSection";
import { GalleryViewer } from "../components/gallery/GalleryViewer";

export function GalleryPage() {
  return (
    <div className="page-stack">
      <PageSection eyebrow="Library" title="Gallery">
        <GalleryViewer />
      </PageSection>
    </div>
  );
}
