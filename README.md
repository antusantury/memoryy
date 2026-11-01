# Memoryy ![Status](https://img.shields.io/badge/status-MVP-orange) ![License](https://img.shields.io/badge/license-MIT-blue) ![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)


**Your local-first learning archive with an AI librarian.**

Memoryy stores your conversations, notes, files, topics, and decisions in one searchable workspace. It is designed to solve a simple but growing problem: your learning context should not disappear when an AI chat reaches its context limit.





<p align="center">
  <img src="https://github.com/user-attachments/assets/031995d3-4183-4f6f-b86f-0fdc45667b41" alt="Overview" width="45%" />
  &nbsp;&nbsp;&nbsp; <!-- Это отступ между картинками -->
  <img src="https://github.com/user-attachments/assets/a334a2b7-40d2-4fcf-9073-621fde98443d" alt="AI Chat" width="45%" />
</p>
<p align="center">
  <i>Left: Learning Overview &nbsp;|&nbsp; Right: AI Chat</i>
</p>


## Table of Contents
- [Why Memoryy?](#why-memoryy)
- [Key Features](#key-features)
- [How It Works](#how-it-works)
- [Requirements](#requirements)
- [AI Providers](#ai-providers)
- [Data, Privacy & Backups](#data-privacy--backups)
- [Project Structure](#project-structure)
- [License](#license)



## Why Memoryy?

Modern AI chats are powerful, but they are also ephemeral. Once a conversation scrolls out of the context window, the knowledge you built is effectively lost. You are forced to re-explain your project, re-paste your notes, and re-discover insights you already had.

Memoryy was built to be the long-term memory layer for your AI-assisted learning. Instead of locking your knowledge inside a single chat session, it extracts topics, saves important notes, and builds a connected map of your understanding—all stored locally on your machine.

## Key Features

- **Unified Library**: Store conversations, notes, and imported materials in a single, searchable place.
- **Broad Import Support**: Ingest text, Markdown, HTML, source code, images, video, PDF, and other files (up to 20 MB per file).
- **AI Librarian**: Chat with an AI that has access to your entire library, not just the current session.
- **Smart Chat Commands**: Use commands like `collect notes about SQL` to instantly save and link results.
- **Interactive Knowledge Map**: Visualize how your topics and notes connect with search, filters, and zoom.
- **Multi-Provider AI**: Connect through GitHub Copilot CLI, OpenAI Codex CLI, a local Ollama model, or any OpenAI-compatible API.
- **Local-First & Private**: All data is stored in a local SQLite database. No mandatory cloud account is required.
- **Export Anytime**: Export your library in JSON or Markdown format.
- **Bilingual Interface**: Fully localized in English and Russian.

## How It Works

Memoryy runs a local HTTP server that serves the browser interface and manages your SQLite database. When you use the AI features, the application communicates with your chosen AI provider (Copilot, Codex, Ollama, or a compatible API) using their official CLI tools or a configured endpoint.

Your notes, conversations, and imported files are processed and stored locally. The AI librarian reads from this local store to provide context-aware answers, ensuring your data never leaves your machine unless you explicitly send it to an external AI API.

## Requirements

- **Node.js**: 22 or newer.
- **Operating System**: macOS or Windows for the desktop build.



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

## AI Providers

> Memoryy does not scrape browser cookies, chats, VS Code account data, or provider tokens. You connect providers through their official tools or an explicitly configured API endpoint.

To connect an AI provider, go to **Settings** in the app:

*   **GitHub Copilot CLI**
    Install and authenticate the CLI yourself, then select it in Memoryy's settings. Run `copilot /login` in your terminal to authenticate.
*   **OpenAI Codex CLI**
    Use the browser login button in the settings. Memoryy only initiates the official `codex login` command; it does not read or store your tokens.
*   **Ollama & Compatible APIs**
    Connect a local Ollama model or any OpenAI-compatible endpoint. Any required API key is entered locally in the app settings and is never part of the source code or repository.

## Data, Privacy & Backups

> Your privacy is a core design principle. Memoryy is designed to be fully functional without ever sending your personal data to our servers.

*   **Local Storage**
    In development, your data lives in `data/memoryy.sqlite`. In the installed desktop app, Electron stores data in the application's system user-data directory.
*   **No Cloud Requirement**
    You do not need to create an account, sync to a cloud service, or connect to the internet to use your local library.
*   **Backups & Files**
    To back up your data, close Memoryy completely and copy the corresponding data directory. Original uploaded files are stored locally and are limited to a maximum size of 20 MB per file.

    
## Project structure

```text
│
├── src/
│   ├── electron-main.js  # Electron shell and splash screen
│   ├── server.js         # Local HTTP server, SQLite, and AI providers
│   └── renderer/         # Browser interface, styles, and localization
├── public/              # Browser interface
├── assets/              # Application icons
└── build/  
```


## License

Memoryy is distributed under the MIT License. See [`LICENSE`](LICENSE).


