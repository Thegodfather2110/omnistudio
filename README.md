# OmniStudio

A local AI workspace for your **OmniRoute**. It uses the combos and models you already set up there for chat, reasoning, coding, website building and video. It runs on your own computer, needs **no Docker**, and has **no packages to install** (just Node.js 18 or newer).

## Start it

1. Install Node.js (LTS) from https://nodejs.org if you don't have it.
2. **Windows:** double-click `start.bat`. **Mac/Linux:** run `./start.sh`.
3. Your browser opens at http://localhost:3210. On first run you land on **Settings**:
   - Base URL: `http://localhost:20128/v1` (OmniRoute's default; typing just the address also works)
   - API key: paste the key from your OmniRoute dashboard
   - Click **Save & test connection**. Your models and combos load, and OmniStudio picks a starter model for each mode. Change it any time under *Default model for each mode*.

If OmniRoute doesn't list one of your combos in its model list, type its exact name under **Pinned combos** and it appears in every picker.

## What's inside

| Tab | What it does |
|---|---|
| **Chat** | General conversation, streamed live. Chats are saved and listed on the left. |
| **Reasoning** | Same, tuned for hard problems. Has a *thinking effort* setting. The model's thinking appears in a collapsible block, separate from the answer. |
| **Coding** | Low-temperature engineering assistant. Code blocks get copy buttons. |
| **Websites** | Your projects gallery (name, preview thumbnail, file count, last edited, folder path). Open a project to describe a site. The model writes real `index.html` / CSS / JS files into the project folder, with live preview (desktop/tablet/mobile), a built-in code editor, and rename/delete. Make as many sites as you like. |
| **Apps** | Like Websites, but for things people *use*: describe an app (tracker, board, calculator, flashcards…) and the model writes a working HTML/CSS/JS app into a project folder with live preview, code editor and device sizes. The app's `localStorage` data is kept in the project folder, so it survives reloads and restarts; the **Data** tab shows it and can reset it. |
| **REA** | Reverse engineering with evidence. Your OmniRoute models drive the **REA** tools (an MCP server OmniStudio starts on your computer). Investigations work like website projects: a gallery, then chat on the left and the live report, tool list and connection on the right. See *REA* below. |
| **Video** | Prompt → OmniRoute `POST {base}/videos/generations` → the file is downloaded to your computer and shown in a gallery. Handles both instant and queued (polled) providers. *Improve prompt* rewrites a rough idea with your chat model. |
| **Arena** | The multi-model race idea: send one prompt to several models/combos at once and rank them on **quality**: completeness, relevance, structure, cleanliness, speed. Optionally add a judge model whose 0–10 score is blended in. |
| **Computer** | Gives a model its own workspace folder with a shell, file editor, web search and page reader. It works step by step, runs what it writes, fixes errors, and reports back. You watch live and approve each command. |
| **Team** | Puts several models/combos on one project. A lead plans, each task goes to the model that is best at it, independent tasks run in parallel, another model reviews every result, and a final check makes sure the pieces fit. |
| **Connectors** | Like the connectors in Claude and ChatGPT: let a model use your apps and tools (files, GitHub, web search, a browser, anything that speaks MCP). Pick from a directory, add your own command or URL, import what Claude Desktop or Cursor already use, then tick connectors in the Chat, Reasoning or Coding composer. See *Connectors* below. |
| **Skills** | Teach any model or combo with plain `.md` files (rules, knowledge, checklists). Upload files per model, or tick skills for *Everyone*. |
| **Settings** | Connection, default models, pinned combos, **web search**, **agent defaults**, video path, AutoTune, STM, theme. |

### AutoTune
Each message is classified (code, debugging, web design, reasoning, analysis, factual, summary, translation, creative, brainstorming, conversation) and temperature / top_p / frequency / presence penalties are set to match. Every reply shows what was chosen. 👍/👎 nudge that context's settings toward (or away from) what you liked. You can switch it off per chat for manual sliders, and reset what it learned in Settings.

### STM (semantic transformation modules)
Post-process replies after they arrive: hedge reducer, direct mode, no sign-offs, casual tone, no emoji, plain text. Toggle them from the **STM** button in the chat bar or in Settings. Code blocks are never altered, and each reply has a *Show original* button.

## Skills: models that learn your rules

A skill is a Markdown file in `data/skills/`:

```
---
name: Python style
description: How we write Python
---
Always use type hints. Prefer pathlib over os.path. ...
```

- **Skills → By model**: pick a model or combo (or *★ Everyone*), click **Upload .md files**, or tick skills from the library. Files uploaded here are assigned to that model straight away. *Preview what it sees* shows the exact text added to its prompt.
- **Drag and drop**: drop several `.md` files onto the drop zone. The *Who learns this skill* checklist on each skill lets you tick every model/combo that should get it. *Edit* opens it in place.
- Before every request to that model, its skills are added to the system prompt. That covers Chat, Reasoning, Coding, Websites, the Arena (each contestant gets its own skills) and every agent in Computer and Team.
- Anthropic-style `SKILL.md` files (name + description frontmatter) import as they are. *Draft with AI* writes a first version for you. You can also drop `.md` files straight into `data/skills/`.
- Limit: about 24,000 characters of skills per request. Anything that does not fit is listed by name only (agents can open it with their `read_skill` tool).

This is prompt-level learning: the model reads the skill every time; it does not change the model's weights.

## Web search

In Chat there is a visible **🌐 Web** button next to the tool toggles. A short follow-up such as "and the author?" borrows your previous question so the search still makes sense.

Chat, Reasoning and Coding have a **Search the web for each message** switch (Settings button in the chat bar). Agents get `web_search` and `fetch_url` tools. Pick the provider in **Settings → Web search**:

| Provider | Needs | Notes |
|---|---|---|
| Serper | API key (serper.dev) | Real Google results |
| SerpAPI | API key (serpapi.com) | Real Google results |
| Brave | API key | Brave's own index |
| SearXNG | Your own server URL | Free; can aggregate Google |
| DuckDuckGo | nothing | Works out of the box, may rate-limit |

**Why not Google directly?** Google's official Custom Search JSON API is closed to new customers and shuts down on 1 January 2027, and scraping Google's result pages is against its terms and gets blocked. Serper/SerpAPI are the practical way to get Google results.

The page reader refuses private, loopback and link-local addresses (so a model, or a web page it reads, cannot probe your computer or network). Search results and page text are treated as data, never as instructions.

## Computer (agents)

Each task gets a folder in `data/workspaces/`. The model uses tools by writing `<tool name="...">` tags, so it works with **any** model or combo, with or without native function calling: `shell`, `write_file`, `read_file`, `list_files`, `web_search`, `fetch_url`, `read_skill`, `finish`.

**Safety, honestly:**
- File tools are confined to the workspace (path and symlink checks).
- The shell is **not a sandbox**. A command can do whatever your user account can. So the default is **Ask me before each command**: every command appears as a card with *Run it / Deny*. *Run commands automatically* is opt-in and shows a warning.
- A deny-list blocks obvious disasters (`rm -rf /`, `format`, `shutdown`, `curl | sh`, `sudo`, reading OmniStudio's settings file). It is a safety net, not protection against a determined model. Keep **Ask me** on for models you do not trust.
- Environment variables that look like keys/tokens are not passed to commands. Your OmniRoute key is never shown to the browser or placed in logs.
- Want real isolation? Run OmniStudio inside a VM or container.

## Team: how the work is shared

1. **Roster** (Team → Roster): switch on the models/combos that should work together. Each has a 0-100 score for coding, web design, reasoning, writing and review. Scores start as guesses from the name, you can type your own, or press **Benchmark**: 8 short probes per model where code is run against real tests, math answers and strict-format replies are checked automatically, and writing/design are blended with a judge model if one is set in Settings. It is a quick calibration, not a full benchmark.
2. **Plan**: the lead model splits your goal into 2-8 tasks (skill needed, dependencies, files to deliver, acceptance checks). You can preview the plan and pin any task to a specific model. Tasks that would write the same file are automatically ordered, never run together.
3. **Assign + run**: ready tasks start in parallel (you choose how many). Each goes to the best **free** model for that skill; if the specialist is busy, a clearly worse model waits rather than takes the task. Every model works with its own skills loaded.
4. **Quality gates**: deliverable files must exist -> a *different* model reviews the work -> if rejected the task is retried with the reviewer's exact feedback, then handed to the next-best model. After the last attempt the result is kept but flagged.
5. **Integration**: a final task checks that the parts work together and fixes small mismatches. A `TEAM_REPORT.md` in the workspace lists who did what and how each task fared.
6. **It learns**: pass/fail outcomes are recorded per model and skill, and slowly adjust who gets chosen next time.

No system can promise 100% correct output. This design raises the odds (right model per task, objective checks, independent review, retries) and tells you plainly when something still has concerns.

## REA: reverse engineering through MCP

[REA](https://github.com/morluto/rea) ("Reverse Engineer Anything") is a set of analysis tools that an AI agent calls through the **Model Context Protocol**. OmniStudio is the MCP client: it starts REA, lists its tools, and lets **any model or combo from your OmniRoute** call them. REA needs no model of its own.

1. Install REA once (its own setup installs what it needs; it is aimed at macOS): `npx -y rea-agents setup --yes`.
2. Open **REA** in the sidebar (right below Websites) → **Set up connection**.
   - Press **Detect from other apps**: if REA's setup wrote an MCP entry for Claude Desktop, Cursor or Claude Code, one click copies the exact command.
   - Otherwise type the command yourself. The default, `npx -y rea-agents mcp`, is a best guess; if **Save & test connection** fails, use Detect or check REA's docs for the MCP start command.
3. **New investigation**: a name, the path of the target on this computer, and what you want to know.
4. Pick the model or combo (top right) and describe the task. The model calls REA tools one step at a time. By default **you approve every tool call** (switch to automatic under the chat box). Findings go to a **Report** you can copy or download as Markdown. Follow-up messages keep the context.

Good to know:
- Tool calls use the same text protocol as *Computer*, so every model works, with or without native function calling. Skills assigned to the model are loaded too.
- The report, chat memory and run logs are plain files: `data/rea/<name>/REPORT.md`, `data/runs/`.
- REA runs as you, with your permissions. Analyse only software you own or may analyse.
- `lib/mcp.js` is a general zero-dependency MCP stdio client, so other MCP servers can be added the same way later.

## Connectors: let a model use your apps and tools

A connector is an **MCP server**: either a command that runs on this computer, or a remote URL. Once it is switched on, any model or combo can call its tools from **Chat, Reasoning and Coding**.

**Add one** (sidebar → *Connectors*):
- **Directory**: Filesystem, Web fetch, Brave Search, GitHub, Context7 docs, Browser (Playwright), Memory, Sequential thinking, Time and REA. Press *Add*, fill in the key or folder it asks for, and OmniStudio connects. These are suggested commands (`npx` / `uvx` download the server the first time), and each becomes an ordinary connector you can edit. Web fetch and Time need [uv](https://docs.astral.sh/uv/) for `uvx`.
- **Add custom**: a command plus arguments and environment variables, or a remote URL plus headers (for example `Authorization: Bearer …`).
- **Import**: ticks servers it finds in Claude Desktop, Cursor and Claude Code, or takes a pasted `mcpServers` JSON. Imports start switched off so you can check them first. Keys are copied on the server and never shown.

**Use one**: in the composer press **Connectors** and tick what this message may use. The model decides when a tool helps, calls it, reads the result and carries on. The reply has a **Connector activity** block with every call and result, and it is kept when you reload.

**You stay in control.** Each connector has a permission setting, and every tool can have its own rule (*Manage* → test the connection → list of tools):
- **Ask before tools that change things** (default for most of the directory): tools the server marks read-only run on their own; everything else waits for your *Allow*.
- **Ask before every tool call**: the default for GitHub, Browser, REA and anything you add yourself.
- **Allow every tool**: no questions asked (preset only for Sequential thinking and Time).
- Per tool: *Default*, *Ask first*, *Allow* or *Off* (a tool that is off does not exist for the model).

Good to know:
- Tool calls use the same text protocol as *Computer* and *REA*, so every model works, with or without native function calling. The tool-call limit per message is `connectors.maxSteps` in `data/config.json` (default 15); if a model uses them all it is asked to answer with what it has.
- Secrets (tokens, headers, environment variables) are stored in `data/connectors.json` on this computer and are never sent to the browser; the screen only shows which names are set.
- Remote servers use the **Streamable HTTP** transport with header authentication. OAuth sign-in (the "log in with your account" flow) and the older SSE-only transport are **not** built in yet.
- Web search is skipped for a message that uses connectors; add Brave Search or Web fetch as connectors if you want both.
- Connectors work in Chat, Reasoning and Coding. The Computer, Team and builder tabs do not use them yet.
- A local connector runs as you, with your permissions, and tool results are treated as data, not instructions. Only add servers you trust.

## Where your files are

Everything is in the `data` folder next to `server.js`:

```
data/config.json          connection settings (your API key lives here, only on this PC)
data/projects/<name>/     each website or app, as a normal folder you can open or deploy
data/outputs/videos/      generated videos
data/chats/               saved conversations
data/rea/<name>/          each REA investigation (REPORT.md and chat memory)
data/connectors.json      your connectors and their keys (only on this PC)
data/skills/              your skills (.md files)
data/skills-assign.json   which model/combo has which skills
data/workspaces/<task>/   everything the agents create
data/runs/                logs of agent and team runs
data/team.json            team roster and scores
```

To keep data elsewhere, set the `OMNISTUDIO_DATA` environment variable. To use another port, set `PORT`.

## What changed in 1.3

- New **REA** tab (below Websites): reverse engineering through an MCP server, driven by your OmniRoute models and combos, with approval for every tool call and a saved report.
- New **Apps** tab (below REA): build working apps with the same builder as Websites, with persistent app data and a Data tab. Websites and Apps keep separate galleries; projects from older versions stay under Websites. Settings has an *App builder* model (falls back to the website builder's).
- New **Connectors** tab (Work section): a directory, custom local or remote MCP servers, import from Claude Desktop / Cursor, per-tool permissions, and a **Connectors** button in the Chat, Reasoning and Coding composers so a model can use your apps and tools with your approval.
- New zero-dependency MCP clients: `lib/mcp.js` (local commands, now with per-server environment variables) and `lib/mcp-http.js` (remote servers over Streamable HTTP).

## What changed in 1.2

- Settings has section buttons at the top (Connection, Search, Judge, ...) instead of one long page.
- Team → Roster has a Skills column per model. Image, video, audio and embedding models are marked *non-text* and skipped by "Switch all on".
- Benchmark code written by a model runs under Node's permission mode (no file writes, no spawning processes) on Node 20+. On Node 18 it runs without that restriction.
- Computer: *Preview here* shows an HTML deliverable inside the Files panel. An empty model reply is reported as an error instead of a silent finish.
- The runs list is cached by file time, so the Computer and Team history stays fast with many runs.

## Security notes

- The server listens on `127.0.0.1` only, so other devices can't reach it.
- Requests from other websites are rejected (host and origin checks).
- Your API key is never sent to the browser.
- Generated sites and apps are previewed in a sandbox so their scripts can't touch OmniStudio's API.
- Adding a connector can run a command on your computer, so those routes are protected by the same host and origin checks as everything else; connector keys never leave the server.

Known limits: the Computer shell is not a sandbox (default is to ask before each command); the page reader checks addresses before connecting, so a DNS-rebinding trick is theoretically possible; the permission mode does not limit network access. Tested against a mock OmniRoute and mock MCP servers (local and remote) on Linux, with the interface driven in headless Chromium. Not tested on Windows, against a live OmniRoute, or against the real directory servers (GitHub, Playwright, …).

## Troubleshooting

- **"Cannot reach OmniRoute"**: start OmniRoute, or fix the Base URL.
- **401 / Invalid API key**: re-paste the key in Settings.
- **Video says "returned no video"**: the provider/combo may not support video, or your OmniRoute uses another path. Change it in Settings → Video endpoint.
- **Port in use**: `PORT=3300 node server.js` (Windows: `set PORT=3300` first).

## Tests

`npm test` runs 60 backend test groups against a built-in fake OmniRoute (`test/mock-omniroute.js`). You can also run that mock to try the UI without a real OmniRoute: `node test/mock-omniroute.js`, then connect to `http://localhost:20199/v1` with key `sk-test-key`.
