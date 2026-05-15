import { createFileRoute } from "@tanstack/react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import IndexPage from "@/pages/Index";

export const Route = createFileRoute("/")({
  component: () => (
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <IndexPage />
    </TooltipProvider>
  ),
});
