# oterm

Provides an in-context window inside of Obsidian providing a full PowerShell terminal that is compatible with WSL connection.

## Setup

(Filled in as project evolves — install steps, env vars, etc.)

## Project structure

(Filled in as files are created)

## Key details

- Private working files go in `.working/` — never commit these
- Obsidian vault note: `/mnt/c/Users/mgrif/obsidianvaults/Sync Vault/Projects/oterm/oterm.md`

## Publishing rules

This project is PUBLIC.

- **Do not push to origin** unless Griffen explicitly says to push
- **Do not publish** (npm, GitHub Release, etc.) unless Griffen explicitly says to publish
- **Work on feature branches** — never commit WIP directly to main
- **Before any push to main:** verify tests pass, verify no private files staged, verify .gitignore covers .working/ and .claude/
- When in doubt, ask before pushing

## Machine handoff

Before ending a session where work is in progress:
1. Push the current branch to origin (with Griffen's approval)
2. Update the Obsidian vault note with: current branch name, what was completed, what's next
3. The vault note is the handoff document — the next session on any machine reads it first

## Memory

Update memory files as decisions happen — don't batch to session end.
Memory lives at `~/.claude/projects/-home-griffen-projects-oterm/memory/`.
