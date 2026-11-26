import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Cascade order matters: tokens, then base and layout, shared components, then page styles.
import "./styles/tailwind.css";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/machines.css";
import "./styles/paytables.css";
import "./styles/wallets.css";
import "./styles/settings.css";
import "./styles/session.css";
import "./styles/stats.css";
import "./styles/analyzer.css";
import "./styles/ai.css";
import "./styles/cruise.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
