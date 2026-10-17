# OmniStudio 1.3 — Small Features & Future Updates Roadmap

**Document type:** Product enhancement backlog and implementation guide  
**Target:** Existing OmniStudio 1.3 codebase  
**Primary stack:** Node.js, Express, HTML, CSS, browser JavaScript  
**Integration:** OmniRoute, MCP connectors, REA  
**Status:** Proposed roadmap — validate each feature against the current code before implementation

---

## 1. Purpose

This document is a practical backlog for improving OmniStudio with small, high-value usability features. It focuses on features that make the workspace feel more polished and interactive without requiring a complete redesign.

The roadmap includes:

- Image and file attachments in chat
- Drag-and-drop uploads and pasted images
- Interactive bot avatars / faces
- Speech-to-text input
- Text-to-speech output
- Message actions, chat search, export, and keyboard shortcuts
- Upload and generation status indicators
- Quick prompts, accessibility, privacy, and settings
- Suggested implementation order, testing, and acceptance criteria

> **Implementation rule:** Reuse the existing OmniStudio chat, settings, connector, and server routes wherever possible. Do not invent an OmniRoute endpoint or assume a model supports images/audio. Detect capabilities and provide a graceful fallback.

---

## 2. Feature Priority

| Priority | Feature | Effort | Why it matters |
|---|---|---:|---|
| P0 | Copy message / retry response | Small | Essential everyday chat controls |
| P0 | Attach files and images | Medium | Makes chat useful for real work |
| P0 | Drag-and-drop and paste image | Small–medium | Faster than browsing for files |
| P0 | Upload progress, remove attachment, clear errors | Small | Makes uploads understandable |
| P1 | Speech-to-text | Medium | Faster input and accessibility |
| P1 | Text-to-speech | Medium | Listen to long answers |
| P1 | Interactive bot avatars | Small–medium | Gives agents recognizable identity and state |
| P1 | Stop generation / regenerate | Small–medium | User control over responses |
| P1 | Chat search and export | Medium | Easier retrieval and portability |
| P2 | Quick prompt chips / prompt library | Small | Reduces repetitive typing |
| P2 | Message reactions / save message | Small | Lightweight feedback and bookmarking |
| P2 | Theme, density, font-size preferences | Small | Personalization |
| P2 | Keyboard shortcuts | Small | Faster power-user workflows |
| P2 | Conversation title suggestions | Medium | Better organization |
| P2 | Attachment preview and metadata | Medium | Helps users verify the right file |
| P3 | Live voice conversation | Large | Requires streaming audio and interruption handling |
| P3 | Avatar lip-sync / animated expressions | Medium–large | Polish; should follow reliable voice support |

Effort estimates are relative, not guarantees. Confirm them after reviewing the relevant files and current architecture.

---

## 3. Codebase Areas to Inspect First

The supplied OmniStudio 1.3 archive contains these relevant files. Confirm their current contents before editing because the code may change over time.

| File | Likely responsibility | Features to review |
|---|---|---|
| `public/chat.js` | Chat UI and message flow | Attachments, speech controls, message actions, retry, stop |
| `public/core.js` | Shared client utilities/state | Shared helpers, safe rendering, settings access |
| `public/app.js` | Application startup | Feature initialization and event wiring |
| `public/app.css` | Main styles | Drop zones, previews, avatar states, responsive UI |
| `public/index.html` | Main UI markup | Attachment buttons, hidden file input, voice controls |
| `public/settings.js` | Settings UI and persistence | Voice, avatar, upload and privacy preferences |
| `public/agent.js` | Agent interface/behavior | Agent identity and avatar presentation |
| `public/team.js` | Team / multi-agent UI | Consistent avatar identity and agent status |
| `public/connectors.js` | MCP connector UI | Do not mix file attachments with connector configuration |
| `lib/store.js` | Persistence layer | Conversation metadata only if the existing store supports it |
| `server.js` or main server entry | HTTP routes | Locate the actual server entry in the repository before adding upload routes |
| `package.json` | Dependencies and scripts | Add dependencies only when native browser APIs are insufficient |

### Before coding

