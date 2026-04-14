import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const frontendRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, frontendRoot, "");
  const proxyTarget =
    env.VITE_DEV_API_PROXY_TARGET?.trim() || "http://127.0.0.1:8090";

  return {
    plugins: [react()],
    server: {
      port: 5174,
      strictPort: true,
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
