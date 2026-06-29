import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";

import { RootApp } from "@/app/RootApp";
import "@/index.css";

createRoot(document.getElementById("app")).render(
  <StrictMode>
    <RootApp />
    <Toaster
      position="top-center"
      theme="light"
      toastOptions={{
        classNames: {
          toast: "border border-border bg-[var(--surface-floating)] text-foreground shadow-[var(--shadow-panel)]",
          title: "font-medium text-foreground",
          description: "text-muted-foreground",
          content: "gap-1.5",
          success: "border-[color-mix(in_oklch,var(--accent-success)_24%,var(--border))] bg-[var(--surface-floating)] text-foreground",
          info: "border-[color-mix(in_oklch,var(--primary)_22%,var(--border))] bg-[var(--surface-floating)] text-foreground",
          warning: "border-[var(--border-warm)] bg-[var(--surface-floating)] text-foreground",
          error: "border-[var(--border-warm)] bg-[var(--surface-floating)] text-foreground",
          loading: "border-[color-mix(in_oklch,var(--primary)_22%,var(--border))] bg-[var(--surface-floating)] text-foreground",
          actionButton: "bg-primary text-primary-foreground hover:bg-[var(--primary-hover)]",
          cancelButton: "bg-[var(--surface-subtle)] text-foreground hover:bg-surface-hover",
          closeButton: "border-border bg-[var(--surface-floating)] text-muted-foreground hover:bg-surface-hover hover:text-foreground",
        },
      }}
    />
  </StrictMode>
);
