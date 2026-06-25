# Weysabi Webapp

Static Next.js documentation and the self-hosted server administration interface.

## Admin connection

Set the server URL at build time if desired:

```text
NEXT_PUBLIC_SABI_ADMIN_URL=http://localhost:3000
```

Do not place an admin API key in a `NEXT_PUBLIC_*` variable. Public variables
are compiled into the browser bundle.

The direct-connect admin page keeps the entered `SABI_ADMIN_API_KEY` in memory
only for the current browser session. It does not persist the key in
`localStorage`. Direct connection is intended for local development or trusted
self-hosted networks.

For an internet-facing deployment, proxy admin requests through a same-origin
backend that reads `SABI_ADMIN_API_KEY` from a server-only environment variable
and authenticates the dashboard user with a normal application session.
