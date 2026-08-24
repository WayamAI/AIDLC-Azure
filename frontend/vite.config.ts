import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
// Prefer 8001 when Setu (or another app) already owns 8000 on this machine.
const backendPort = process.env.BACKEND_PORT || "8001";
const proxyConfig = {
  "/api": {
    target: `http://localhost:${backendPort}`,
    changeOrigin: true,
    ws: true,
  },
};

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: Number(process.env.PORT) || 8081,
    strictPort: true,
    allowedHosts: ["blowing-domain-boss-hose.trycloudflare.com"],
    watch: {
      usePolling: true,
      interval: 300,
    },
    hmr: {
      overlay: false,
    },
    proxy: proxyConfig,
  },
  preview: {
    host: "::",
    port: 8080,
    proxy: proxyConfig,
  },
  optimizeDeps: {
    include: [
      "react", 
      "react-dom", 
      "sigma", 
      "@react-sigma/core", 
      "graphology", 
      "graphology-layout-forceatlas2",
      "graphology-communities-louvain"
    ],
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "react": path.resolve(__dirname, "./node_modules/react"),
      "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
      "react-dom/client": path.resolve(__dirname, "./node_modules/react-dom/client"),
    },
  },
}));
