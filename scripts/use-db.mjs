#!/usr/bin/env node
/**
 * Switch the Prisma datasource between sqlite (zero-setup local dev)
 * and postgresql (Supabase / Railway / RDS for staging and production).
 *
 *   npm run use:sqlite
 *   npm run use:postgres
 *
 * The schema itself is provider-agnostic on purpose: no native enums,
 * no Json columns, no arrays. Structured payloads are stored as TEXT
 * and parsed through the typed helpers in src/lib/json.ts, so the same
 * migration history works on both engines.
 */
import { readFileSync, writeFileSync } from "node:fs";

const target = process.argv[2];
if (!["sqlite", "postgresql"].includes(target)) {
  console.error("usage: node scripts/use-db.mjs <sqlite|postgresql>");
  process.exit(1);
}

const path = new URL("../prisma/schema.prisma", import.meta.url);
const next = readFileSync(path, "utf8").replace(
  /provider\s*=\s*"(sqlite|postgresql)"/,
  `provider = "${target}"`
);
writeFileSync(path, next);

console.log(`Prisma datasource set to ${target}.`);
console.log(
  target === "postgresql"
    ? 'Set DATABASE_URL to your Postgres connection string, then: npx prisma db push'
    : 'Set DATABASE_URL="file:./dev.db", then: npx prisma db push'
);
