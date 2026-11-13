import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/plus-jakarta-sans/wght.css";
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/atkinson-hyperlegible-next/wght.css";
import "./styles.css";

if (new URLSearchParams(window.location.search).get("window") === "today-widget") {
  document.documentElement.dataset.window = "today-widget";
}
document.documentElement.dataset.theme = "glassmorphism";
document.documentElement.dataset.glassVariant = "dark";
document.documentElement.dataset.font = "segoe-ui";

const root = createRoot(document.getElementById("root")!);

async function mountWindow() {
  const Component = new URLSearchParams(window.location.search).get("window") === "today-widget"
    ? (await import("./components/TodayWidget")).TodayWidget
    : (await import("./App")).default;
  root.render(
    <React.StrictMode>
      <Component />
    </React.StrictMode>,
  );
}

void mountWindow();
