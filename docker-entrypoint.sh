#!/bin/sh
set -e

echo "[entrypoint] pushing database schema..."
# Sources DATABASE_URL from the container environment. `db push` is
# idempotent and safe on an existing volume — it converges the schema.
npx prisma db push --skip-generate

echo "[entrypoint] starting next on :${PORT:-3100}"
exec npx next start -p "${PORT:-3100}"
