#!/bin/sh
set -eu

cert=/etc/nginx/certs/localhost.pem
key=/etc/nginx/certs/localhost-key.pem
renewal_days="${LOCAL_CERT_RENEWAL_DAYS:-6}"

renew_if_due() {
    if [ -e "$cert" ] || [ -e "$key" ]; then
        if [ ! -s "$cert" ] || [ ! -s "$key" ]; then
            echo "El volumen contiene un certificado incompleto." >&2
            return 2
        fi
        now=$(date +%s)
        modified=$(stat -c %Y "$cert")
        if [ "$((now - modified))" -lt "$((renewal_days * 86400))" ]; then
            return 1
        fi
    fi

    cert_tmp="${cert}.tmp.$$"
    key_tmp="${key}.tmp.$$"
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$key_tmp" \
        -out "$cert_tmp" \
        -subj "/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1" \
        >/dev/null 2>&1
    chmod 644 "$cert_tmp"
    chmod 600 "$key_tmp"
    mv -f "$key_tmp" "$key"
    mv -f "$cert_tmp" "$cert"
    echo "Certificado HTTPS de Nginx renovado."
    return 0
}

renew_if_due || status=$?
if [ "${status:-0}" -gt 1 ]; then
    exit "$status"
fi

(
    while true; do
        sleep 3600
        if renew_if_due; then
            nginx -s reload
        else
            status=$?
            if [ "$status" -gt 1 ]; then
                exit "$status"
            fi
        fi
    done
) &

exec /docker-entrypoint.sh "$@"
