这份技术方案设计文档参考了 Google 内部典型的 **Design Doc (RFC)** 标准进行编写，旨在通过规范化的结构确保项目的技术可行性与扩展性。

# ---

**Design Doc: CC-Flux (Multimodal Coding Agent Proxy)**

**Author:** \[Your Name/Brainstormer\]

**Status:** Draft / In-Review

**Last Updated:** 2026-02-01

## **1\. Objective (目标)**

### **1.1 Context**

Claude Code CLI 是一个强大的 Agentic 编程工具，但其默认绑定 Anthropic API。开发者在实际工程中常面临高昂的 Token 成本，或在某些隐私敏感场景下需要使用本地大模型（如 DeepSeek-R1, Llama 3）。

### **1.2 Goals**

* **模型解耦**：允许 Claude Code 在不修改源码的前提下切换后端模型。  
* **多端支持**：支持主流云端 API（OpenAI, DeepSeek）及本地 Provider（Ollama）。  
* **低延迟切换**：提供 TUI 交互界面，支持在不重启 CLI 会话的情况下热切换模型。  
* **协议适配**：全自动转换 Anthropic 专有的 Tool Use (XML) 与 OpenAI 的 Function Calling (JSON) 协议。

## ---

**2\. System Architecture (系统架构)**

### **2.1 High-Level Diagram**

系统由三个核心组件构成：

1. **TUI Controller (Go)**：用户交互层，负责模型选择与配置管理。  
2. **Flux Proxy (Node.js)**：流量中转层，负责协议双向转换与流式转发。  
3. **Config Engine**：持久化存储 API Keys、本地 Endpoint 及模型预设。

### **2.2 Data Flow**

1. **Claude Code** 发起请求至 localhost:8080 (Flux Proxy)。  
2. **Proxy** 检查 **TUI** 当前激活的模型：  
   * 若是 Anthropic 模型 $\\rightarrow$ 透传 Headers 与 Body。  
   * 若是非 Anthropic 模型 $\\rightarrow$ 调用 ProtocolAdapter 进行 Body 重组。  
3. **Target Provider** 返回结果。  
4. **Proxy** 将结果重新封装为 anthropic-compatible 流，回传至 CLI。

## ---

**3\. Detailed Design (详细设计)**

### **3.1 TUI Controller (The "Control Tower")**

采用 **Go \+ Bubble Tea**。

* **State Management**：维护一个简单的内存状态机，记录 ActiveProviderID。  
* **Communication**：通过内建的 HTTP Admin API 或 Unix Domain Socket 通知 Proxy 切换后端。

### **3.2 Protocol Adapter (核心难点)**

由于 Claude Code 极度依赖其特定的 Prompt 结构（包含大量 XML 标签），适配器需执行以下转换逻辑：

| 特性 | Anthropic 格式 (Input) | 目标模型格式 (Output) |
| :---- | :---- | :---- |
| **Messages** | role: user, content: \[...\] | 扁平化为 content: string |
| **Tool Use** | \<tool\_code\>...\</tool\_code\> | 映射为 OpenAI tool\_calls 对象 |
| **Thinking** | 内置 thinking 字段 | 映射为 DeepSeek reasoning\_content 或 System Prompt 约束 |

### **3.3 Proxy Server (The "Hot-Swapper")**

使用 **Fastify** 实现，利用其高性能的 stream 处理能力：

* **Stream Parsing**：针对 Server-Sent Events (SSE) 进行拦截，确保在转换协议时不破坏流式体验。  
* **Injecting System Prompts**：针对本地模型（Ollama），自动注入“工具调用规范指令”，防止模型输出格式失控。

## ---

**4\. Scalability & Security (扩展性与安全性)**

* **API Key Isolation**：所有敏感密钥仅保存在本地环境变量或加密的 .cc-flux.json 中，Proxy 动态注入，不向前端暴露。  
* **Local-First**：优先支持 Ollama 的 Unix Socket 连接，减少本地回环网络的开销。

## ---

**5\. Implementation Plan (实施计划)**

1. **Phase 1 (MVP)**：开发 Node.js 代理层，实现 Claude 3.5 到 DeepSeek API 的单向适配。  
2. **Phase 2 (TUI)**：构建 Go 界面，实现通过终端 UI 实时修改代理层路由。  
3. **Phase 3 (Local Optimized)**：针对 Ollama 进行专项优化，加入 Tool Use 失败后的自动重试机制（Self-Correction）。

## ---

**6\. Alternatives Considered (备选方案讨论)**

* **Modify Claude Code Source**：虽然最直接，但会导致无法享受官方后续的版本更新。  
* **Static Proxy (LiteLLM)**：LiteLLM 功能强大但体积庞大，难以针对 Claude Code 特有的 XML Tooling 做深度定制优化。

---

**Brainstormer 的后续行动建议：**

这份文档为你的项目打下了坚实的基础。你希望我接下来为你生成这个项目中 **ProtocolAdapter 协议转换器的核心算法逻辑**，还是先写一个 **Go Bubble Tea 的基础 UI 框架代码**？