import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../theme/tokens.css";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");
const mountRoot: HTMLElement = root;

// Build-time constant: a non-demo build statically drops the whole branch
// below (and the ?app handling and DemoLanding import with it), so nothing
// demo-specific reaches production.
const isDemo = import.meta.env.VITE_IDENT_DEMO === "true";

async function render() {
  if (isDemo) {
    // The landing embeds the app full-bleed as its hero; ?app renders just the
    // app (the phone frame in the showcase section, or reachable directly).
    const bareApp = new URLSearchParams(window.location.search).has("app");
    if (!bareApp) {
      const { DemoLanding } = await import("../demo/DemoLanding");
      createRoot(mountRoot).render(
        <StrictMode>
          <DemoLanding />
        </StrictMode>,
      );
      return;
    }
  }

  createRoot(mountRoot).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void render();
