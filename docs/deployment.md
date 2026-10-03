# Deployment

How to run Hexmark so that it is reachable the way you want, sees the real
address of every visitor, and keeps its keys safe. The installation itself
(copy `.env.example` to `.env`, `docker compose up -d`) is described in the
comments of `compose.yaml` and `.env.example`.

Hexmark runs as three containers:

| Service | Port in the container | Published by default | Purpose |
|---|---|---|---|
| `web` | 3000 | `WEB_PORT` (3000) | Browser UI (Next.js) |
| `server` | 3001 | `SERVER_PORT` (3001) | HTTP API and MCP server |
| `db` | 5432 | no | PostgreSQL |

## Instance keys

Two keys in `.env` are required. Both compose files refuse to start without
them; a server started without them (e.g. `pnpm dev`) runs, but the setup
wizard's connection check reports "Server configuration", and creating the
first admin and signing in are refused until both are valid.

| Variable | Used by | Purpose |
|---|---|---|
| `INTERNAL_API_KEY` | `server`, `web` | Lets the API server trust the browser addresses the web server forwards (see [Client addresses](#client-addresses)) |
| `ENCRYPTION_KEY` | `server` | Encrypts secrets stored in the database, e.g. two-factor secrets (AES-256-GCM) |
| `ENCRYPTION_KEY_PREVIOUS` | `server`, optional | Decrypt only: the key `ENCRYPTION_KEY` replaced |

Each key is 32 random bytes in base64url, exactly 43 characters. Generate
one per variable:

```sh
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
# or
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

The values are never logged; the logs name only the variables that are
missing or invalid.

- **`ENCRYPTION_KEY` must not be lost.** Data encrypted with it cannot be read
  without it: users would have to set up their second factor again. Back it
  up together with the database (see [Backups](#backups)).
- **Replacing `ENCRYPTION_KEY`:** move the current value to
  `ENCRYPTION_KEY_PREVIOUS`, set a new `ENCRYPTION_KEY`, restart. New data is
  encrypted with the new key, existing data stays readable with the previous
  one. Remove `ENCRYPTION_KEY_PREVIOUS` only once nothing encrypted with it is
  left.
- **Replacing `INTERNAL_API_KEY` is harmless:** set a new value and run
  `docker compose up -d`, which recreates both containers with it. Nothing
  stored depends on it.

## Security keys and passkeys (`PUBLIC_ORIGIN`)

Accounts can protect their sign-in with a second factor: an authenticator app
(always available) or security keys and passkeys (WebAuthn, optional).
Security keys are offered only when `PUBLIC_ORIGIN` in `.env` names the
address users open Hexmark at, as an origin without a path:

```sh
PUBLIC_ORIGIN=https://wiki.example.com
```

- Browsers allow WebAuthn only in a secure context: `https://`, or
  `http://localhost` for local use. Other `http://` addresses and IP
  addresses are refused; the server logs the problem at start-up and does not
  offer security keys.
- Registered keys are bound to the host name. Changing it later makes them
  stop working; users then sign in with their authenticator app or a recovery
  code and register their keys again.
- Without `PUBLIC_ORIGIN`, the sign-in and account pages do not offer
  security keys (`GET /api/instance/v1/capabilities` answers
  `{ "webauthn": false }`). Keys registered earlier stay listed and can be
  removed.
- Open Hexmark at exactly that address. A page opened under another address
  that is not a secure context (e.g. `http://192.168.1.10:3000`) hides the
  security key buttons and says why; the authenticator app and recovery
  codes still work there.

## Client addresses

Sign-in and setup limit failed attempts per visitor address (and in total).
For that, the API server must know each browser's address, but browsers
never talk to it directly: the web server calls it on their behalf.

- The web server takes the address of the connection a request arrived on.
  If that connection comes from a **trusted proxy** (`TRUSTED_PROXIES`), it
  reads the client address from the proxy's `X-Forwarded-For` header instead,
  walking it from the right and skipping trusted proxies; optionally from a
  single header the proxy sets (`TRUSTED_PROXY_HEADER`). Headers from anyone
  else are ignored, so a visitor cannot pretend to be someone else.
- The web server sends that address to the API server together with
  `INTERNAL_API_KEY`. The API server believes the address only with the right
  key; for every other caller it uses the connection's own address.
- `X-Forwarded-Proto: https` from a trusted proxy marks the session cookie as
  `Secure`. From anyone else the header is ignored.

| Variable (web) | Default | Meaning |
|---|---|---|
| `TRUSTED_PROXIES` | empty | Comma-separated IPv4/IPv6 addresses and CIDR ranges of the reverse proxies directly in front of the web container, e.g. `172.30.0.0/24, fd00::/8` |
| `TRUSTED_PROXY_HEADER` | empty | One header a trusted proxy sets to the client address, e.g. `CF-Connecting-IP` |

Invalid entries are logged at start-up and skipped. With the defaults, the
connection's address is used and no forwarding header is believed.

## Scenarios

### Home network, direct

Browsers on the local network open `http://<server address>:3000`.

- Leave `TRUSTED_PROXIES` empty.
- Do not forward ports 3000 or 3001 on your router.
- On Linux, Docker keeps the visitors' addresses. Docker Desktop (macOS,
  Windows) shows every visitor as one internal gateway address, so the
  per-address limits act as one shared limit there.
- Security keys and passkeys need HTTPS (browsers allow WebAuthn only on
  `https://` or `http://localhost`) and `PUBLIC_ORIGIN` (see
  [Security keys and passkeys](#security-keys-and-passkeys-public_origin)).
  For them, put a reverse proxy with a
  certificate in front, as below, e.g. Caddy with `tls internal` (then install
  Caddy's root certificate on your devices) or a certificate for a domain of
  yours obtained through a DNS challenge.

### VPN

Same as the home network: visitors arrive with their VPN addresses. If the
VPN gateway translates addresses (NAT), all VPN users share one address. For
security keys and passkeys use HTTPS as above.

### Public, behind a reverse proxy

Only the reverse proxy is reachable from the internet, on ports 80 and 443;
HTTPS is strongly recommended and required for security keys and passkeys.

1. Bind Hexmark's published ports to the host itself in `.env`, or remove
   them, so they are not reachable from outside:

   ```sh
   WEB_PORT=127.0.0.1:3000
   SERVER_PORT=127.0.0.1:3001
   ```

2. Give the Compose network a fixed subnet, so the proxy's address is known,
   and trust that subnet:

   ```sh
   TRUSTED_PROXIES=172.30.0.0/24
   ```

3. Expose the API server (port 3001) only if AI agents connect from outside
   your network, and then only through the proxy with HTTPS, on its own host
   name. The API server takes the address of such clients from the
   connection, i.e. the proxy's address for all of them.

#### Caddy

`compose.override.yaml` next to `compose.yaml` (Compose reads it
automatically):

```yaml
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - web

networks:
  default:
    ipam:
      config:
        - subnet: 172.30.0.0/24

volumes:
  caddy-data:
  caddy-config:
```

`Caddyfile`:

```
wiki.example.com {
	reverse_proxy web:3000
}

# Only if agents connect from outside:
# api.example.com {
# 	reverse_proxy server:3001
# }
```

Caddy obtains the certificate itself and sets `X-Forwarded-For` and
`X-Forwarded-Proto`.

#### Traefik

`compose.override.yaml`:

```yaml
services:
  traefik:
    image: traefik:v3
    restart: unless-stopped
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --entrypoints.web.address=:80
      - --entrypoints.web.http.redirections.entrypoint.to=websecure
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.le.acme.tlschallenge=true
      - --certificatesresolvers.le.acme.email=admin@example.com
      - --certificatesresolvers.le.acme.storage=/letsencrypt/acme.json
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - letsencrypt:/letsencrypt

  web:
    labels:
      - traefik.enable=true
      - traefik.http.routers.hexmark.rule=Host(`wiki.example.com`)
      - traefik.http.routers.hexmark.entrypoints=websecure
      - traefik.http.routers.hexmark.tls.certresolver=le
      - traefik.http.services.hexmark.loadbalancer.server.port=3000

networks:
  default:
    ipam:
      config:
        - subnet: 172.30.0.0/24

volumes:
  letsencrypt:
```

#### A proxy on the host

A reverse proxy installed on the host itself (not in Docker) reaches the web
container through Docker's gateway, e.g. `172.30.0.1` with the subnet above.
Trust that address: `TRUSTED_PROXIES=172.30.0.1`.

### Cloudflare

Behind Cloudflare, the address Cloudflare saw is in `CF-Connecting-IP`:

```sh
TRUSTED_PROXIES=172.30.0.0/24
TRUSTED_PROXY_HEADER=CF-Connecting-IP
```

The header is read only from trusted proxies, but your proxy passes it on
from whoever connects to it. Use this only if your server is reachable
exclusively through Cloudflare (a Cloudflare Tunnel, or a firewall that
admits only Cloudflare's address ranges); otherwise anyone could connect
directly and send any address. Without the header setting, the walk through
`X-Forwarded-For` stops at the Cloudflare address, unless you list
Cloudflare's ranges in `TRUSTED_PROXIES` too.

## Backups

Back up both together; one without the other cannot restore encrypted data:

- **The database volume** (`db-data`), e.g. with
  `docker compose exec db pg_dump -U hexmark hexmark > hexmark.sql`.
- **`.env`**, in particular `ENCRYPTION_KEY` (and `ENCRYPTION_KEY_PREVIOUS`
  while it is set). Keep the copy as protected as the database dump: it
  contains the database password and the keys.

## Troubleshooting

Messages in `docker compose logs`:

- `Server configuration incomplete: INTERNAL_API_KEY is missing …` (server):
  set the named variables as described in [Instance keys](#instance-keys).
- `INTERNAL_API_KEY is missing: browser addresses are not forwarded …` (web):
  the web container has no valid key; the API server then counts all
  visitors as one address.
- `Ignored a forwarded client address with a wrong internal key` (server):
  web and server have different `INTERNAL_API_KEY` values.
- `TRUSTED_PROXIES: ignored invalid entries: …` (web): fix the listed entries.
- `Trusted proxies: …` (web): the entries in effect.