1. Make a Git branch, e.g. `feature/omni-small-ux`.
2. Run the existing tests and record the baseline.
3. Inspect how chat messages are sent to OmniRoute and how responses are rendered.
4. Identify current limits for request size, supported models, and server-side storage.
5. Add one feature at a time; rerun tests after each change.
6. Never place API keys, connector credentials, or private server paths in browser JavaScript.

---

## 4. Feature A — Attach Images and Files to Chat

### User experience

Add a paperclip or `+` button beside the chat composer. The user can select files, see them as removable chips/cards, type a prompt, and send the prompt with its attachments.

Support should be explicit and model-aware:

- Images: PNG, JPEG, WEBP, and GIF only if the target model/API supports them.
- Documents: PDF, TXT, Markdown, CSV, JSON, and code files where safe and useful.
- Other formats: reject by default until a deliberate extraction or processing path exists.
- Audio/video: do not imply that a model can interpret them unless the selected model or a configured tool actually supports that input.

### Suggested UI

```text
[ + ] [ Ask OmniStudio...                              ] [ Send ]
       ┌─────────────────────────────────────────────┐
       │ image.png  [preview]  1.4 MB           [×]  │
       │ notes.pdf                         240 KB [×] │
       └─────────────────────────────────────────────┘
```

### Implementation steps

1. Add a visible attachment button and a hidden `<input type="file" multiple>`.
2. Add a `selectedAttachments` client-side state array.
3. Validate file count, extension, MIME type, and size on the client for immediate feedback.
4. Display the selected files before sending. Provide remove and clear-all controls.
5. On submit, send text and files using the server's chosen contract (usually `multipart/form-data`) or use a model-specific image payload where appropriate.
6. The server must repeat validation. Client-side validation is not a security boundary.
7. If a document is not directly accepted by the selected model, use a controlled extraction path (e.g. text extraction for supported PDFs) or explain that the file type is unsupported.
8. Display the file name and processing status in the conversation so the user can see what was actually sent.
9. Clean up temporary files after processing, according to the chosen retention policy.
10. Test oversized files, unsupported formats, interrupted requests, empty prompts with attachments, and multiple files.

### Example client-side input

```html
<button type="button" id="attachButton" aria-label="Attach files">
  Attach
</button>

<input
  id="attachmentInput"
  type="file"
  multiple
  accept="image/png,image/jpeg,image/webp,application/pdf,text/plain,text/markdown,text/csv,application/json"
  hidden
/>
```

### Example client-side event wiring

Adapt the IDs and state management to the existing `chat.js`; do not paste this as a duplicate handler if one already exists.

```js
const attachButton = document.querySelector("#attachButton");
const attachmentInput = document.querySelector("#attachmentInput");

attachButton?.addEventListener("click", () => attachmentInput?.click());

attachmentInput?.addEventListener("change", () => {
  const files = Array.from(attachmentInput.files || []);
  // Call the existing attachment-state function here.
  // Validate and render previews; do not send automatically.
  addSelectedAttachments(files);
  attachmentInput.value = "";
});
```

`addSelectedAttachments()` is a placeholder for the function to implement in the existing chat module.

### Security requirements

- Enforce a configurable maximum file size and maximum number of files.
- Use an allowlist of file types; do not trust the filename or browser-supplied MIME type alone.
- Generate server-side filenames rather than using user-supplied paths.
- Prevent path traversal and executable-file upload.
- Store uploads outside any public/static directory.
- Do not execute uploaded files or treat their contents as trusted instructions.
- Treat text extracted from files as untrusted input; it may contain prompt injection.
- Avoid logging file contents, tokens, or sensitive metadata.
- Explain whether attachments are temporary, retained, or deleted.

### Acceptance criteria

- Users can attach one or several supported files.
- Each attachment can be removed before sending.
- The UI displays size and clear error messages.
- Invalid and oversized files are rejected on both client and server.
- A failed upload can be retried without losing the typed prompt.
- Unsupported model capabilities are explained instead of silently ignored.
- No secret credentials are exposed to the browser.

---

## 5. Feature B — Drag-and-Drop and Paste Images

