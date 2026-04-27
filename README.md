# CC-Flux (Multimodal Coding Agent Proxy)

**CC-Flux** is a powerful, lightweight proxy layer designed to decouple the **Claude Code CLI** from its hardcoded Anthropic API dependency. It allows developers to use any OpenAI-compatible API (like DeepSeek, GPT-4) or local models (via Ollama) while maintaining the agentic coding experience.

---

## 🌟 Key Features

- **🚀 Seamless Model Swapping**: Hot-swap between cloud providers (OpenAI, DeepSeek) and local backends (Ollama) without restarting your CLI session.
- **🔄 Protocol Translation**: Automatically converts Anthropic's XML-based `tool_use` format into OpenAI's JSON `function_calling` format.
- **🎮 TUI Controller**: A beautiful Go-based Terminal User Interface (Bubble Tea) to monitor and control the proxy in real-time.
- **🛠️ Local Model Optimization**: Specialized prompt injection for Ollama/local models to ensure reliable tool-calling behavior.
- **🧠 Reasoning Visibility**: Streams DeepSeek R1 `reasoning_content` as readable `<thinking>` text before the final answer.
- **🗜️ History Compression**: Optional deterministic local compression trims older turns while preserving recent tool-use context.
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

CC-Flux is an LLM Gateway for Claude Code. Point Claude Code at the local gateway:

```bash
export ANTHROPIC_BASE_URL=http://localhost:8080
claude
```

Some Claude Code versions also recognize `CLAUDE_BASE_URL`; use `/status` inside Claude Code to verify which base URL is active.

CC-Flux does not intercept encrypted Claude Code traffic through `HTTPS_PROXY`. A plain HTTPS proxy can only tunnel encrypted traffic and cannot translate Anthropic request bodies to other providers without local TLS inspection.

---

## 📖 Common Operations

### 1. Hot-Switching With CLI

List profiles:

```bash
cc-flux profiles
```

Show the active runtime config:

```bash
cc-flux current
```

Switch to a profile:

```bash
cc-flux switch deepseek-reasoner
```

The switch applies to the next Claude Code model request. Active streaming responses continue with the provider they started with.

### 2. Reasoning Output

DeepSeek R1 streams `reasoning_content` separately from final answer text. CC-Flux surfaces that reasoning as ordinary Anthropic-compatible text:

```text
<thinking>
reasoning tokens from the provider
</thinking>

final answer
```

CC-Flux does not emit Anthropic-native thinking blocks because those require Anthropic signature deltas that third-party providers cannot generate.

### 3. History Compression

Compression is disabled by default. Enable it when long Claude Code sessions start carrying too much old context:

```bash
export CC_FLUX_COMPRESSION_ENABLED=true
export CC_FLUX_COMPRESSION_MAX_MESSAGES=40
export CC_FLUX_COMPRESSION_KEEP_RECENT=16
```

Profiles can override compression:

```json
{
  "id": "deepseek-reasoner",
  "name": "DeepSeek - Reasoner (R1)",
  "provider": "deepseek",
  "baseUrl": "https://api.deepseek.com",
  "apiKey": "",
  "model": "deepseek-reasoner",
  "compression": {
    "enabled": true,
    "maxMessages": 48,
    "keepRecent": 18
  }
}
```

CLI controls:

```bash
cc-flux compression
cc-flux compression on
cc-flux compression set --max-messages 32 --keep-recent 12
cc-flux compression off
```

Compression is deterministic and local. It keeps leading system messages, preserves recent messages, keeps tool-call/tool-result groups together, and summarizes older plain turns into one synthetic context message. It does not persist conversation text to disk.

### 4. Switching Models

1.  Ensure the **Proxy** is running.
2.  Open the **TUI Controller** (`cc-flux`).
3.  Use the **Arrow Keys (Up/Down)** or **j/k** to navigate the list.
4.  Press **Enter** to select a model. 
    - The Proxy will instantly switch its backend.
    - Status will update to `Successfully switched to [Model Name]`.
5.  Press **c** to toggle compression for future requests.
6.  Press **q** or **Ctrl+C** to exit the TUI (the Proxy will continue running in the background).

### 5. Adding New Model Providers

1.  Open `tui/providers.json`.
2.  Add a new JSON object to the array:
    ```json
    {
      "id": "my-custom-model",
      "name": "My Custom Model",
      "provider": "openai",
      "baseUrl": "https://api.example.com/v1",
      "apiKey": "your-api-key",
      "model": "model-name-123"
    }
    ```
3.  Restart the TUI to see the new entry.

CC-Flux stores only the active profile id in `~/.cc-flux/state.json` by default. Provider definitions and API keys remain in `providers.json` or your environment. Override paths with:

```bash
export CC_FLUX_PROVIDERS_PATH=/path/to/providers.json
export CC_FLUX_STATE_PATH=/path/to/state.json
```

### 6. Tuning for Local Models (Ollama)

- **Retry Mode**: If your local model often outputs invalid tool-call JSON, ensure `RETRY_ENABLED=true` is set in `proxy/.env`.
- **System Prompts**: The proxy automatically injects formatting instructions for `ollama` providers to improve reliability.

---

## 🗺️ Implementation Roadmap

- [x] **Phase 1 (MVP)**: Core Node.js proxy and Anthropic-to-OpenAI mapping.
- [x] **Phase 2 (TUI)**: Go-based interactive model selector.
- [x] **Phase 3 (Optimization)**: System prompt injection for improved local model (Ollama) support.
- [x] **Phase 4 (Advanced)**: Support for thinking/reasoning tokens (DeepSeek R1) and conversation history compression.

---

## 🛡️ Security
All API keys are stored locally on your machine. The proxy acts as a pass-through and does not log your sensitive keys or conversation content to any external service.

---

## 📄 License
MIT
