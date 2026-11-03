import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendDirectory = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(backendDirectory, "..", "src", "schema.sql");
const outputDirectory = path.join(backendDirectory, "..", "dist");
await mkdir(outputDirectory, { recursive: true });
await copyFile(source, path.join(outputDirectory, "schema.sql"));
