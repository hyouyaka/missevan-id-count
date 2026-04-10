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
          toast:
            "border border-[rgba(30,32,41,0.12)] bg-[rgba(255,250,243,0.98)] text-[rgb(30,32,41)] shadow-[0_18px_40px_-28px_rgba(30,32,41,0.18)]",
          title: "text-[rgb(30,32,41)] font-medium",
          description: "text-[rgba(30,32,41,0.72)]",
          content: "gap-1.5",
          success:
            "border-[rgba(59,62,122,0.2)] bg-[rgba(243,241,251,0.98)] text-[rgb(30,32,41)]",
          info:
            "border-[rgba(59,62,122,0.18)] bg-[rgba(250,248,255,0.98)] text-[rgb(30,32,41)]",
          warning:
            "border-[rgba(239,131,95,0.24)] bg-[rgba(255,240,233,0.94)] text-[rgb(30,32,41)]",
          error:
            "border-[rgba(239,131,95,0.24)] bg-[rgba(255,240,233,0.94)] text-[rgb(30,32,41)]",
          loading:
            "border-[rgba(59,62,122,0.18)] bg-[rgba(250,248,255,0.98)] text-[rgb(30,32,41)]",
          actionButton:
            "bg-[rgb(59,62,122)] text-[rgb(252,251,255)] hover:bg-[rgb(47,50,101)]",
          cancelButton:
            "bg-[rgba(255,240,233,0.94)] text-[rgb(126,75,67)] hover:bg-[rgba(239,131,95,0.18)]",
          closeButton:
            "border-[rgba(30,32,41,0.12)] bg-[rgba(255,250,243,0.96)] text-[rgba(30,32,41,0.72)] hover:bg-[rgba(255,240,233,0.74)] hover:text-[rgb(30,32,41)]",
        },
      }}
    />
  </StrictMode>
);
