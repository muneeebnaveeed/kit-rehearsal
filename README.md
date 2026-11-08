# Hackathon kit

[![Use this template](https://img.shields.io/badge/use%20this-template-2ea44f?logo=github)](https://github.com/muneeebnaveeed/hackathon-kit/generate)
![Node 22](https://img.shields.io/badge/node-22-5fa04e?logo=nodedotjs&logoColor=white)
![pnpm 10](https://img.shields.io/badge/pnpm-10-f69220?logo=pnpm&logoColor=white)
![TypeScript 5.9](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)
![Colyseus 0.18](https://img.shields.io/badge/Colyseus-0.18-ff4d4d)
![Vite 8](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)
![Vitest](https://img.shields.io/badge/tested%20with-Vitest-6e9f18?logo=vitest&logoColor=white)
![Biome](https://img.shields.io/badge/lint-Biome-60a5fa?logo=biome&logoColor=white)
![Railway](https://img.shields.io/badge/deploys%20to-Railway-0b0d0e?logo=railway&logoColor=white)

![Two players in the template game: one creates a room, the other joins with its code, and both see the same moves](.github/assets/demo.gif)

A GitHub template for a multiplayer game hackathon. **Organizers: create a repository from this template, then follow [KIT_SETUP.md](KIT_SETUP.md) before the event.**

The hackathon repository: each team builds a real-time multiplayer browser game in `games/team-N/`, on one shared platform in `server/`.

**New here? Start with [GETTING_STARTED.md](GETTING_STARTED.md).** It takes you from a fresh machine to your first merged pull request.

| Part | Technology | Where |
|------|------------|-------|
| Game frontends | **Vite + TypeScript** | `games/team-N/` |
| Multiplayer server | Colyseus 0.18 on Node.js | `server/` |
| Hosting | Railway | see [server/ARCHITECTURE.md](server/ARCHITECTURE.md) |

## Branches

`team-N/<issue>-…` → `feature/team-N` → `main`. Each team merges its work into its own `feature/team-N` branch, and finished work goes into `main` once CI is green. `main` is what is live: every merge into it deploys to production. The details are in [CLAUDE.md](CLAUDE.md#branches).

## Read next

- [GETTING_STARTED.md](GETTING_STARTED.md): set up your machine, start your team's game, make your first change
- [CLAUDE.md](CLAUDE.md): the rules every agent and person follows, including the branch model (the single source of truth; `AGENTS.md` points to it)
- [course/README.md](course/README.md): how the hackathon runs and how work is evaluated
- [server/CLAUDE.md](server/CLAUDE.md): how a game uses the shared platform

```bash
pnpm install
pnpm dev        # template game at http://localhost:5173
```
