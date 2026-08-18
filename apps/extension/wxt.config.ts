import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: 'src',
  manifest: {
    name: 'O11y Replay',
    description: 'Capture and replay browser sessions for debugging.',
    permissions: ['activeTab', 'storage'],
    host_permissions: ['http://127.0.0.1:7331/*'],
  },
});
