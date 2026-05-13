// Side-effect module: loads .env into process.env BEFORE other imports run.
// Import this FIRST in any script that needs env vars from .env without
// relying on the `dotenv` npm package.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

(function loadDotEnv() {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 6; i++) {
        const envPath = path.join(dir, ".env");
        if (fs.existsSync(envPath)) {
            const raw = fs.readFileSync(envPath, "utf-8");
            for (const line of raw.split(/\r?\n/)) {
                const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
                if (!m) continue;
                if (process.env[m[1]] !== undefined) continue;
                let v = m[2].trim();
                if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
                process.env[m[1]] = v;
            }
            return envPath;
        }
        const up = path.dirname(dir);
        if (up === dir) break;
        dir = up;
    }
    return null;
})();
