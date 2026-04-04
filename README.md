# Elyra

Elyra is the personal AI assistant in this workspace.
The local workspace is branded Elyra, and the blast project stays untouched in the parent folder.

## Starter layout

```text
Elyra/
  client/
    index.html
    style.css
    script.js
  server/
    server.js
    data/
  shared/
    prompts/
      system.md
  .env.example
  .gitignore
  README.md
```

## Build order

1. Build the client shell.
2. Wire the message composer.
3. Add a memory, project history, world updates, and activity feed.
4. Sync every state change to SQLite.
5. Add the OpenAI chat bridge so the assistant can use a paid cloud model later.
6. Keep a local Ollama mode available so Elyra can run privately on your machine for now.
7. Keep voice, commands, and richer AI behavior for the next pass.

## Project goal

Build a realistic personal AI assistant that feels natural, remembers useful things, and stays under your control.

## Starter commands

- `/update` stores a real update or past event in the history feed.
- `/remember` stores something that should stay as a memory.
- `/world` stores or reviews current world context.
- `/timeline` reviews the historical world timeline.
- `/summary` shows a quick recap of the latest history and memory.
- `/clear` resets the starter chat state in the browser.

Every major action also appears in the live activity feed so you can see the app update step by step.

When `OPENAI_API_KEY` is set, normal chat messages go through the `/chat` route and use `gpt-5.4` by default. If the key is missing, Elyra switches to the local Ollama path so you can keep using the assistant privately on your own machine.

## How it works now

- The browser still renders immediately for a fast feel.
- Every update also syncs to SQLite in `server/data/ai-project-2026.sqlite`.
- Refreshing the page reloads the latest saved state from the server.
- If the server is offline, the browser cache keeps the app usable until it reconnects.
- The world updates panel is meant for pasted current events until a live news source is connected.
- The client can point to a separate backend URL, so GitHub Pages can host the UI while the API runs elsewhere.

## GitHub Pages setup

If you want the frontend on GitHub Pages and the backend on a separate host:

1. Make this Elyra workspace its own GitHub repository, or move these files into a separate repo before enabling Pages.
2. Deploy the backend to a Node host such as Render, Railway, or Fly.
3. Set the backend URL in `client/config.js`, or open the in-app `Settings` button once the site is live and save the backend URL there.
4. Make sure the backend is reachable over HTTPS.
5. Deploy the `client/` folder to GitHub Pages using the workflow in `.github/workflows/pages.yml`.

The client will call `/state` and `/chat` through the configured backend URL instead of depending on the current page host.

### Turn on Pages in GitHub

1. Open the Elyra repo on GitHub.
2. Go to `Settings` > `Pages`.
3. Under `Build and deployment`, choose `GitHub Actions`.
4. Push to `main` or run the `Deploy GitHub Pages` workflow from the `Actions` tab.
5. Copy the Pages URL GitHub shows after the deployment finishes.

## Run it locally

From the `Elyra/server` folder:

```powershell
npm start
```

Then open `http://localhost:3001`.

If you want one-click startup on Windows, run `start-ai-project.bat` from the project root. It starts the server and opens the browser automatically.

For the private local mode, install Ollama, pull a model such as `llama3.2:1b`, and leave `OPENAI_API_KEY` empty. The backend will use the local model automatically and can fall back to any already-installed Ollama model, including `llama3.2:latest`, if the smaller one is still pulling.

To switch back to the cloud model later, set `OPENAI_API_KEY` in your environment or `.env` file before starting the server.

On Windows, Ollama can be installed with the official installer or by running `irm https://ollama.com/install.ps1 | iex` in PowerShell. After install, the API runs on `http://localhost:11434`.

## Deployment notes

- `client/config.js` is the small deployment config file for the frontend.
- `CORS_ORIGIN` can stay `*` for quick testing, or be set to your GitHub Pages origin if you want to lock it down.
- The frontend does not need the backend host to be the same origin anymore.
- The repo root now has a `package.json`, so a host like Railway can run the backend from the whole repo with `npm start`.
- The backend still stores its SQLite file in `server/data/ai-project-2026.sqlite`, so add a persistent volume on the host if you want the history to survive restarts.
- If you use Railway, mount the volume at `/app/server/data` so the SQLite file stays in the right place.
