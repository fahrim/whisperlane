import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { Pill } from "./Pill";

// One bundle serves both windows; the label decides which surface runs.
// The pill is an overlay that never takes focus, so it must not mount
// the settings tree at all.
const surface = getCurrentWindow().label === "pill" ? <Pill /> : <App />;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{surface}</React.StrictMode>,
);