### User experience

- Drag a file over the composer and show a clear drop target.
- Paste a screenshot or copied image from the clipboard.
- Show previews before the user sends anything.
- Keep the standard file-picker button as a fallback.

### Implementation approach

1. Add drag-enter, drag-over, drag-leave, and drop handlers to the composer region.
2. Prevent browser navigation when a file is dropped into the chat.
3. Read `event.dataTransfer.files` and send them through the same validation function as the attachment picker.
4. Add a `paste` listener to the composer. Inspect clipboard items for image MIME types.
5. Do not intercept ordinary text paste.
6. Make the drop target visible to mouse and keyboard users where possible.

### Acceptance criteria

- Dropped files follow exactly the same validation rules as picker-selected files.
- Pasted images appear as previews.
- Dropping a file does not navigate the browser to the file.
- Drag-and-drop is optional; the feature still works on touch devices.

---

## 6. Feature C — Interactive Bot Faces / Agent Avatars

### Goal

Give each assistant or team agent a recognizable visual identity and small state-based expressions. This should communicate activity—not pretend to reveal the model's real emotions.

### Avatar states

| State | Visual behavior | Meaning |
|---|---|---|
| Idle | Neutral face / subtle glow | Ready for input |
| Thinking | Small animated dots or pulsing ring | Request is being processed |
| Working | Progress ring or tool icon | Tool or task is running |
| Speaking | Gentle waveform / mouth animation | Text-to-speech is playing |
| Success | Brief checkmark or calm smile | Task completed |
| Error | Neutral warning indicator | Request failed; user action may be needed |
| Paused | Static face with pause symbol | Generation or audio paused |

### Recommended design

- Use a small SVG or CSS-based face for a lightweight default avatar.
- Support optional uploaded avatar images in a future iteration.
- Give each named agent a consistent color/icon and identity.
- Respect `prefers-reduced-motion`.
- Avoid flashing, rapid eye movement, or distracting animation.
- Provide accessible text such as `Agent is thinking` for assistive technologies.
- Never imply the bot is conscious or has actual feelings.

### Implementation steps

1. Create a reusable avatar component/function, rather than separate hard-coded markup for every agent.
2. Give it a stable agent ID, display name, avatar asset, and current status.
3. Connect status changes to existing chat/task events: request started, tool running, response received, error, and TTS playback.
4. Keep visual state separate from the model's generated message content.
5. Add CSS classes such as `.avatar--thinking`, `.avatar--working`, and `.avatar--speaking`.
6. Test long agent names, small screens, dark mode, reduced motion, and missing avatar assets.

### Minimal markup concept

```html
<div class="agent-avatar agent-avatar--thinking"
     role="img"
     aria-label="Omni assistant is thinking">
  <span class="agent-avatar__face" aria-hidden="true">●</span>
  <span class="agent-avatar__status" aria-hidden="true"></span>
</div>
```

This is a structural example, not a finished design. Prefer an SVG/CSS face over emoji if consistent branding is important.

### Acceptance criteria

- Avatar state follows real application state.
- Different agents retain their own identity across messages.
- Animation stops when the state changes or the component is removed.
- Reduced-motion settings are respected.
- The UI never represents a guessed emotion as a real model state.

---

## 7. Feature D — Speech-to-Text (Voice Input)

### First version: browser speech recognition

A microphone button lets the user dictate a prompt into the existing composer. The user reviews and edits the transcript before sending.

The browser `SpeechRecognition` API is not available in every browser and can have varying language and privacy behavior. Feature-detect it and show a fallback. Do not assume it works offline.

### Workflow

1. Add a microphone button beside the composer.
2. On click, request microphone/speech recognition only when needed and explain the action.
3. Feature-detect `window.SpeechRecognition` or `window.webkitSpeechRecognition`.
4. Set the language from a user preference, with a sensible default.
5. Show a recording/listening indicator and a stop button.
6. Append final recognized text to the composer; keep interim text visually distinct.
7. Let the user edit the transcript before sending.
8. Handle permission denied, unsupported browser, no speech, and recognition errors.
9. Stop recognition when the user navigates away or explicitly stops.
10. Do not auto-send dictated text by default.

