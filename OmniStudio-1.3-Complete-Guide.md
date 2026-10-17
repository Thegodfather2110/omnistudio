# OmniStudio 1.3 — Complete Setup, Features & Workflow Guide

> **Scope:** This guide is written against the supplied `omnistudio-v1.3` source ZIP and its bundled README. It documents the features and setup paths present in that package, not every feature that may exist in other OmniStudio projects or later releases.
>
> **Important compatibility note:** The project's own README says it was tested with mock OmniRoute/MCP services on Linux, but **not** tested on Windows, a live OmniRoute instance, or the real third-party connector servers. Follow the Windows steps below, then validate each integration in your environment.

## Contents

1. [What OmniStudio is](#1-what-omnistudio-is)
2. [Requirements and installation](#2-requirements-and-installation)
3. [Connect OmniStudio to OmniRoute](#3-connect-omnistudio-to-omniroute)
4. [Workspace and data-folder map](#4-workspace-and-data-folder-map)
5. [Feature-by-feature guide](#5-feature-by-feature-guide)
6. [Skills and Markdown knowledge files](#6-skills-and-markdown-knowledge-files)
7. [MCP connectors: concepts and setup](#7-mcp-connectors-concepts-and-setup)
8. [Connector recipes](#8-connector-recipes)
9. [REA — Reverse Engineer Anything](#9-rea--reverse-engineer-anything)
10. [Computer agent workflow](#10-computer-agent-workflow)
11. [Team: multi-model work](#11-team-multi-model-work)
12. [Web search and page reading](#12-web-search-and-page-reading)
13. [Video generation](#13-video-generation)
14. [AutoTune and STM](#14-autotune-and-stm)
15. [Security and safe operating practices](#15-security-and-safe-operating-practices)
16. [Troubleshooting](#16-troubleshooting)
17. [What you can create with OmniStudio](#17-what-you-can-create-with-omnistudio)
18. [Recommended end-to-end operating process](#18-recommended-end-to-end-operating-process)
19. [Quick checklist](#19-quick-checklist)

---

## 1. What OmniStudio is

OmniStudio is a local AI workspace that uses the models and model-combos configured in **OmniRoute**. It offers a single interface for chat, reasoning, coding, website and app generation, reverse engineering, video generation, computer-use agents, multi-model teams, and MCP-based connectors.

- **Runtime:** Node.js; no Docker is required.
- **Local UI:** normally `http://localhost:3210`.
- **Model gateway:** OmniRoute's OpenAI-compatible API.
- **MCP:** local command/stdin-stdout servers and remote Streamable HTTP servers.
- **Persistence:** ordinary files in a `data/` directory next to `server.js` by default.
- **No model training:** Skills are prompt-level instructions loaded on each request; they do not modify model weights.

### Important distinction

OmniStudio is the workspace/orchestrator. OmniRoute provides model access. REA and connectors provide tools. Node.js runs the local application and any local MCP server processes. These are separate layers:

```text
You
 └─ OmniStudio UI (localhost:3210)
     ├─ Chat / Reasoning / Coding / Builders / Agents
     ├─ Skills and project files
     ├─ REA MCP client ───────► REA MCP server
     └─ Connector MCP clients ► filesystem / GitHub / browser / custom tools
                 │
                 ▼
          OmniRoute API (default localhost:20128/v1)
                 │
                 ▼
           Selected model or combo
```

---

## 2. Requirements and installation

### Requirements

- Node.js **18 or newer**; an active LTS release is recommended.
- OmniRoute installed/running if you want to use real models.
- A working OmniRoute API key.
- For some MCP directory entries:
  - `npx` is provided by npm with Node.js.
  - `uvx` requires `uv` to be installed for the Web Fetch and Time directory entries.
- Internet access for downloading packages, remote MCP endpoints, web search, and hosted model/video providers as applicable.

### Windows setup

1. Download and install Node.js LTS from <https://nodejs.org/>.
2. Extract `omnistudio-v1.3.zip` to a normal writable folder, for example:
   `C:\AI\omnistudio-v1.3\`
3. Open the extracted folder and verify it contains `server.js`, `package.json`, `start.bat`, and `public\`.
4. Double-click **`start.bat`**.
5. Wait for the server to start. Open <http://localhost:3210> if the browser does not open automatically.
6. On first launch, open **Settings** and configure OmniRoute (Section 3).

If Windows blocks the script, inspect `start.bat` in a text editor and run it from a terminal so the error stays visible:

```bat
cd /d C:\AI\omnistudio-v1.3
start.bat
```

Do not run the project as Administrator unless a specific, understood requirement makes it necessary.

### Manual start

From the extracted project folder:

```bash
node server.js
```

The included `start.bat` is the intended Windows launcher; `start.sh` is for macOS/Linux.

### Change the port

The default port is `3210`. To use another port in Windows Command Prompt:

```bat
set PORT=3300
node server.js
```

macOS/Linux:

```bash
PORT=3300 node server.js
```

Then open `http://localhost:3300`.

### Change the data directory

The project supports `OMNISTUDIO_DATA` to store data outside the project directory.

Windows Command Prompt example:

```bat
set OMNISTUDIO_DATA=D:\OmniStudioData
node server.js
```

macOS/Linux:

```bash
OMNISTUDIO_DATA="$HOME/OmniStudioData" node server.js
```

Set the variable before launching. Back up this directory because it contains projects, saved chats, connector configuration, skill assignments, reports, and agent run logs.

---

## 3. Connect OmniStudio to OmniRoute

### Step-by-step

1. Start OmniRoute and confirm its dashboard/API is available.
2. Start OmniStudio.
3. Open **Settings → Connection** (the first-run screen may open Settings automatically).
4. Set **Base URL** to the OmniRoute OpenAI-compatible API base. The supplied project documents the default as:

   `http://localhost:20128/v1`

   You can usually type the base address without a trailing `/v1` only if your OmniRoute setup supports/normalizes it; safest is to use the exact API base expected by your OmniRoute instance.
5. Paste the API key from your OmniRoute dashboard into the API key field.
6. Click **Save & test connection**.
7. Wait for the model list and combos to load.
8. Configure the **Default model for each mode** (Chat, Reasoning, Coding, website builder, app builder, video and other exposed settings as available).
9. Send a short test message in Chat, then test a coding prompt.

### Pinned combos

If OmniRoute does not include a combo in the returned model list, add its exact identifier under **Pinned combos** in Settings. The project README says pinned combos are then added to every model picker. Use the exact combo/model name recognized by OmniRoute, not a display nickname unless OmniRoute accepts that nickname.

### Confirm the connection

A successful connection should result in available models/combos appearing in the pickers. If the test fails:

- Confirm OmniRoute is running.
- Confirm the URL, port, and `/v1` path.
- Confirm the API key is current and copied without extra spaces.
- Check whether another local service is using the port.
- If you use a non-default OmniRoute host, ensure it is reachable from the same computer.
- Do not paste API keys into prompts, screenshots, skill files, or public issue reports.

### OmniRoute model selection advice

- **Coding/debugging:** choose a model that reliably follows code instructions; use lower temperature when exposed.
- **Reasoning/planning:** choose a model with strong multi-step reasoning.
- **Website/app generation:** choose a model that produces complete, coherent HTML/CSS/JS files.
- **Video:** the selected provider/model must support the configured video-generation endpoint.
- **Team/Arena:** use multiple capable text models or combos; avoid including image/audio-only models in text tasks.

---

## 4. Workspace and data-folder map

The app's local data directory is `data/` beside `server.js`, unless `OMNISTUDIO_DATA` overrides it.

| Path | Purpose |
|---|---|
| `data/config.json` | OmniRoute connection and workspace settings; includes sensitive local configuration |
| `data/projects/` | Website and app projects, stored as normal files |
| `data/outputs/videos/` | Generated video output |
| `data/chats/` | Saved conversations |
| `data/rea/<investigation>/` | REA investigation report and investigation files |
| `data/connectors.json` | Connector definitions and secret values/headers |
| `data/skills/` | Markdown skills library |
| `data/skills-assign.json` | Which skills are assigned to which models/combos |
| `data/workspaces/<task>/` | Computer/Team agent task workspaces and deliverables |
| `data/runs/` | Agent and Team run logs |
| `data/team.json` | Team roster, capabilities and related scores |
| `data/autotune-feedback.json` | AutoTune feedback and parameter offsets (created when used) |

### File handling principles

- Website/app output is stored as ordinary HTML/CSS/JS files that can be opened in VS Code or another editor.
- Back up the entire data directory before major changes or upgrades.
- Do not share `config.json` or `connectors.json` publicly; they may contain credentials.
- Avoid editing live JSON while OmniStudio is running unless you know the file's schema. Prefer the UI.
- The `data/` folder is operational data, not the application source. The application source is the extracted project folder.

---

## 5. Feature-by-feature guide

The exact tabs may vary with configuration, but the supplied v1.3 project documents these features.

### 5.1 Chat

**Purpose:** general-purpose conversation with streaming responses and saved chat history.

**Workflow**
1. Open Chat.
2. Select a model/combo.
3. Enter a prompt and send.
4. Optionally enable web search, choose connector tools, or enable STM options.
5. Use the saved-chat list to return to prior conversations.

Use it for research, copywriting, planning, explanations, debugging discussions, and connector-assisted tasks. For code changes that need a dedicated engineering workflow, use Coding or Computer instead.

### 5.2 Reasoning

**Purpose:** difficult analysis and multi-step tasks, with a thinking-effort control where supported by the UI/model.

**Workflow**
1. Open Reasoning.
2. Select a reasoning-capable model/combo.
3. Set thinking effort if available.
4. Give the goal, constraints, and expected output format.
5. Review the final answer and any separate collapsible reasoning/thinking display provided by the interface.

Do not treat a model's confidence or detailed explanation as proof of correctness; verify important outputs.

### 5.3 Coding

**Purpose:** code-focused assistance with lower-temperature defaults and copyable code blocks.

**Workflow**
1. Open Coding.
2. Choose a coding model/combo.
3. Provide the relevant code, error, desired behavior, and constraints.
4. Use web search or MCP connectors if useful and safe.
5. Apply generated changes in your own repository and run tests.

Coding chat can explain or produce code. It does not mean that every generated change has been applied to your filesystem; use the builder or Computer workflow when you need file creation/execution.

### 5.4 Websites builder

**Purpose:** create and iteratively modify website projects.

**Workflow**
1. Open **Websites**.
2. Create a project and give it a clear name.
3. Describe the website, target users, pages, style, responsive behavior, and functionality.
4. Let the selected builder model create/update real files in the project folder.
5. Inspect the live preview at desktop, tablet, and mobile sizes.
6. Use the built-in code editor to inspect or adjust HTML/CSS/JS.
7. Iterate with precise requests, such as “keep the layout; improve the mobile menu and keyboard accessibility.”
8. Rename, reopen, or delete projects from the project gallery as required.
9. Test the project in a normal browser before deployment.

**Recommended first prompt**
> Build a responsive, accessible website for [business]. Include [pages/sections], use [brand colors and typography], support mobile/tablet/desktop, and implement [specific interactions]. Use semantic HTML, clean CSS, and vanilla JavaScript. Keep assets local where possible, validate all forms, and show empty/loading/error/success states. Explain the files created.

Treat generated code as a starting point. Test forms, links, accessibility, mobile behavior, security, and browser compatibility before publishing.

### 5.5 Apps builder

**Purpose:** create small interactive applications as working HTML/CSS/JS projects.

Examples include trackers, calculators, flashcards, Kanban boards, lead managers, dashboards, inventory tools, and personal productivity utilities.

**Workflow**
1. Open **Apps** (separate from Websites).
2. Create an app project.
3. Specify the user, data fields, workflows, validation rules, and desired screens.
4. Ask for a complete working implementation, not only a visual mock-up.
5. Test each interaction in the live preview.
6. Inspect files in the editor.
7. Open the **Data** tab to inspect persisted `localStorage` data and reset it if needed.
8. Reopen/reload the app and verify persistence.
9. Back up/export any important user data before using the reset action.

The project README says app `localStorage` data is kept in the project folder and survives reloads/restarts. This is local app storage, not a multi-user cloud database. Do not assume it synchronizes across devices or users.

### 5.6 REA

See the dedicated [REA guide](#9-rea--reverse-engineer-anything). REA is for investigating software and producing an evidence-oriented report through MCP tools.

### 5.7 Video

**Purpose:** submit a text prompt to the configured OmniRoute video-generation endpoint and download generated output into the local video gallery. It supports immediate and queued/polled provider responses, according to the project README.

**Workflow**
1. Open **Video**.
2. Choose a model/provider compatible with video generation.
3. Write a prompt describing subject, action, scene, camera movement, style, duration/aspect ratio if supported by the provider, and exclusions.
4. Use **Improve prompt** if you want the chat model to refine the prompt.
5. Generate. If the provider queues jobs, allow the app to poll until completion.
6. Inspect the result in the gallery and verify the downloaded file.
7. Check Settings for the video output path and endpoint configuration if needed.

**If it fails:** the provider/combo may not support video, the provider may use a different API path, or the configured endpoint may not match your OmniRoute setup. Do not assume all models listed by OmniRoute can generate video.

### 5.8 Arena — multi-model race

**Purpose:** send one prompt to multiple models/combos in parallel and compare the answers.

The documented heuristic score considers completeness, relevance, structure, cleanliness, and speed. An optional judge model can assign 0–10 scores, blended with the heuristic score.

**Workflow**
1. Open **Arena**.
2. Select at least two models/combos.
3. Enter the same prompt and shared constraints.
4. Optionally select a judge model.
5. Run the race.
6. Compare answers, ranking, latency, and score components.
7. Choose the strongest answer and independently verify it.

**Limit:** heuristic scoring is not a factual truth detector. It can reward structure or length and miss subtle errors. Use Arena to compare candidate outputs, not to replace tests or expert review.

### 5.9 Computer — workspace agent

**Purpose:** a model works step by step in a task-specific folder, using shell, file editing/reading/listing, web search and page reading.

The documented tool operations include `shell`, `write_file`, `read_file`, `list_files`, `web_search`, `fetch_url`, `read_skill`, and `finish`.

**Workflow**
1. Open **Computer** and start a task.
2. State the deliverable, workspace boundaries, acceptance criteria, and what must not be changed.
3. Let the agent inspect its workspace and propose/write files.
4. Review every shell command. The default is to ask before each command.
5. Approve only commands you understand and expect.
6. Inspect changed files, previews, test output, and final summary.
7. Run the project/tests yourself before deployment.

**Critical security note:** the shell is not a security sandbox. A command may have the permissions of your Windows/macOS/Linux account. The deny-list is only a safety net. Keep approval mode enabled for untrusted models/tasks; use a VM or properly isolated environment for risky work.

### 5.10 Team — multi-model project execution

**Purpose:** split a larger project into tasks, assign each task to a suitable model, run independent tasks in parallel, review outputs with a different model, and perform integration checks.

**Workflow**
1. Open **Team → Roster**.
2. Enable the models/combos you want on the team.
3. Adjust their 0–100 capability scores for coding, web design, reasoning, writing, and review; or run **Benchmark** for a quick calibration.
4. Select a lead model and describe the project plus acceptance criteria.
5. Review the proposed plan of 2–8 tasks, dependencies, files, and checks.
6. Pin a task to a specific model if required.
7. Set a sensible parallelism limit and run.
8. Monitor task statuses and review results.
9. A different model reviews task output; rejected work may be retried with review feedback.
10. Review the integration/final check and `TEAM_REPORT.md` in the workspace.

Tasks that write to the same file are ordered rather than run concurrently. Benchmark results are a quick calibration, not a comprehensive model evaluation. A successful run does not guarantee that all deliverables are correct.

### 5.11 Connectors

See Sections 7–8. Connectors expose MCP tools to models in Chat, Reasoning, and Coding. They do not currently apply to Computer, Team, or builder tabs according to the supplied README.

### 5.12 Skills

See Section 6. Skills are reusable Markdown instructions assigned to individual models/combos or everyone.

### 5.13 Settings

Settings documented in v1.3 include OmniRoute connection, default models, pinned combos, web search providers, judge configuration, agent defaults, video path/endpoint, AutoTune, STM, and theme. Settings are split into sections.

---

## 6. Skills and Markdown knowledge files

Skills teach models repeatable rules, domain knowledge, conventions, checklists, and project standards. They are loaded into prompts; they are not fine-tuning.

### Skill file format

Create a plain UTF-8 `.md` file. A simple example:

```markdown
---
name: PHP Project Standards
description: Conventions for PHP, HTML, CSS and JavaScript work
---

# Rules

- Use PHP 8-compatible syntax.
- Escape untrusted output appropriately.
- Use prepared statements for database queries.
- Keep HTML semantic and accessible.
- Keep CSS responsive and avoid unnecessary dependencies.
- Explain files changed and provide a test checklist.
```

The project also supports Anthropic-style `SKILL.md` files with `name` and `description` frontmatter.

### Add a skill in the UI

1. Open **Skills**.
2. Select **By model**.
3. Choose a model/combo or **★ Everyone**.
4. Upload one or more `.md` files, or select existing skills from the library.
5. For drag-and-drop, use the “Who learns this skill” assignment checklist.
6. Use **Edit** to update a skill.
7. Use **Preview what it sees** to inspect the exact text added to the model prompt.
8. Test with a prompt that should invoke the rule.

You can also put `.md` files in `data/skills/` when OmniStudio is stopped or when you deliberately manage the library on disk.

### Skill assignment strategy

- **Everyone:** general response and safety conventions.
- **Coding model:** language/framework conventions, testing requirements, code review checklist.
- **Website builder:** design system, accessibility, brand colors, responsive layout.
- **App builder:** data model, persistence rules, UX conventions.
- **REA model:** investigation scope, evidence format, report structure.
- **Team agents:** task-specific standards and acceptance criteria.

Each request has a total skills prompt budget of approximately **24,000 characters**. If assigned skills exceed the limit, some may be included by name only; agents can use their `read_skill` tool to open a skill when available. Keep high-priority rules short and specific.

### Good skill design

- One skill per coherent topic.
- Prefer actionable rules over broad aspirations.
- State constraints and acceptance tests.
- Avoid placing secrets, private customer data, or API keys in skills.
- Version-control skill files when you need reproducibility.

---

## 7. MCP connectors: concepts and setup

### What MCP means here

The Model Context Protocol (MCP) gives a model a standard way to discover and call tools. OmniStudio acts as the MCP client; an MCP server exposes tools such as reading files, searching GitHub, controlling a browser, or querying a service.

OmniStudio v1.3 supports two connector transports:

1. **Local stdio connector:** OmniStudio starts a command such as `npx ...`; the server communicates over standard input/output.
2. **Remote Streamable HTTP connector:** OmniStudio sends JSON-RPC requests to an `http://` or `https://` MCP endpoint and can attach custom headers.

Remote OAuth sign-in is **not built in** in this version, and older SSE-only transport is not documented as supported. Use a Streamable HTTP endpoint with whatever header authentication your server supports.

### Connector permission policies

The code defines three policy levels:

- **Off:** connector/tools are unavailable to the model.
- **Confirm:** ask for approval before each tool call.
- **Auto:** permit calls without per-call approval.

The UI also supports per-tool rules: **Default**, **Ask first**, **Allow**, and **Off**. The directory's defaults vary by connector. GitHub, Browser, REA, and custom entries default to confirmation according to the README; read-only tools may run without asking when the chosen policy is “Ask before tools that change things.”

**Recommendation:** start with Confirm/Ask first. Enable Auto only for a trusted connector and tools whose effects you understand.

### Add a connector from the directory

1. Open **Connectors** in the sidebar.
2. Browse the directory.
3. Select **Add** on the desired connector.
4. Fill in requested values such as a folder path or API key.
5. Save/add the connector.
6. Test the connection.
7. Inspect the discovered tool list.
8. Open **Manage** and review permission rules for each tool.
9. Enable the connector.
10. In Chat, Reasoning, or Coding, open the **Connectors** control and tick the connector(s) allowed for that message.
11. Ask for a small, low-risk task.
12. Review the **Connector activity** block, including tool calls and returned results.

Adding a connector does not automatically mean every chat will use it: select it in the composer for the specific message.

### Add a custom local MCP server

1. Open **Connectors → Add custom**.
2. Choose local/command or stdio mode.
3. Enter the executable/command.
4. Enter arguments separately in the arguments field, following the UI's expected format.
5. Set the working directory if the server requires one.
6. Add required environment variables in the connector form. Put credentials in secret fields, not in command text or prompts.
7. Save, test, and inspect the tool list.
8. Set the permission policy and per-tool rules.
9. Enable it and select it in the composer.

The local server runs with your user-account permissions. Only add commands/packages you trust.

### Add a remote MCP server

1. Obtain the server's **Streamable HTTP MCP endpoint** from its official documentation.
2. Open **Connectors → Add custom** and choose URL/remote mode.
3. Enter the full endpoint URL, including `https://` where available.
4. Add required HTTP headers. A common pattern is:

   `Authorization: Bearer YOUR_TOKEN`

   Use the header name and token format required by the actual server; not every server uses Bearer authentication.
5. Save and click **Test**.
6. Confirm the server initializes and its tools appear.
7. Set confirmation and per-tool permissions before enabling it.

Do not paste a real token into documentation or source control. If a token is exposed, revoke/rotate it.

### Import existing MCP configuration

The UI can detect/import server entries from Claude Desktop, Cursor, and Claude Code, or import pasted `mcpServers` JSON. Imported connectors start switched **off**, so you can inspect them first.

**Import process**
1. Open **Connectors**.
2. Choose **Import**.
3. Detect from installed apps or paste the existing `mcpServers` configuration.
4. Review every imported command, argument, environment variable, and path.
5. Add/import the desired entries.
6. Test each entry individually.
7. Review tool permissions.
8. Enable only the connectors you trust.

Importing copies configuration; it does not guarantee that the server's runtime dependencies are installed on this computer.

### How the model uses a connector

The documented sequence is:

1. The user selects one or more connectors in the composer.
2. OmniStudio makes the selected tools available to the model through a common text-based tool-call protocol.
3. The model decides whether a tool is useful and requests a call.
4. OmniStudio checks connector/tool permission rules.
5. If approval is required, the user approves or denies.
6. The tool runs and returns a result.
7. The model reads the result and continues until it has a response or reaches the configured tool-call limit.
8. The UI shows connector activity and retains it in the conversation.

The default connector tool-call limit is documented as 15 per message, configurable through `connectors.maxSteps` in `data/config.json`. If the limit is reached, the model is asked to answer with what it has.

### Connector data and limits

- Connector configuration and secrets are stored in `data/connectors.json` on this computer; secrets are not sent to the browser by the server.
- Web search is skipped for a message that uses connectors. Add a web-search connector such as Brave Search or Web Fetch if you need web access in that same tool workflow.
- Connectors work in **Chat, Reasoning, and Coding**. The supplied v1.3 README says they are not wired into Computer, Team, or builder tabs.
- Tool results are data, not trusted instructions. A webpage, repository issue, or file may contain malicious prompt-injection text; do not let it override your original task or safety constraints.

---

## 8. Connector recipes

These are the directory entries included in the supplied source. Package names and upstream server requirements can change; check the server's current official documentation if an entry stops working.

### 8.1 Filesystem

**Directory entry:** `npx -y @modelcontextprotocol/server-filesystem {folder}`

Use case: let the model read/search and, where allowed, write files within one chosen folder.

1. Choose **Filesystem → Add**.
2. Enter a dedicated project folder, such as `C:\Projects\demo-site`.
3. Confirm the server's arguments point to that folder only.
4. Test and inspect the tool list.
5. Use Confirm/Ask-first permissions until you understand which tools can write or delete files.
6. In the composer, select the connector and ask for a harmless read-only task first.

**Best practice:** create a dedicated working folder and backup. Do not grant the filesystem connector your whole home directory or drive root unless there is a compelling reason.

### 8.2 Web Fetch

**Directory entry:** `uvx mcp-server-fetch`; requires `uv`/`uvx`.

Use case: fetch a public web page and return readable text.

1. Install `uv` using the official instructions at <https://docs.astral.sh/uv/>.
2. Confirm `uvx` is available in a fresh terminal.
3. Add Web Fetch from the directory and test it.
4. Select it in Chat/Reasoning/Coding.
5. Ask for a specific public URL and the facts you want extracted.

This is a page-fetch tool, not a general guarantee of browser interaction or authenticated access.

### 8.3 Brave Search

**Directory entry:** `npx -y @modelcontextprotocol/server-brave-search`

1. Obtain a Brave Search API key from the official Brave Search API service.
2. Add Brave Search from the directory.
3. Enter the key in the `BRAVE_API_KEY` secret field.
4. Test the connection.
5. Inspect available search tools and keep a confirmation policy while learning the connector.
6. Select it in the composer and ask a focused query.

### 8.4 GitHub

**Directory entry:** `npx -y @modelcontextprotocol/server-github`

1. Create a GitHub personal access token with the **minimum scopes/permissions** required for your intended tasks.
2. Add GitHub from the directory.
3. Enter the token in `GITHUB_PERSONAL_ACCESS_TOKEN`.
4. Test the connection.
5. Review the tools, especially any that create issues, comment, or modify repositories.
6. Keep confirmation enabled for write-capable actions.
7. Select GitHub in the composer and start with a read-only task, such as summarizing a repository issue.

Never give the connector broader repository access than needed.

### 8.5 Context7 documentation

**Directory entry:** `npx -y @upstash/context7-mcp`

Use case: fetch current library/framework documentation and examples.

1. Add Context7 from the directory.
2. Test it and inspect available tools.
3. Select it in Coding or Chat.
4. Ask for documentation or examples for a specific library and version.
5. Verify that the retrieved docs match the version in your project.

### 8.6 Browser automation with Playwright

**Directory entry:** `npx @playwright/mcp@latest`

Use case: browser navigation, page snapshots, clicking, and typing.

1. Add Browser (Playwright) from the directory.
2. Allow package installation if prompted by `npx`.
3. Test the server.
4. Inspect its tools and leave confirmation enabled.
5. Select it in the composer.
6. Start with a harmless public page and a non-destructive task.
7. Require approval before submitting forms, changing account settings, purchasing, deleting, or posting content.

Browser automation can interact with authenticated sessions and real accounts. Treat it as an action-capable tool, not merely a read-only search.

### 8.7 Memory

**Directory entry:** `npx -y @modelcontextprotocol/server-memory`

Use case: a small knowledge graph that can preserve facts between chats through the MCP server.

1. Add Memory from the directory.
2. Test the server.
3. Inspect tools and choose an appropriate permission policy.
4. Select it in the composer and explicitly specify which durable, non-sensitive facts should be saved or retrieved.

Do not store passwords, API tokens, financial credentials, or sensitive personal information in a general-purpose memory connector.

### 8.8 Sequential thinking

**Directory entry:** `npx -y @modelcontextprotocol/server-sequential-thinking`

Use case: structured scratchpad support for breaking a complex task into steps.

1. Add it from the directory.
2. Test and inspect tools.
3. Select it for a planning/reasoning task.
4. Ask for a plan with checkpoints, assumptions, and verification steps.

This tool helps structure work; it does not independently verify factual claims.

### 8.9 Time and timezones

**Directory entry:** `uvx mcp-server-time`; requires `uv`/`uvx`.

1. Install `uv`.
2. Add Time & timezones.
3. Test the connector.
4. Select it when you need current time or timezone conversion.

### 8.10 REA connector

**Directory entry:** `npx -y rea-agents mcp`

Use case: expose REA tools in Chat/Reasoning/Coding, in addition to the dedicated REA tab.

1. Set up REA as described in Section 9.
2. Add REA from the connector directory or use **Import/Detect** if another app already has its configuration.
3. Test the connector and inspect the tool list.
4. Keep confirmation enabled for tool calls.
5. Select it in the composer when you want REA tools available inside a normal conversation.

### 8.11 Custom connector template

For a local stdio MCP server, the conceptual configuration is:

```json
{
  "command": "node",
  "args": ["C:\\path\\to\\your-mcp-server\\server.js"],
  "env": {}
}
```

For a remote Streamable HTTP server, configure the endpoint in the UI and supply the required headers there. These snippets explain the shape only; use the fields in OmniStudio's custom-connector form rather than pasting arbitrary JSON into an unrelated field.

---

## 9. REA — Reverse Engineer Anything

### What REA does

REA (“Reverse Engineer Anything”) is an MCP tool server. OmniStudio starts the REA server and lets an OmniRoute model/combo call its tools, then keeps investigation context and a Markdown report. REA does not need its own model in this workflow; OmniRoute supplies the model.

**Use only software, files, devices, or systems you own or have explicit permission to analyse.** Do not use reverse-engineering tools to access systems without authorization, extract secrets, or bypass access controls.

### Step A — Install/setup REA

The supplied README gives this setup command:

```bash
npx -y rea-agents setup --yes
```

The README notes that REA is aimed at macOS. Because the supplied OmniStudio project has not been tested on Windows with the real REA package, treat Windows support as unverified. If setup fails:

1. Check the current official REA repository/documentation: <https://github.com/morluto/rea>
2. Confirm Node.js/npm work in the same terminal OmniStudio will use.
3. Review the exact error output.
4. If the setup has written MCP configuration for Claude Desktop, Cursor, or Claude Code, use OmniStudio's **Detect from other apps** option.
5. Do not guess a command if the documented one fails; verify the current REA MCP startup command in its official docs.

### Step B — Configure the REA connection

1. Start OmniStudio.
2. Open **REA** in the sidebar.
3. Click **Set up connection**.
4. Try **Detect from other apps**. OmniStudio checks known MCP config locations for Claude Desktop, Cursor, and Claude Code and looks for an REA entry.
5. If detected, select the intended entry and confirm the command, arguments, and working directory.
6. Otherwise enter the command/arguments from REA's current docs. The bundled UI's default guess is:

   - Command: `npx`
   - Arguments: `-y rea-agents mcp`

7. Set the working directory only if REA requires it and the folder exists.
8. Set approval mode to **confirm** initially.
9. Click **Save & test connection**.
10. Confirm the test succeeds and the discovered tool count/names appear.

If the test fails, record the complete visible error and stderr details. Check that `npx` is on PATH, package setup completed, and the command/arguments match the installed REA version.

### Step C — Create an investigation

1. In REA, choose **New investigation**.
2. Give it a short descriptive name, such as `owned-app-audit`.
3. Enter the path to the target project on your computer.
4. State the exact questions you want answered.
5. Choose the OmniRoute model/combo in the investigation UI.
6. Start with approval required for each tool call.
7. Review every proposed tool call before allowing it to run.
8. Ask focused follow-ups based on the evidence returned.
9. Inspect the live report and tool list while the investigation runs.
10. Copy or download the final report as Markdown.

### A good investigation prompt

```text
Analyse only this local project: [absolute path].

Objective:
- Map the project structure and major components.
- Identify entry points, dependencies, data flow, and important configuration.
- Explain how the requested feature works, citing file paths and relevant symbols.
- Identify bugs and security risks with evidence.
- Do not modify files, execute destructive commands, access unrelated directories,
  or attempt to retrieve secrets.

Deliver:
1. Executive summary
2. Architecture and execution flow
3. Important files and responsibilities
4. Findings with evidence (file path + symbol/line where available)
5. Risk severity and rationale
6. Safe reproduction/verification steps
7. Recommended next actions
```

### Step D — Find the output

The bundled README documents investigation data under:

```text
data/rea/<investigation-name>/
```

The report is normally:

```text
data/rea/<investigation-name>/REPORT.md
```

Agent run logs are stored under `data/runs/`. The exact folder slug is normalized from the investigation name, so it may not exactly match spaces or punctuation in the display name.

### Step E — Use REA in another workflow

You can also add REA as an ordinary MCP connector, then select it in Chat, Reasoning, or Coding. This makes its tools available in those conversations. The dedicated REA tab is preferable when you want an organized investigation gallery and a persistent report.

### REA operating tips

- Start with read-only analysis.
- Give a narrow target path rather than a drive root.
- Keep confirmation on until you understand each tool.
- Ask the model to distinguish observed evidence from inference.
- Require exact file paths and verification steps.
- Back up the target before any permitted modification.
- Never assume a report is complete merely because the agent says “finished”; review the report and rerun critical checks.

---

## 10. Computer agent workflow

### Suitable tasks

- Build a small project from a specification.
- Inspect and debug an existing project copied into the workspace.
- Write scripts, documentation, tests, or prototypes.
- Fetch public documentation and use it while working.
- Produce files and a final task report.

### Recommended procedure

1. Define the outcome and success criteria.
2. Start a Computer task and inspect the workspace path.
3. Ask the model to list files before changing anything.
4. Request a short plan and expected files.
5. Keep command approval on.
6. Inspect each command's target directory and side effects.
7. Run tests or preview the generated deliverable.
8. Inspect the actual files; do not rely only on the chat summary.
9. Save/export the deliverable and document how to run it.

### Command approval checklist

Before approving a command, ask:

- Is the command necessary for the task?
- Which directory and files can it affect?
- Does it delete, overwrite, install, publish, or transmit anything?
- Does it access credentials, browser profiles, or private data?
- Is the package/source trusted?
- Can I run a safer read-only or dry-run version first?

The app's command deny-list does not make shell execution safe. Use a VM/container for untrusted or high-risk tasks.

---

## 11. Team: multi-model work

Team is useful for projects that can be divided into independently verifiable deliverables.

### Suggested task decomposition for a web app

1. **Lead/planner:** requirements, architecture, file plan, acceptance criteria.
2. **UI specialist:** layout, design system, responsive behavior.
3. **Implementation specialist:** data flow, application logic, integrations.
4. **Testing specialist:** tests, edge cases, accessibility, bug reproduction.
5. **Reviewer/integrator:** inspect task outputs, resolve interface mismatches, run end-to-end checks.

The actual team roster and assignment should be set in Team; this list is a recommended work pattern, not a preconfigured set of agents.

### Best practices

- Ask for file-level ownership to reduce conflicts.
- Keep tasks small enough to review.
- Give each task measurable acceptance criteria.
- Set a reasonable concurrency limit to avoid overwhelming your machine/API limits.
- Require tests and a reviewer independent of the original implementer.
- Review `TEAM_REPORT.md` and the real project files.
- Commit a known-good baseline in version control before a large run.

---

## 12. Web search and page reading

### Supported search providers in Settings

The bundled README lists:

| Provider | Requirement |
|---|---|
| Serper | API key |
| SerpAPI | API key |
| Brave | API key |
| SearXNG | Your own server URL |
| DuckDuckGo | No API key; may be rate-limited |

### Enable and use web search

1. Open **Settings → Web search**.
2. Choose the provider.
3. Enter its key or endpoint if required.
4. Save and test where the UI offers a test.
5. In Chat, Reasoning, or Coding, use the Web button or enable **Search the web for each message**.
6. Ask for sourced, current information and have the model distinguish source statements from its own conclusions.

The bundled README says agents can use `web_search` and `fetch_url`. The page reader refuses private, loopback, and link-local addresses to reduce access to internal network resources. This is a safeguard, not a guarantee against every network attack.

### Search vs. MCP connector

- Use the built-in web-search setting for normal search-enabled Chat/Reasoning/Coding.
- Use a selected MCP connector when you need a specific tool server.
- The README says built-in web search is skipped for a message using connectors; select a suitable search/fetch connector if both are needed.

---

## 13. Video generation

### Setup

1. Ensure OmniRoute is running and its API key works.
2. Open **Settings → Video** (or the corresponding video section).
3. Select a provider/model that supports video generation.
4. Confirm the configured generation endpoint matches your OmniRoute/provider setup.
5. Choose the output folder if exposed by the UI.
6. Test with a simple prompt before using a complex production prompt.

### Prompt template

```text
Create a [duration if supported] video showing [subject] doing [action].
Setting: [location, time, atmosphere].
Visual style: [realistic / cinematic / 2D / 3D / product advertisement].
Camera: [shot size, movement, angle].
Lighting and color: [details].
Composition: [subject placement, background].
Continuity: [details that must remain consistent].
Avoid: [text artifacts, unwanted objects, visual defects].
```

Provider support varies. The app's request path is documented as `POST {base}/videos/generations`, but the correct base and endpoint can differ in a particular OmniRoute configuration. If the generation is queued, OmniStudio polls for completion; if it completes immediately, the app handles that response too.

---

## 14. AutoTune and STM

### AutoTune

AutoTune classifies prompts into contexts such as code, debugging, web design, reasoning, analysis, factual Q&A, summarizing, translation, creative writing, brainstorming, and conversation. It selects sampling parameters such as temperature, `top_p`, frequency penalty, and presence penalty.

**Workflow**
1. Enable AutoTune in Settings.
2. Submit a normal task.
3. Review the context/parameters shown for the response.
4. Use thumbs-up/down feedback where available.
5. AutoTune gradually nudges parameters for that context based on feedback.
6. Reset learned feedback from Settings if the behavior drifts or you want a fresh baseline.

AutoTune is a heuristic classifier and gradual parameter adjustment, not a guarantee of improved quality on every prompt. You can disable it for a chat and use manual sliders where exposed.

### STM — Semantic Transformation Modules

STM applies optional post-processing to replies. The bundled README lists:

- Hedge reducer
- Direct mode
- No sign-offs
- Casual tone
- No emoji
- Plain text

**Workflow**
1. Open the STM control in the chat bar or Settings.
2. Enable only the transformations you want.
3. Compare the transformed answer with **Show original**.
4. Keep transformations disabled when exact wording, tone, legal phrasing, or formatting must be preserved.

The README says code blocks are not altered by STM. Still review transformed prose for unintended changes in meaning.

---

## 15. Security and safe operating practices

### Local application security

The bundled README says the server binds to `127.0.0.1`, rejects requests from other websites through host/origin checks, and keeps the OmniRoute API key on the server rather than exposing it to the browser. Generated website/app previews are sandboxed so their scripts cannot access the OmniStudio API.

These controls reduce exposure but do not replace normal endpoint, OS, network, and data-security practices.

### Credentials

- Keep API keys in the UI's intended secret fields.
- Never place keys in prompts, Skills, project source, screenshots, or Git commits.
- Restrict token scopes and rotate exposed credentials.
- Protect `data/config.json` and `data/connectors.json`.
- Use least privilege for GitHub, filesystem, browser, and remote tools.

### Filesystem and shell

- Local MCP servers and Computer shell run with your user-account permissions.
- Avoid granting connectors a whole drive or home folder when a single project folder is enough.
- Keep approval on for shell and write-capable tools.
- Back up files before broad edits.
- Use version control and inspect diffs.
- Use a VM or real container isolation for risky work.

### Prompt injection

A page, repository, README, issue, or file may contain instructions intended to manipulate the model. Treat connector output as untrusted data. The model should follow the user's original scope, not instructions embedded in fetched content.

### Network and remote MCP

- Prefer HTTPS for remote MCP.
- Only connect to endpoints you trust.
- Verify certificate/hostname and authentication expectations.
- Do not expose the local OmniStudio port to the public internet without a separately designed and tested security layer.
- The README notes a theoretical DNS-rebinding concern in the page reader and says the permission mode does not limit network access.

### Generated applications

Before deployment:
- Review input validation, output escaping, authentication, authorization, and secrets handling.
- Replace demo/localStorage persistence with a suitable backend if the app needs multi-user data.
- Test error states, mobile layout, accessibility, and browser compatibility.
- Do not assume AI-generated code is secure because it runs successfully.

---

## 16. Troubleshooting

### “Cannot reach OmniRoute”

1. Confirm OmniRoute is running.
2. Verify the base URL, port, and `/v1` path.
3. Click **Save & test connection** again.
4. Check local firewall/proxy settings.
5. Confirm OmniRoute's API is listening on the expected interface.

### “401” / invalid API key

- Re-copy the key from OmniRoute.
- Remove accidental whitespace.
- Check whether the key has been revoked or regenerated.
- Ensure the key belongs to the configured OmniRoute instance.

### Models or combos are missing

- Refresh/retest the connection.
- Confirm the models/combos are configured and enabled in OmniRoute.
- Add the exact combo identifier to **Pinned combos** if the API model list omits it.

### Port already in use

Windows:

```bat
set PORT=3300
node server.js
```

Then open `http://localhost:3300`.

### Connector says “command not found”

- Confirm the command is installed and on PATH.
- Open a new terminal after installing Node.js, npm, or `uv`.
- Test `node --version`, `npm --version`, `npx --version`, and `uvx --version` as relevant.
- For a Windows path containing spaces, use the UI's command/arguments fields carefully; do not combine a full command string into the executable field unless the form explicitly expects it.

### MCP server starts then exits

- Run the documented command manually in a terminal.
- Check package name and current upstream instructions.
- Inspect the connector test error/stderr.
- Confirm environment variables and required API keys.
- Confirm the remote server supports Streamable HTTP rather than only an unsupported transport.
- Reconnect/test after fixing configuration.

### Remote MCP returns 401/403

- Verify the endpoint and token.
- Confirm the required header name and authentication scheme.
- Check that the token has the required permissions and has not expired.

### REA connection fails

- Verify REA setup completed.
- Try **Detect from other apps** to reuse an existing valid MCP command.
- Check `npx` and the exact `rea-agents` command in a terminal.
- Review the official REA documentation; the bundled project says the tool is aimed at macOS and real Windows support was not tested.

### Video returns no video

- Confirm the selected provider/model supports video.
- Check Settings → Video endpoint.
- Confirm provider credentials/credits and endpoint compatibility.
- Try a short, simple prompt.

### Website/app preview is broken

- Inspect browser console output if available.
- Ask the builder to check missing files, invalid paths, JavaScript errors, and responsive CSS.
- Verify that the entry point is `index.html`.
- Test generated files outside the preview as well.
- For apps, inspect/reset Data only after backing up important local data.

### Tests

The supplied project includes a backend test suite:

```bash
npm test
```

The README says it runs 60 backend test groups against a built-in fake OmniRoute. It also documents a mock OmniRoute for UI testing:

```bash
node test/mock-omniroute.js
```

For that mock, configure OmniStudio to use `http://localhost:20199/v1` with API key `sk-test-key`. Start the mock in one terminal and OmniStudio in another. Use this for UI exploration without sending requests to a real model. Do not use the mock key with a real service.

---

## 17. What you can create with OmniStudio

This is a practical idea catalogue based on the supplied feature set. The complexity and production readiness depend on your chosen model, prompt, integrations, and testing.

### Websites and web experiences

- Business websites and landing pages
- Portfolios and agency sites
- Product pages and campaign microsites
- Documentation/help centres
- Event registration pages
- Pricing pages and quote-request forms
- Internal dashboards and reporting views
- Responsive prototypes and design-system demonstrations

### Interactive apps

- Lead-management and CRM prototypes
- Sales pipelines and follow-up trackers
- Inventory and stock tools
- Expense trackers and budget planners
- Calculators and estimators
- Kanban boards and task trackers
- Flashcards and learning tools
- Appointment/booking front ends
- Form builders and data-entry tools
- Local-first productivity apps
- Admin panels and operational dashboards
- CSV/JSON data viewers and converters
- Small internal utilities

**Production caveat:** the Apps builder's localStorage persistence is suitable for local/single-browser use cases and prototypes. Multi-user products, authentication, shared records, payments, and sensitive business data normally need a backend, authorization, database, monitoring, and security review.

### Software engineering

- Code explanation and architecture mapping
- Bug triage and debugging plans
- Refactoring proposals
- Test generation and test plans
- API client examples
- Database schema drafts
- Documentation and migration guides
- Code review checklists
- Repository/issue analysis through GitHub MCP
- Library documentation lookup through Context7

### Reverse engineering and audits

- Local project structure maps
- Dependency and entry-point analysis
- Feature execution-flow reports
- File responsibility maps
- Evidence-based bug reports
- Authorized security-review preparation
- Comparison of two versions of a codebase
- Technical documentation for inherited projects

Use REA only within authorized scope. Verify claims against the target files and never treat automated analysis as a complete security audit.

### Research and knowledge workflows

- Web research summaries
- Public-page extraction
- Framework/library documentation lookup
- Knowledge capture using the Memory connector
- Stepwise planning with Sequential Thinking
- Model answer comparison through Arena
- Reusable operating procedures stored as Skills

### Creative and media workflows

- Video-generation experiments where the configured provider supports it
- Prompt refinement for video models
- Marketing concept and storyboard drafts
- Short-form ad concepts and scripts
- Multiple candidate copy/creative responses compared in Arena
- Repeatable brand voice and creative rules through Skills

### Multi-agent workflows

- Parallel website/app implementation
- Feature work split across UI, logic, tests, and docs
- Draft/review/revise pipelines
- Multi-model code reviews
- Integration checks and task reports
- Specialist routing based on Team capability scores

### Tool-connected workflows

- Read/search/write a scoped folder through Filesystem MCP
- Search the web with Brave Search MCP
- Fetch public pages with Web Fetch
- Query GitHub repositories/issues/PRs with GitHub MCP
- Navigate a browser through Playwright MCP
- Read current documentation through Context7
- Store/retrieve simple facts with Memory MCP
- Call REA tools from a dedicated investigation or supported chat
- Connect custom internal services that expose compatible MCP tools

### Example project ideas by difficulty

| Difficulty | Project | Suggested OmniStudio features |
|---|---|---|
| Beginner | Personal portfolio | Websites + Skills |
| Beginner | Unit/cost calculator | Apps + Coding |
| Beginner | Study flashcards | Apps + Skills |
| Intermediate | Sales lead tracker | Apps + Coding + testing checklist |
| Intermediate | Agency landing-page generator | Websites + Skills + Arena |
| Intermediate | Repository documentation report | REA + Reasoning |
| Intermediate | GitHub issue triage assistant | GitHub connector + Chat |
| Advanced | Multi-page client portal prototype | Apps/Websites + Team + manual security review |
| Advanced | Automated project analysis pipeline | REA + Skills + Team/report review |
| Advanced | Browser QA helper | Playwright connector + approval rules |
| Advanced | Multi-model implementation workflow | Team + benchmark + integration review |
| Advanced | Prompt-to-video workflow | Video + prompt skill + output review |

---

## 18. Recommended end-to-end operating process

For repeatable, higher-quality work, use this lifecycle.

### Phase 1 — Define

Write a short project brief:
- Goal and intended users
- In-scope and out-of-scope work
- Required files and features
- Data inputs and outputs
- Acceptance criteria
- Security/privacy constraints
- How success will be tested

### Phase 2 — Prepare

- Confirm OmniRoute connection.
- Select the right model/combo for the task.
- Add relevant Skills.
- Create or select a project/workspace folder.
- Enable only the MCP connectors needed for the task.
- Set connectors and shell to confirmation mode.

### Phase 3 — Plan

- Ask for an implementation/research plan first.
- For larger tasks, use Team to split work.
- For unfamiliar code, use REA to map the project before editing.
- For multi-model comparison, use Arena to compare candidates.
- Review the plan and file ownership before execution.

### Phase 4 — Execute

- Use Websites/Apps for project files.
- Use Computer for shell-backed stepwise work.
- Use Team for parallel tasks with independent outputs.
- Use connectors only for specific authorized actions.
- Approve each potentially destructive operation deliberately.

### Phase 5 — Verify

- Run tests.
- Inspect actual files and diffs.
- Test all user-facing interactions.
- Check mobile/responsive layouts.
- Review external links and API responses.
- Verify output paths and persistence.
- Review tool activity and agent reports.
- Independently validate any factual, security, or legal claims.

### Phase 6 — Deliver and maintain

- Keep a known-good version in Git or another backup system.
- Document how to run and test the deliverable.
- Store reusable rules in Skills.
- Save reports and run logs as appropriate.
- Back up the data directory.
- Rotate any credentials that may have been exposed.
- Re-test connectors after upstream package/API changes.

---

## 19. Quick checklist

### First launch
- [ ] Node.js 18+ installed
- [ ] ZIP extracted to a writable folder
- [ ] `start.bat` runs
- [ ] OmniStudio opens at `http://localhost:3210`
- [ ] OmniRoute is running
- [ ] Base URL and API key saved/tested
- [ ] Models and combos appear
- [ ] A basic Chat prompt succeeds

### Before building
- [ ] Correct builder/model selected
- [ ] Requirements and acceptance checks written
- [ ] Relevant Skills assigned
- [ ] Project/workspace path known
- [ ] Backup/version-control baseline created

### Before using connectors or REA
- [ ] Server/endpoint source is trusted
- [ ] Command, arguments, path, URL, and headers reviewed
- [ ] Credentials stored only in secret fields
- [ ] Connection test succeeds
- [ ] Tool list inspected
- [ ] Per-tool permissions reviewed
- [ ] Confirmation enabled for write/action tools
- [ ] Target scope is authorized and narrow

### Before delivery
- [ ] Generated files inspected
- [ ] Tests run
- [ ] UI tested at desktop/tablet/mobile sizes where relevant
- [ ] Data persistence behavior understood
- [ ] Security and error states reviewed
- [ ] No credentials or private data committed
- [ ] README/run instructions supplied
- [ ] Data/report backup completed

---

## Project references

- OmniStudio source package supplied for this guide: `omnistudio-v1.3`
- OmniStudio bundled README: `README.md` inside the package
- REA repository referenced by the bundled README: <https://github.com/morluto/rea>
- Node.js: <https://nodejs.org/>
- `uv` installation documentation: <https://docs.astral.sh/uv/>

**Final reminder:** this guide describes the supplied OmniStudio v1.3 implementation. Verify current upstream package names, authentication requirements, and protocol compatibility before installing third-party MCP servers. For high-impact actions, keep human approval enabled and verify the actual result.
