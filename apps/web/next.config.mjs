import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Cargamos (SOLO LECTURA) el .env de la raíz del monorepo como única fuente de
// credenciales de la RDS Data API. No se modifica ese archivo; solo se lee.
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../../.env") });

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Compilamos el TS de los paquetes del monorepo que consumimos directamente.
  transpilePackages: ["@cqms/db", "@cqms/shared"],
};

export default nextConfig;
