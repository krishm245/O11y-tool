import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  srcDir: "src",
  manifest: {
    name: "O11y Replay",
    description: "Capture and replay browser sessions for debugging.",
    permissions: [
      "activeTab",
      "alarms",
      "offscreen",
      "scripting",
      "storage",
      "tabCapture",
      "webNavigation",
    ],
    host_permissions: ["http://127.0.0.1:7331/*"],
    optional_host_permissions: ["http://*/*", "https://*/*"],
  },
});
