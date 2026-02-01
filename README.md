# CC-Flux (Multimodal Coding Agent Proxy)

**CC-Flux** is a powerful, lightweight proxy layer designed to decouple the **Claude Code CLI** from its hardcoded Anthropic API dependency. It allows developers to use any OpenAI-compatible API (like DeepSeek, GPT-4) or local models (via Ollama) while maintaining the agentic coding experience.

---

## 🌟 Key Features

- **🚀 Seamless Model Swapping**: Hot-swap between cloud providers (OpenAI, DeepSeek) and local backends (Ollama) without restarting your CLI session.
- **🔄 Protocol Translation**: Automatically converts Anthropic's XML-based `tool_use` format into OpenAI's JSON `function_calling` format.
- **🎮 TUI Controller**: A beautiful Go-based Terminal User Interface (Bubble Tea) to monitor and control the proxy in real-time.
- **🛠️ Local Model Optimization**: Specialized prompt injection for Ollama/local models to ensure reliable tool-calling behavior.
- **⚡ High-Performance Streaming**: Built on Fastify with low-latency Server-Sent Events (SSE) relaying.

---

## 🏗️ System Architecture

1.  **Flux Proxy (Node.js)**: The heart of the system. It handles traffic, performs protocol transformation, and exposes an Admin API for the TUI.
2.  **TUI Controller (Go)**: A standalone control tower used to switch active models and monitor connectivity.
3.  **Config Engine**: Manages API keys and model presets via `providers.json`.

---

## 🛠️ Getting Started

### 1. Prerequisites
- **Node.js**: v18.0 or higher
- **Go**: v1.20 or higher (for building the TUI)
- **Claude Code CLI**: Installed and ready

### 2. Installation

Clone the repository and install dependencies:

```bash
# Install Proxy dependencies
cd proxy
npm install

# Build the TUI Controller
cd ../tui
go build -o cc-flux.exe .
```

## Configuration

- **Proxy**: Edit `proxy/.env` for default startup settings.
    - **Port**: Change `PORT=8080`.
    - **IPC (Optional)**: Set `SOCKET_PATH` for higher performance.
        - Windows: `\\.\pipe\cc-flux`
        - Linux/Mac: `/tmp/cc-flux.sock`
- **TUI**: Edit `tui/providers.json` to add/remove model presets.

---

## 🚀 Usage

### Step 1: Start CC-Flux

**Option A: Quick Start**

*   **Windows**:
    ```cmd
    start_cc_flux.bat
    ```
*   **Linux / macOS**:
    ```bash
    chmod +x start_cc_flux.sh
    ./start_cc_flux.sh
    ```

**Option B: Manual Start**

1.  Start the Proxy:
    ```bash
    cd proxy
    npm start
    ```
    (Default port: 8080)

2.  Start the TUI (in a new terminal):
    *   **Windows**:
        ```bash
        cd tui
        ./cc-flux.exe
        ```
    *   **Linux / macOS**:
        ```bash
        cd tui
        go build -o cc-flux .
        ./cc-flux
        ```

### Step 2: Connect Claude Code
Point Claude Code to the proxy. Depending on the Claude Code version/configuration, you typically set the base URL:
```bash
export CLAUDE_BASE_URL=http://localhost:8080/v1
claude
```

---

## 🗺️ Implementation Roadmap

- [x] **Phase 1 (MVP)**: Core Node.js proxy and Anthropic-to-OpenAI mapping.
- [x] **Phase 2 (TUI)**: Go-based interactive model selector.
- [x] **Phase 3 (Optimization)**: System prompt injection for improved local model (Ollama) support.
- [ ] **Phase 4 (Advanced)**: Support for thinking/reasoning tokens (DeepSeek R1) and conversation history compression.

---

## 🛡️ Security
All API keys are stored locally on your machine. The proxy acts as a pass-through and does not log your sensitive keys or conversation content to any external service.

---

## 📄 License
MIT
