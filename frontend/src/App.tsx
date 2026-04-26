import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { ToastProvider } from "./components/Toast";
import { ConfigsPage } from "./pages/ConfigsPage";
import { DatasetsPage } from "./pages/DatasetsPage";
import { GalleryPage } from "./pages/GalleryPage";
import { GeneratePage } from "./pages/GeneratePage";
import { HomePage } from "./pages/HomePage";
import { MediaPage } from "./pages/MediaPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TrainingPage } from "./pages/TrainingPage";

export function App() {
  return (
    <ToastProvider>
    <AppShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/training" element={<TrainingPage />} />
        <Route path="/datasets" element={<DatasetsPage />} />
        <Route path="/configs" element={<ConfigsPage />} />
        <Route path="/generate" element={<GeneratePage />} />
        <Route path="/media" element={<MediaPage />} />
        <Route path="/gallery" element={<GalleryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
    </ToastProvider>
  );
}
