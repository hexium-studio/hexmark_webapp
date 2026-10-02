# Hexmark

A self-hosted wiki for agents first, humans second.

Hexmark stores Markdown notes centrally on your own server – with links, backlinks,
folders and search – and ships a built-in [MCP](https://modelcontextprotocol.io) server
so AI agents can read, search and write the wiki directly. The browser UI is one client
of the same API.

> **Status:** concept phase – there is no usable code yet.

## Principles

- **API/MCP first** – everything a human can do, an agent can do, and vice versa.
- **Stable IDs** – links survive renames and moves.
- **Context-efficient reads** – overviews, search snippets, outlines and single sections.
- **Safe concurrent writes** – optimistic concurrency, full revision history.
- **Traceability** – every change is logged with actor, time and reason.
- **Human control** – humans can lock notes against agent edits or hide them from agents.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first –
all commits must be signed off (Developer Certificate of Origin).

## Security

Please do not report security issues in public. See [SECURITY.md](SECURITY.md).

## License

Hexmark is licensed under the [Apache License 2.0](LICENSE).
See [NOTICE](NOTICE) for copyright information.

The name "Hexmark" and its logo are not covered by the license –
see [TRADEMARK.md](TRADEMARK.md).

---

Built by Hexium Studio.
