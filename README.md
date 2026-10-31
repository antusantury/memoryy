# Memoryy

**Memoryy is a local-first learning archive with an AI librarian.** It stores conversations, notes, files, topics, and decisions in one searchable workspace so your learning context does not disappear when an AI chat reaches its context limit.

> **Status:** early desktop MVP. User data is stored locally on the user's computer.

## Features

- Library for conversations, notes, and imported materials
- Import for text, Markdown, HTML, source code, images, video, PDF, and other files
- AI-assisted material processing through GitHub Copilot CLI, OpenAI Codex CLI, Ollama, or a compatible API
- AI chat over your own library
- Chat commands such as `collect notes about SQL` with a clickable link to the saved result
- Separate saved notes and reusable context for another AI session
- Interactive learning map with search, filters, zoom, and relationships
- JSON and Markdown library export
- English and Russian interface
- Local SQLite storage with no mandatory cloud account

## Requirements

- Node.js 22 or newer
- macOS or Windows for the desktop build

## Run from source

```bash
npm install
npm start
```

Open <http://127.0.0.1:4173>.

To run the Electron desktop shell:

```bash
npm run desktop:dev
```

## AI providers

Memoryy does not scrape browser cookies, browser chats, VS Code account data, or provider tokens. Providers are connected through their official CLI tools or through an API endpoint explicitly configured by the user.

### GitHub Copilot CLI

Install and authenticate Copilot CLI yourself, then select it in Memoryy's settings:

```text
copilot
/login
```

### OpenAI Codex CLI

Install Codex CLI and use the browser login button in the settings. Memoryy only starts the official `codex login` command; it does not read or store Codex tokens.

### Ollama and compatible APIs

You can connect a local Ollama model or an OpenAI-compatible endpoint. Any API key is entered locally in the application settings and is never part of the source code or repository.

## Installers

The current installers are built locally in `release/`:

- **macOS:** `Memoryy-0.1.0.dmg`
- **Windows:** `Memoryy Setup 0.1.0.exe`

The Windows installer supports English and Russian selection. The selected language is used on the first application launch. On macOS, the language can be selected in the application settings.

These installers are unsigned in this release. macOS Gatekeeper or Windows SmartScreen may show a warning until Apple Developer ID and Windows code-signing certificates are configured.

Build the installers locally with:

```bash
npm run dist
```

For a verified Windows build, run the build on Windows. For public distribution, configure code signing before publishing.

## Data and backups

In development, data is stored in `data/memoryy.sqlite`. In the installed desktop version, Electron stores data in the application's system user-data directory. Close Memoryy before making a backup, then copy the corresponding `data` directory.

Original uploaded files are stored locally. The maximum size of one file is 20 MB.

## Project structure

```text
electron-main.js   Electron shell and splash screen
server.js          Local HTTP server, SQLite, and AI providers
public/            Browser interface
assets/            Application icons
build/             NSIS installer configuration
```

## License

Memoryy is distributed under the MIT License. See [`LICENSE`](LICENSE).



