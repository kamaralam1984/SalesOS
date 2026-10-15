#!/usr/bin/env bash
# READ-ONLY inventory of a (shared) VPS before any SalesOS deployment. Changes nothing. Output: stdout (redirect to a private file).
#   ./scripts/vps-inventory.sh > ~/salesos-inventory-$(date +%F).txt
# Each section tolerates missing tools / missing privileges.
set -u
sec() { printf '\n===== %s =====\n' "$1"; }
run() { "$@" 2>&1 || echo "(unavailable: $*)"; }
sec "host";            run uname -a; run uptime; run df -h; run free -m; run nproc
sec "listening ports"; (ss -tulpn 2>/dev/null || netstat -tulpn 2>/dev/null || echo "(unavailable)")
sec "docker containers"; command -v docker >/dev/null && run docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' || echo "(no docker)"
sec "docker networks/volumes"; command -v docker >/dev/null && { run docker network ls; run docker volume ls; } || true
sec "pm2";             command -v pm2 >/dev/null && run pm2 list || echo "(no pm2)"
sec "systemd running services"; command -v systemctl >/dev/null && run systemctl list-units --type=service --state=running --no-pager || echo "(no systemd)"
sec "nginx (read-only dump)"; if command -v nginx >/dev/null; then run nginx -v; (nginx -T 2>&1 | grep -E 'server_name|listen|proxy_pass|ssl_certificate |include ' | sort -u) || true; else echo "(no nginx)"; fi
sec "TLS certs (expiry)"; for c in /etc/letsencrypt/live/*/cert.pem; do [ -f "$c" ] && { echo "$c"; openssl x509 -enddate -noout -in "$c" 2>&1; }; done 2>/dev/null || true
sec "cron";            (crontab -l 2>&1 || true); ls /etc/cron.d 2>&1 || true
sec "databases (names only)"; command -v psql >/dev/null && (psql -Atc 'select datname from pg_database' 2>&1 || echo "(psql: set PG* env)") || echo "(no psql client)"
sec "SalesOS port check"
for p in "${@:-3100 4100 4200 5533 6391 9100}"; do
  for q in $p; do if ss -tln 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${q}$"; then echo "port $q: IN USE"; else echo "port $q: free"; fi; done
done
echo; echo "Done. Nothing was modified. Record results in docs/deployment-inventory.md (private)."
