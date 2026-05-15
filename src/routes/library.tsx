import { createFileRoute } from "@tanstack/react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import LibraryPage from "@/pages/Library";

export const Route = createFileRoute("/library")({
  head: () => ({
    meta: [
      { title: "My Library — 3D Organic Chemistry Explorer" },
      {
        name: "description",
        content: "Your saved compounds and molecules. Search, favorite, and reopen them in the 3D viewer.",
      },
      { property: "og:title", content: "My Library — 3D Organic Chemistry Explorer" },
      {
        property: "og:description",
        content: "Your saved compounds and molecules. Search, favorite, and reopen them in the 3D viewer.",
      },
    ],
  }),
  component: () => (
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <LibraryPage />
    </TooltipProvider>
  ),
});