### Example

```js
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

if (!SpeechRecognition) {
  // Disable the microphone feature and show a helpful fallback.
} else {
  const recognition = new SpeechRecognition();
  recognition.lang = "en-IN";
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    // Separate interim text from final text.
    // Insert final text into the composer without auto-sending.
  };

  recognition.onerror = (event) => {
    // Show a concise, user-friendly error.
  };
}
```

The example intentionally omits the final transcript assembly and event lifecycle; implement those in a single managed recognition controller to prevent duplicate listeners and orphaned microphone sessions.

### Later alternative: server-side transcription

If browser recognition is insufficient, add a configurable transcription provider through the server. Keep provider credentials server-side, document audio retention, set upload limits, and show users when audio is sent to an external service.

### Acceptance criteria

- The user can start and stop dictation.
- Transcript text can be edited before sending.
- Unsupported browsers receive a clear fallback.
- Microphone permission denial does not break normal typing.
- Recording stops when requested and is never started silently.
- The selected language and privacy behavior are disclosed.

---

## 8. Feature E — Text-to-Speech (Read Responses Aloud)

### First version: browser speech synthesis

Use `window.speechSynthesis` for basic read-aloud support where available. This avoids a server-side audio provider for the first iteration, though voice availability and quality vary by operating system and browser.

### UI

Add `Read aloud`, `Pause`, `Resume`, and `Stop` controls to each assistant message. Keep controls small and unobtrusive.

### Workflow

1. Add a read-aloud action to assistant messages.
2. Feature-detect `window.speechSynthesis` and `SpeechSynthesisUtterance`.
3. Speak only the selected message, not the entire conversation.
4. Convert Markdown to readable plain text safely; omit code fences or offer a separate code-reading preference.
5. Provide pause, resume, and stop controls.
6. Stop the previous utterance when another message starts, unless multi-message playback is intentionally implemented.
7. Track speaking state so the avatar can show the speaking animation.
8. On navigation or component teardown, cancel playback.
9. Add voice, language, and speed settings if supported.
10. Handle empty text and browser speech errors gracefully.

### Example

```js
function speakText(text, lang = "en-IN", rate = 1) {
  if (!("speechSynthesis" in window) ||
      !("SpeechSynthesisUtterance" in window)) {
    throw new Error("Speech synthesis is not supported in this browser.");
  }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = rate;

  utterance.onstart = () => setAvatarState("speaking");
  utterance.onend = () => setAvatarState("idle");
  utterance.onerror = () => setAvatarState("idle");

  window.speechSynthesis.speak(utterance);
}
```

`setAvatarState()` is a placeholder for the application's shared avatar-state function. Ensure `onend` and `onerror` cannot leave the UI stuck in the speaking state.

### Later alternative: natural AI voices

A server-side TTS provider may deliver more natural voices, but adds API cost, latency, credentials, and audio handling. Make it optional, provider-configurable, and explicit about whether message text is sent to an external service.

### Acceptance criteria

- Users can read one response aloud and stop it immediately.
- Playback state is visible and accurately synchronized.
- A second request does not unintentionally overlap audio.
- The feature gracefully handles unsupported browsers and missing voices.
- Speech controls are keyboard accessible.

---

## 9. Feature F — Message Actions

Add a compact action row on assistant messages:

- Copy text
- Read aloud
- Retry / regenerate
- Save or bookmark
- Export this response
- Optional thumbs-up / thumbs-down feedback

### Implementation notes

- Use the Clipboard API when available; show a fallback or error if permission is denied.
- Retry should reuse the relevant user prompt and context, and should not duplicate a message silently.
- Store bookmarks in the existing conversation persistence mechanism only after confirming its schema.
- Feedback must be optional and should not include hidden personal information.
- Do not show all actions permanently if that makes the interface cluttered; reveal them on hover and keep them reachable by keyboard/focus.

### Acceptance criteria

Every visible control performs a real action, gives success/error feedback, and works without a mouse.

---

## 10. Feature G — Stop, Retry, and Generation Status

