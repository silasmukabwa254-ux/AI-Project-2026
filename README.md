# AI Project 2026

Clean workspace for the personal AI assistant project.

## Layout

```text
AI-Project 2026/
  client/
    index.html
    style.css
    script.js
  server/
    server.js
  shared/
    prompts/
      system.md
  assets/
  .env.example
  .gitignore
  README.md
```

## Build flow

1. Create the page shell.
2. Add the chat layout.
3. Wire the message form.
4. Connect the client to the backend `/chat` route.
5. Add memory, voice, and commands after the chat loop feels right.

## Run idea

- Start the server from `server/`.
- Open the app through `http://localhost:3000`.
- The server keeps its state in `server/data/state.json`.
- If `OPENAI_API_KEY` is set, the backend uses the OpenAI Responses API and `OPENAI_MODEL` defaults to `gpt-5.4`.
- If the server is not running yet, the client still falls back to the local prototype logic.
