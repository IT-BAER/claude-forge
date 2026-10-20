# prompt-templates

A prompt template library for Claude Code. It opens a pane where you keep, search and tag your prompt templates, fill in their `{{variables}}`, and put the result into the prompt box, send it, or copy it.

## Install

Pick one way. All three need a new Claude Code session afterwards.

### 1. Plugin marketplace (recommended)

Run this in Claude Code:

```
/plugin marketplace add IT-BAER/claude-forge
/plugin install prompt-templates@claude-forge
```

Or from a normal terminal:

```bash
claude plugin marketplace add IT-BAER/claude-forge
claude plugin install prompt-templates@claude-forge
```

### 2. Copy the folder

```bash
git clone https://github.com/IT-BAER/claude-forge.git
mkdir -p ~/.claude/skills
rm -rf ~/.claude/skills/prompt-templates
cp -r claude-forge/mods/prompt-templates ~/.claude/skills/prompt-templates
```

PowerShell:

```powershell
git clone https://github.com/IT-BAER/claude-forge.git
Remove-Item "$HOME\.claude\skills\prompt-templates" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item claude-forge\mods\prompt-templates "$HOME\.claude\skills\prompt-templates" -Recurse
```

### 3. Try it for one session

```bash
claude --plugin-dir path/to/claude-forge/mods/prompt-templates
```

## Use it

| Command | What it does |
| --- | --- |
| `/prompts` | Open or close the pane |
| `/prompts <name>` | Fill the prompt box with that template. A unique start of the name is enough. A template with variables opens its form in the pane. |

### The list

- The search box matches names, text and tags. Tag buttons filter the list; press a tag again to clear the filter.
- Each template has four actions:

| Action | What it does |
| --- | --- |
| Fill | Replaces the prompt box text with the template |
| Insert | Inserts the template at the cursor and keeps what you typed |
| Send | Sends the template as a prompt at once |
| Copy | Copies the template to the clipboard |

- Edit and Delete sit next to them. Delete asks first.

### Variables

Write `{{name}}` in a template for a value you fill in each time, for example `Review {{file}} for {{topic}}`. A variable name has letters, digits, `-` and `_`. Write `\{{` for literal braces.

When a template has variables, its action opens a form with one field per variable and a preview of the result. Enter in the last field runs the action you chose; the other actions sit below the preview. The form remembers the last value of each variable.

### Editing

New and Edit open the editor: a name field, a tags field (comma separated) and the body editor. The body editor is the one from [`file-explorer`](../file-explorer): syntax colours for Markdown, soft wrap (the Wrap button switches it), undo and redo, find and replace with Ctrl+F and Ctrl+H, and clipboard keys.

Changes stay a draft until you press Save (back to the list) or Ctrl+S (stay in the editor). Cancel, closing the pane and `/prompts` ask before they discard a draft. The editor lists the variables it finds in the body.

### Import and export

Import/Export writes all templates to a JSON file (default `prompt-templates.json` in your user folder) or reads one back. On import, a template with the same name (case does not matter) is replaced or skipped, as you choose. A file with one invalid entry is refused whole.

The file format:

```json
{ "version": 1, "templates": [{ "name": "Review", "tags": ["dev"], "body": "Review {{file}} for {{topic}}" }] }
```

## Storage

Templates live in the mod's own store, a JSON file in your Claude Code configuration folder. They are the same in every session on this computer. They do not sync to other computers: use Export and Import for that, and for backups.

## Requirements

- Claude Code 2.1.x with the mod API, in the desktop app (Code tab) or the terminal. Other surfaces show a short notice.
- Windows for Ctrl+V in the editor, which reads the clipboard with `powershell.exe`. Everything else works on any system.

## Limits

- A template body holds up to 30,000 characters; a name up to 80; up to 10 tags of 30 characters each.
- The whole library is limited to about 3.75 MiB.
- Copy needs a surface with clipboard access. Where there is none, the pane says so.
- The pane needs Claude Code's mod API, which changes between releases. After an upgrade the mod can need an update.

## License

MIT, see the repository root.