### UI states

- Sending
- Waiting for model
- Streaming response
- Tool running
- Completed
- Failed
- Cancelled

### Workflow

1. Disable duplicate submission while a request is in progress, unless parallel conversations are supported.
2. Show a spinner or status label while waiting.
3. If the server and provider support cancellation, wire a Stop button to an `AbortController` or the existing cancellation mechanism.
4. Ensure cancellation actually reaches the server/provider where possible; do not merely hide the spinner.
5. Offer Retry after recoverable errors.
6. Preserve the user's prompt after failure.
7. Prevent late responses from a cancelled request from overwriting a newer message.

### Acceptance criteria

The UI never shows a request as cancelled if it is still running without explanation. Errors are actionable and do not expose server internals or credentials.

---

## 11. Feature H — Chat Search, Rename, and Export

### Chat search

- Search conversation titles and message text.
- Highlight matches.
- Debounce typing to avoid unnecessary work.
- Provide a no-results state and clear-search button.
- Search only data the current user is permitted to access.

### Rename conversations

- Allow manual rename.
- Optionally suggest a short title from the first prompt after the first response.
- Keep title generation optional; do not add an extra model call by default if cost/latency is a concern.

### Export

First release:
- Export a conversation as `.md` or `.txt`.
- Include title, timestamps if available, role labels, and message text.
- Do not include API keys, hidden system prompts, or connector secrets.
- Clearly indicate that binary attachments are not embedded in a text export.

Future:
- JSON export/import with schema validation.
- Optional downloadable attachment bundle with a manifest.
- PDF export only if there is a clear use case and a reliable renderer.

### Acceptance criteria

Exports are readable, correctly escaped, and limited to content the user can access. Imported JSON must be validated before it is used.

---

## 12. Feature I — Quick Prompts and Prompt Library

Provide small prompt chips above the composer, with examples such as:

- Explain this code
- Debug an error
- Summarize a file
- Draft an email
- Research this topic
- Plan an implementation

Users should be able to:
1. Click a chip to populate the composer.
2. Edit the prompt before sending.
3. Save their own reusable prompts.
4. Organize prompts by category.
5. Delete or rename saved prompts.

Keep the default set short. Prompt chips should not send requests automatically unless the user explicitly chooses that behavior.

---

## 13. Feature J — Small UI Quality Improvements

### Recommended additions

- Responsive composer that grows to a sensible maximum height.
- Clear conversation button with confirmation when data may be lost.
- “Scroll to latest” control when the user is reading older messages.
- Auto-scroll only when the user is already near the bottom.
- Copy-code button on fenced code blocks.
- Syntax highlighting only if the current implementation can support it safely.
- Markdown tables that scroll horizontally on narrow screens.
- Friendly empty states and helpful error messages.
- Loading skeletons for slow workspace panels.
- Toasts for copied text, saved settings, and completed exports.
- Model/connection status indicator that does not expose secrets.
- Per-conversation context such as selected model or agent, if the existing app supports it.
- Confirm before clearing drafts or deleting conversations.
- Attachment preview with file size and type.
- “Retry failed upload” and “Remove failed upload” actions.

### Accessibility checklist

- Every icon-only button has an accessible name.
- All controls work with keyboard focus.
- Focus indicators remain visible.
- Text meets contrast requirements.
- Status updates use appropriate live regions without announcing every token.
- Animations respect reduced-motion preferences.
- Voice input has a non-voice alternative.
- Never rely on color alone to communicate state.

---

## 14. Feature K — Settings for Voice, Avatars, and Uploads

Add a dedicated **Chat & Interaction** settings section.

Suggested settings:

| Setting | Default | Notes |
|---|---|---|
| Enable voice input | Off until supported/used | Browser capability detection |
| Speech recognition language | `en-IN` | User-changeable |
| Enable read aloud | Available when supported | Browser TTS first |
| Speech rate | `1.0` | Clamp to a safe supported range |
| Preferred voice | System default | Voice list varies by device |
| Show agent avatars | On | Allow reduced-visual mode |
| Animate avatars | On, respecting OS preference | Reduced-motion wins |
| Maximum files per message | Conservative configurable limit | Enforce server-side |
| Maximum file size | Conservative configurable limit | Enforce server-side |
| Clear temporary uploads | Enabled | Set retention policy explicitly |
| Auto-read responses | Off | Never surprise the user with sound |

