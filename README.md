# n8n-ops

An operations console for teams that run many self-hosted n8n instances: failure monitoring with low-noise alerts, an MCP and REST interface for AI agents, encrypted workflow and credential backups, and tools for consolidating instances.

## Status

**Planning. Nothing is runnable yet.** The repository currently contains only documentation and one read-only discovery script.

- Product requirements: [docs/requirements.md](docs/requirements.md)
- What exists, what is planned, and the order of work: [docs/project-foundation.md](docs/project-foundation.md)

## What is here today

- `scripts/discover.sh`: a read-only script that inventories an n8n Docker host (containers, images, n8n-related environment with secrets masked, mounts, networks, disk usage) and writes one report file. It changes nothing on the host. Review the report before sharing it; hostnames and URLs are included.

## License

[MIT](LICENSE)
