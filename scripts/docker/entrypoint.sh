#!/bin/sh
# Starts as root only to make the data volume writable, then runs the server as `node`.
# Many hosts (bind mounts, Fly, Railway, Render) mount volumes owned by root.
set -eu
DATA="${TERRAKIN_DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA"
  chown -R node:node "$DATA"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