Persist settings using the existing settings mechanism. Do not add a second competing source of truth. Validate stored values when reading them because local settings can be stale or malformed.

---

## 15. Suggested Architecture

Keep feature boundaries small. Avoid putting all new behavior into a single large `chat.js` file.

Possible modules, if the existing code structure supports them:

```text
public/
  chat.js                 # Existing chat orchestration
  attachments.js           # File selection, validation UX, previews
  voice-input.js           # Speech recognition lifecycle
  speech-output.js         # Text-to-speech lifecycle
  avatar.js                # Agent avatar and status state
  message-actions.js       # Copy, retry, save, export
  app.css                  # Shared styles or feature styles
```

These are proposed module names, not existing files. Add a module only if it reduces complexity. Keep the application compatible with the current loading strategy; do not introduce ES modules or a bundler without confirming the project supports them.

### Data flow for attachments

```text
User selects / drops / pastes file
             |
             v
Client validation + preview
             |
             v
User reviews prompt and files
             |
             v
Server validates size, type, and count
             |
             v
Safe extraction / supported model payload
             |
             v
OmniRoute request using selected model
             |
             v
Assistant response + attachment status
             |
             v
Temporary file cleanup per retention policy
```

### Data flow for voice

```text
Microphone button
       |
       v
Permission + browser capability check
       |
       v
Speech recognition
       |
       v
Editable transcript in composer
       |
       v
Normal chat submit flow
```

```text
Assistant response
       |
       v
User presses Read aloud
       |
       v
Readable text extraction
       |
       v
Browser speech synthesis / configured TTS
       |
       v
Speaking state updates avatar
```

---

## 16. OmniRoute and Model Compatibility

OmniStudio should treat OmniRoute as the routing layer, not assume every model supports every modality.

Before enabling a feature for a selected model:

1. Inspect existing OmniRoute model/combo discovery and configuration behavior.
2. Use existing provider metadata or an explicit capability configuration if available.
3. Distinguish text, image input, audio input, transcription, and audio generation capabilities.
4. If capability metadata is unavailable, show the feature as “not verified” or let the user choose a configured compatible model.
5. Handle provider errors without losing the prompt or attachment list.
6. Keep provider API keys on the server.
7. Do not send audio or files to a provider until the user submits or explicitly starts the relevant action.

For image input, use the exact payload format expected by the selected upstream model/provider. Do not assume all OmniRoute routes accept OpenAI-style image content without verifying the integration.

For TTS and speech recognition, use browser-native capabilities for the first release. If adding external providers later, build a server-side adapter and document costs, privacy, and supported languages.

---

## 17. Privacy and Security Requirements

- Request microphone access only after a clear user action.
- Display a visible recording/listening state and a stop control.
- Do not silently record or auto-send transcripts.
- Explain if audio is sent to a third-party service.
- Keep provider credentials server-side.
- Validate all uploaded files on the server.
- Limit file size, file count, request body size, and processing time.
- Never execute uploaded files.
- Treat extracted documents and tool output as untrusted content.
- Do not expose private filesystem paths or raw stack traces in UI errors.
- Avoid persisting audio or attachments unless the user-facing retention policy says they are stored.
- Provide deletion/cleanup behavior for temporary files.
- Avoid adding analytics that collect prompts, file content, or audio without explicit and appropriate disclosure.

---

## 18. Testing Plan

### Manual tests

