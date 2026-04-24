# Demo Notes

This migration is set up to support a Hacker News post about using the Cursor API to orchestrate a framework migration.

## Story Arc

1. Start with Min's Electron browser architecture and identify the hard center: `WebContentsView`.
2. Add a side-by-side Tauri app under `tauri-min/` so the Electron app remains runnable.
3. Use `scripts/cursor-tauri-director.js` as the cloud-first controller.
4. Let cloud agents work from the DAG in `migration/cursor-agents/tauri-migration-dag.json`.
5. Keep a ledger of agent IDs, run IDs, branches, models, statuses, and validation gates.
6. Merge only green increments into the integration branch.
7. Show both apps side by side: Electron as the baseline, Tauri as the migrating target.

## Local Commands

```text
npm run cursor:director
npm run validate:side-by-side
npm run start:electron
npm run start:tauri
```

## Cloud Agent Command

```text
npm run cursor:director -- --run --task tauri-foundation
```

The cloud command reads `CURSOR_API_KEY` from `.env` or the environment. The script is written to avoid printing secrets.

## What To Screenshot

- The Electron app running from `npm run start:electron`.
- The Tauri migration shell running from `npm run start:tauri`.
- The tab spike section with a prototype URL.
- The cloud director dry-run output showing the DAG.
- The ledger after real cloud runs complete.

## Honest Technical Note

The migration deliberately exposes the hardest truth: a browser app built on Electron `WebContentsView` is not a trivial shell swap. The automation is valuable because it can split the work, validate each merge, and keep a migration ledger while still surfacing the product-level parity gaps.
