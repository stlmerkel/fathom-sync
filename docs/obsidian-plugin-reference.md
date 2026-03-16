# Obsidian Plugin Development — Complete Reference

This document is a comprehensive reference for building Obsidian plugins. It covers project setup, build tooling, the Plugin API, UI components, file operations, events, and best practices.

---

## Table of Contents

1. [Project Setup & Build](#1-project-setup--build)
2. [Plugin Anatomy & Lifecycle](#2-plugin-anatomy--lifecycle)
3. [manifest.json Reference](#3-manifestjson-reference)
4. [Commands](#4-commands)
5. [Settings & Data Persistence](#5-settings--data-persistence)
6. [Ribbon Actions](#6-ribbon-actions)
7. [Status Bar](#7-status-bar)
8. [Modals](#8-modals)
9. [Views](#9-views)
10. [Events](#10-events)
11. [Context Menus](#11-context-menus)
12. [Vault API (File Operations)](#12-vault-api-file-operations)
13. [Editor Extensions & CodeMirror 6](#13-editor-extensions--codemirror-6)
14. [Best Practices & Gotchas](#14-best-practices--gotchas)

---

## 1. Project Setup & Build

### Prerequisites

- Git
- Node.js (LTS recommended)
- A code editor (VS Code recommended)
- A **dedicated development vault** — never develop against a vault with real data

### Scaffolding from the Sample Plugin

```bash
# Clone into your dev vault's plugins directory
cd /path/to/dev-vault/.obsidian/plugins
git clone https://github.com/obsidianmd/obsidian-sample-plugin.git my-plugin
cd my-plugin

# Install dependencies
npm install

# Start dev build (watches for changes)
npm run dev
```

Then in Obsidian: **Settings → Community plugins → Enable** your plugin.

### File Structure

```
my-plugin/
├── src/
│   └── main.ts          # Plugin entry point
├── manifest.json         # Plugin metadata (required)
├── package.json          # Node project config
├── tsconfig.json         # TypeScript config
├── esbuild.config.mjs    # Build config
├── main.js               # Compiled output (generated)
└── styles.css            # Optional plugin styles
```

### package.json

Key fields:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "main": "main.js",
  "type": "module",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
    "lint": "eslint src/"
  },
  "dependencies": {
    "obsidian": "latest"
  },
  "devDependencies": {
    "@typescript-eslint/eslint-plugin": "...",
    "@typescript-eslint/parser": "...",
    "esbuild": "...",
    "tslib": "...",
    "typescript": "..."
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "baseUrl": "src",
    "inlineSourceMap": true,
    "inlineSources": true,
    "module": "ESNext",
    "target": "ES6",
    "allowJs": true,
    "noImplicitAny": true,
    "noImplicitThis": true,
    "noImplicitReturns": true,
    "moduleResolution": "node",
    "importHelpers": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "strictNullChecks": true,
    "strictBindCallApply": true,
    "allowSyntheticDefaultImports": true,
    "useUnknownInCatchVariables": true,
    "lib": ["DOM", "ES5", "ES6", "ES7"]
  },
  "include": ["src/**/*.ts"]
}
```

### esbuild.config.mjs

The build config bundles `src/main.ts` → `main.js` in CommonJS format targeting ES2018. Key details:

- **External packages** (not bundled): `obsidian`, `electron`, `@codemirror/*`, and all Node.js builtins
- **Dev mode** (`npm run dev`): watches for changes, inline sourcemaps
- **Production mode** (`npm run build`): single build, no sourcemaps, minified

### Hot Reload

Install the [Hot-Reload plugin](https://github.com/pjeby/hot-reload) in your dev vault for automatic reloading when `main.js` changes. Without it, use the Command Palette: **"Reload app without saving"**.

---

## 2. Plugin Anatomy & Lifecycle

Every plugin extends the `Plugin` base class and implements two lifecycle methods:

```ts
import { Plugin } from 'obsidian';

export default class MyPlugin extends Plugin {
  async onload() {
    // Called when the plugin is activated.
    // Register commands, views, settings, event handlers, etc.
    console.log('Plugin loaded');
  }

  async onunload() {
    // Called when the plugin is deactivated.
    // Release all resources here to avoid performance degradation.
    console.log('Plugin unloaded');
  }
}
```

**Key rules:**

- `onload()` is where you configure all plugin capabilities — commands, views, settings tabs, ribbon icons, event listeners.
- `onunload()` must clean up anything that `onload()` set up. Most `this.register*()` and `this.add*()` methods handle cleanup automatically, but custom DOM listeners or intervals need manual teardown.
- Open the dev console with `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Option+I` (macOS) to see `console.log` output.

---

## 3. manifest.json Reference

This file is **required** in the plugin root. The `id` must match the plugin folder name.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique plugin identifier. **Cannot contain `obsidian`**. Must match the folder name. |
| `name` | string | Display name shown in the UI |
| `version` | string | Semantic version (`x.y.z`) |
| `minAppVersion` | string | Minimum required Obsidian version |
| `description` | string | Short description of the plugin |
| `author` | string | Author's name |
| `isDesktopOnly` | boolean | `true` if the plugin uses NodeJS or Electron APIs |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `authorUrl` | string | URL to the author's website |
| `fundingUrl` | string \| object | Single URL string, or object mapping service names to URLs (e.g. `{"Buy Me a Coffee": "https://..."}`) |

### Example

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "minAppVersion": "1.0.0",
  "description": "Does something useful.",
  "author": "Your Name",
  "isDesktopOnly": false,
  "authorUrl": "https://example.com",
  "fundingUrl": "https://buymeacoffee.com/yourname"
}
```

---

## 4. Commands

Commands are user-invokable actions accessible via the Command Palette (`Ctrl/Cmd+P`) or keyboard shortcuts. Register them in `onload()`.

### Basic Command

```ts
this.addCommand({
  id: 'print-greeting',
  name: 'Print greeting to console',
  callback: () => {
    console.log('Hey, you!');
  },
});
```

### Conditional Command (`checkCallback`)

Runs only when a condition is met. The callback is invoked twice: first with `checking: true` (validate), then with `checking: false` (execute).

```ts
this.addCommand({
  id: 'conditional-command',
  name: 'Conditional command',
  checkCallback: (checking: boolean) => {
    const value = getRequiredValue();
    if (value) {
      if (!checking) {
        doCommand(value);
      }
      return true;
    }
    return false;
  },
});
```

### Editor Command

Only appears when an editor is active. Provides `editor` and `view` parameters.

```ts
this.addCommand({
  id: 'editor-command',
  name: 'Editor command',
  editorCallback: (editor: Editor, view: MarkdownView) => {
    const sel = editor.getSelection();
    console.log(`Selected: ${sel}`);
  },
});
```

For conditional editor commands, use `editorCheckCallback` (same `checking` pattern as above, with `editor` and `view` params).

### Default Hotkeys

```ts
this.addCommand({
  id: 'my-command',
  name: 'My command',
  hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'a' }],
  callback: () => { /* ... */ },
});
```

`Mod` = `Ctrl` on Windows/Linux, `Cmd` on macOS. **Avoid default hotkeys in plugins you plan to share** — they easily conflict with other plugins or system shortcuts.

---

## 5. Settings & Data Persistence

### Define the Settings Interface and Defaults

```ts
interface MyPluginSettings {
  apiKey: string;
  enableFeature: boolean;
}

const DEFAULT_SETTINGS: Partial<MyPluginSettings> = {
  apiKey: '',
  enableFeature: true,
};
```

### Load and Save in the Plugin Class

```ts
export default class MyPlugin extends Plugin {
  settings: MyPluginSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new MyPluginSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
```

**Caveat:** `Object.assign()` does a shallow copy. If your settings have nested objects, you need to deep-copy them manually.

### Build the Settings Tab

```ts
import { App, PluginSettingTab, Setting } from 'obsidian';

export class MyPluginSettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('API Key')
      .setDesc('Your API key for the service')
      .addText((text) =>
        text
          .setPlaceholder('Enter your API key')
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Enable feature')
      .setDesc('Toggle the experimental feature')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableFeature)
          .onChange(async (value) => {
            this.plugin.settings.enableFeature = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
```

### Available Setting Control Types

Text, Textarea, Toggle, Dropdown, Slider, Button, ExtraButton, Color picker, Progress bar, Moment format, Search (via `AbstractInputSuggest`), and Heading (section separator).

---

## 6. Ribbon Actions

The ribbon is the left sidebar icon strip. Add icons to it for quick-access actions.

```ts
this.addRibbonIcon('dice', 'Print to console', () => {
  console.log('Hello, you!');
});
```

Parameters: `(iconId: string, tooltip: string, callback: () => void)`

Icon IDs come from Lucide icons (Obsidian's icon set). Always provide an alternate way to access ribbon functionality (e.g., a command), since users can hide the ribbon.

---

## 7. Status Bar

Adds items to the bottom status bar. **Desktop only — not supported on mobile.**

```ts
async onload() {
  const item = this.addStatusBarItem();
  item.createEl('span', { text: 'Hello from the status bar' });
}
```

Multiple status bar items are automatically spaced apart. Group related elements into a single item to control spacing:

```ts
const item = this.addStatusBarItem();
item.createEl('span', { text: 'Part A' });
item.createEl('span', { text: 'Part B' });
```

---

## 8. Modals

### Basic Modal

```ts
import { App, Modal } from 'obsidian';

export class MyModal extends Modal {
  constructor(app: App) {
    super(app);
    this.setContent('Look at me, I\'m a modal!');
  }
}

// Open it:
new MyModal(this.app).open();
```

### Modal with User Input

```ts
import { App, Modal, Setting, Notice } from 'obsidian';

export class InputModal extends Modal {
  constructor(app: App, onSubmit: (result: string) => void) {
    super(app);
    this.setTitle('Enter your name');

    let name = '';
    new Setting(this.contentEl)
      .setName('Name')
      .addText((text) => text.onChange((value) => { name = value; }));

    new Setting(this.contentEl)
      .addButton((btn) =>
        btn
          .setButtonText('Submit')
          .setCta()
          .onClick(() => {
            this.close();
            onSubmit(name);
          })
      );
  }
}

// Usage:
new InputModal(this.app, (name) => {
  new Notice(`Hello, ${name}!`);
}).open();
```

### SuggestModal (Filterable List)

Implement `getSuggestions()`, `renderSuggestion()`, and `onChooseSuggestion()`:

```ts
import { SuggestModal } from 'obsidian';

interface Book { title: string; author: string; }

export class BookSuggestModal extends SuggestModal<Book> {
  getSuggestions(query: string): Book[] {
    return ALL_BOOKS.filter((b) =>
      b.title.toLowerCase().includes(query.toLowerCase())
    );
  }

  renderSuggestion(book: Book, el: HTMLElement) {
    el.createEl('div', { text: book.title });
    el.createEl('small', { text: book.author });
  }

  onChooseSuggestion(book: Book, evt: MouseEvent | KeyboardEvent) {
    new Notice(`Selected ${book.title}`);
  }
}
```

### FuzzySuggestModal (Built-in Fuzzy Search)

```ts
import { FuzzySuggestModal } from 'obsidian';

export class BookFuzzyModal extends FuzzySuggestModal<Book> {
  getItems(): Book[] { return ALL_BOOKS; }
  getItemText(book: Book): string { return book.title; }
  onChooseItem(book: Book, evt: MouseEvent | KeyboardEvent) {
    new Notice(`Selected ${book.title}`);
  }
}
```

---

## 9. Views

Views display content in workspace leaves (panes). Examples: file explorer, graph view, custom sidebars.

### Define a View

```ts
import { ItemView, WorkspaceLeaf } from 'obsidian';

export const VIEW_TYPE_MY = 'my-custom-view';

export class MyView extends ItemView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_MY;
  }

  getDisplayText(): string {
    return 'My Custom View';
  }

  async onOpen() {
    const container = this.contentEl;
    container.empty();
    container.createEl('h4', { text: 'My Custom View' });
  }

  async onClose() {
    // Clean up resources
  }
}
```

### Register and Activate

```ts
import { Plugin, WorkspaceLeaf } from 'obsidian';
import { MyView, VIEW_TYPE_MY } from './view';

export default class MyPlugin extends Plugin {
  async onload() {
    this.registerView(VIEW_TYPE_MY, (leaf) => new MyView(leaf));

    this.addRibbonIcon('layout-dashboard', 'Open my view', () => {
      this.activateView();
    });
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_MY);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE_MY, active: true });
    }
    workspace.revealLeaf(leaf);
  }
}
```

**Critical:** Never store direct references to view instances. Obsidian may call the view factory multiple times. Always retrieve views dynamically:

```ts
this.app.workspace.getLeavesOfType(VIEW_TYPE_MY).forEach((leaf) => {
  if (leaf.view instanceof MyView) {
    // Access your view instance here
  }
});
```

---

## 10. Events

### Vault and Workspace Events

Use `registerEvent()` for automatic cleanup on unload:

```ts
async onload() {
  // Fires when a file is created
  this.registerEvent(
    this.app.vault.on('create', (file) => {
      console.log('New file:', file.path);
    })
  );

  // Fires when a file is modified
  this.registerEvent(
    this.app.vault.on('modify', (file) => {
      console.log('Modified:', file.path);
    })
  );

  // Fires when the active leaf changes
  this.registerEvent(
    this.app.workspace.on('active-leaf-change', (leaf) => {
      console.log('Active leaf changed');
    })
  );
}
```

### Timed / Interval Events

Use `registerInterval()` with `window.setInterval()`:

```ts
async onload() {
  this.statusBar = this.addStatusBarItem();
  this.updateStatusBar();

  this.registerInterval(
    window.setInterval(() => this.updateStatusBar(), 1000)
  );
}

updateStatusBar() {
  this.statusBar.setText(moment().format('H:mm:ss'));
}
```

Moment.js is available via `import { moment } from 'obsidian';` — no separate install needed.

---

## 11. Context Menus

### Custom Context Menu

```ts
import { Menu } from 'obsidian';

const menu = new Menu();
menu.addItem((item) =>
  item
    .setTitle('Do something')
    .setIcon('star')
    .onClick(() => { console.log('Clicked!'); })
);
menu.showAtMouseEvent(event);
// or: menu.showAtPosition({ x: 20, y: 20 });
```

### Extending Built-in Menus

```ts
// Add item to the file context menu (right-click on file)
this.registerEvent(
  this.app.workspace.on('file-menu', (menu, file) => {
    menu.addItem((item) =>
      item
        .setTitle('My action')
        .setIcon('wand')
        .onClick(() => { console.log(file.path); })
    );
  })
);

// Add item to the editor context menu (right-click in editor)
this.registerEvent(
  this.app.workspace.on('editor-menu', (menu, editor, view) => {
    menu.addItem((item) =>
      item
        .setTitle('My editor action')
        .setIcon('wand')
        .onClick(() => { console.log(view.file?.path); })
    );
  })
);
```

---

## 12. Vault API (File Operations)

### Listing Files

```ts
// All markdown files
const mdFiles = this.app.vault.getMarkdownFiles();

// All files (including attachments, etc.)
const allFiles = this.app.vault.getFiles();
```

### Reading Files

```ts
// Use cachedRead when displaying content (fast, from cache)
const content = await this.app.vault.cachedRead(file);

// Use read when you plan to modify and write back (avoids stale data)
const content = await this.app.vault.read(file);
```

### Writing / Modifying Files

```ts
// Overwrite entire file content
await this.app.vault.modify(file, 'New content here');

// Modify based on current content (atomic read-then-write)
await this.app.vault.process(file, (data) => {
  return data.replace(':)', '🙂');
});
```

`vault.process()` guarantees the file hasn't changed between reading and writing — prefer it over separate `read()` + `modify()` calls.

### Creating Files

```ts
const file = await this.app.vault.create('path/to/new-file.md', 'Initial content');
```

### Deleting Files

```ts
// Permanent delete
await this.app.vault.delete(file);

// Move to trash (recoverable — respects user's trash setting)
await this.app.vault.trash(file, true);  // true = system trash
```

### Type Checking

```ts
import { TFile, TFolder } from 'obsidian';

const item = this.app.vault.getAbstractFileByPath('some/path');
if (item instanceof TFile) {
  console.log('It\'s a file!');
} else if (item instanceof TFolder) {
  console.log('It\'s a folder!');
}
```

**Important:** The Vault API only accesses files visible in the app. Files in hidden folders (like `.obsidian`) require the Adapter API.

---

## 13. Editor Extensions & CodeMirror 6

Obsidian's editor is built on CodeMirror 6. To access the CM6 `EditorView` from a command:

```ts
import { EditorView } from '@codemirror/view';

this.addCommand({
  id: 'my-editor-extension-command',
  name: 'My editor extension command',
  editorCallback: (editor, view) => {
    // @ts-expect-error — not exposed in Obsidian's types
    const editorView = view.editor.cm as EditorView;

    // Access a view plugin instance
    const plugin = editorView.plugin(myViewPlugin);
    if (plugin) {
      plugin.doSomething(editorView);
    }

    // Dispatch state effects
    editorView.dispatch({
      effects: [/* StateEffect instances */],
    });
  },
});
```

---

## 14. Best Practices & Gotchas

1. **Always use a dedicated dev vault.** One mistake can corrupt note data.

2. **Never store view references directly.** Obsidian may recreate views. Use `getLeavesOfType()` to retrieve them dynamically.

3. **Clean up in `onunload()`.** Most `this.register*()` methods auto-cleanup, but custom DOM events, timers, or external connections need manual teardown.

4. **Use `vault.process()` over `read()` + `modify()`** for atomic file modifications.

5. **Status bar is desktop-only.** Don't rely on it for critical mobile functionality.

6. **Avoid default hotkeys in published plugins.** They conflict easily. Let users set their own.

7. **`Object.assign()` for settings is shallow.** Deep-copy nested objects manually if needed.

8. **The `id` in manifest.json must match the plugin folder name** and cannot contain the word `obsidian`.

9. **Use `@ts-expect-error` to access `view.editor.cm`** — it's not part of Obsidian's public types but is the standard way to get the CodeMirror EditorView.

10. **Obsidian re-exports Moment.js** — `import { moment } from 'obsidian';` — no need to add it as a dependency.
