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

### 3. Configuration

1.  **Proxy Env**: Create or edit `proxy/.env`:
    ```env
    PORT=8080
    TARGET_API_KEY=your_default_api_key
    ```
2.  **Providers**: Customize your model list in `tui/providers.json`.

---

## 🚀 Usage

### Step 1: Start CC-Flux
The easiest way is to use the provided Windows batch script:
```cmd
start_cc_flux.bat
```
*Or manually:*
1.  Terminal 1: `cd proxy && npm start`
2.  Terminal 2: `cd tui && ./cc-flux.exe`

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