- [ ] Attach one supported image.
- [ ] Attach several supported files.
- [ ] Remove an attachment before sending.
- [ ] Drop a file into the composer.
- [ ] Paste a screenshot into the composer.
- [ ] Try an unsupported extension.
- [ ] Try a file over the size limit.
- [ ] Simulate an upload/network failure.
- [ ] Verify model incompatibility messaging.
- [ ] Dictate a prompt and edit the transcript.
- [ ] Deny microphone permission.
- [ ] Test a browser without speech recognition.
- [ ] Read a response aloud, pause, resume, and stop.
- [ ] Start a second read-aloud action while one is playing.
- [ ] Test avatar idle, thinking, working, speaking, success, and error states.
- [ ] Test Stop and Retry with slow responses.
- [ ] Copy a message and code block.
- [ ] Export a conversation containing Markdown, tables, and code.
- [ ] Test mobile width, keyboard-only navigation, and reduced motion.
- [ ] Verify that API keys and sensitive file contents do not appear in browser logs.

### Automated tests

Add tests for:
- File validation (type, size, count)
- Upload route validation and error handling
- Transcript assembly (interim vs final results)
- TTS lifecycle state changes
- Retry and cancellation race conditions
- Markdown-to-speech text extraction
- Export escaping and serialization
- Settings validation and defaults

Run the existing project tests before and after changes. New tests should follow the repository's existing test framework instead of introducing another framework without need.

---

## 19. Recommended Release Plan

### Release 1 — Essential polish

1. Copy message and copy code actions.
2. Retry response and accurate loading/error states.
3. File/image picker with preview, remove, and server-side validation.
4. Drag-and-drop and paste image.
5. Attachment size/count limits and temporary cleanup.

### Release 2 — Voice and identity

1. Browser speech-to-text with editable transcript.
2. Browser text-to-speech with pause/resume/stop.
3. Shared avatar component with idle/thinking/working/speaking/error states.
4. Language and speech-rate preferences.
5. Reduced-motion and accessibility support.

### Release 3 — Productivity

1. Search conversations.
2. Markdown/text export.
3. Saved messages/bookmarks.
4. Prompt chips and personal prompt library.
5. Keyboard shortcuts and improved mobile composer.

### Release 4 — Optional advanced features

1. Configurable server-side transcription provider.
2. Configurable natural-sounding TTS provider.
3. More expressive avatar animations or optional lip-sync.
4. Attachment bundles and richer export formats.
5. Advanced per-agent voice and appearance settings.

Do not start Release 4 until the earlier releases are stable, secure, and covered by tests.

---

## 20. Definition of Done

A feature is complete only when:

- [ ] It solves a specific user problem.
- [ ] It fits the existing OmniStudio architecture.
- [ ] It has clear loading, empty, success, and error states.
- [ ] It works with keyboard navigation and responsive layouts.
- [ ] It respects privacy and does not expose credentials.
- [ ] Unsupported browser/model/provider capabilities have a fallback.
- [ ] Server-side validation exists wherever input crosses a trust boundary.
- [ ] Tests have been added or updated.
- [ ] Existing tests pass.
- [ ] Documentation and settings labels are updated.
- [ ] The change is small enough to review and revert independently.

---

## 21. Suggested Task Template for Each Future Update

Use this template when asking an AI coding agent to implement one item:

```text
Implement: [FEATURE NAME] in OmniStudio 1.3.

Rules:
1. Inspect the existing code before editing.
2. Identify the current flow and reuse it; do not duplicate handlers or state.
3. List the exact files you plan to change and why.
4. Keep the change scoped to this feature.
5. Do not invent OmniRoute endpoints or assume model capabilities.
6. Keep secrets on the server and validate untrusted input.
7. Add accessible loading, success, empty, and error states.
8. Add or update tests using the repository's existing test setup.
9. Run the test suite and report the actual results.
10. Summarize changed files, setup steps, limitations, and rollback instructions.

Acceptance criteria:
[PASTE THE FEATURE'S ACCEPTANCE CRITERIA HERE]
```

---

## 22. Final Recommendation

Start with **attachments + paste/drop, message actions, and reliable status controls**. These features improve everyday utility immediately. Add **speech-to-text and text-to-speech using browser APIs** next, then connect avatar states to the real task and speech lifecycle. Only add external voice providers or elaborate animated faces after the core experience is reliable.

This document is a forward-looking implementation backlog, not a claim that these features are already present in OmniStudio 1.3. Each feature must be implemented, tested, and verified against the actual project.
