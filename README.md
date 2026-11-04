# Karaca MD

A WYSIWYG Markdown editor for VS Code by **berkantkaraca**.

## Use

Open a `.md` file with **Karaca MD Editor**.

- **Live:** edit formatted text directly.
- **Source:** edit Markdown code.
- **Split:** view source and preview side by side.
- **Reading:** view the document without editing.

The toolbar supports formatting, lists, tables, links, images, math and Mermaid diagrams.
In Live mode, paste rich text from Confluence or other web pages with **Ctrl+V**.
Headings, bold/italic text, lists, links, tables and code blocks stay formatted.
Use **Ctrl+Shift+V** to paste plain text.
Tables are saved as Markdown pipe tables. Extra empty paragraphs are saved as
blank lines, without HTML tags. Merged cells and visual table styles are flattened.

Hover over a table cell for quick row/column actions, or use the **Table** menu.
Select a full row or column and press **Delete** or **Backspace** to remove it.
Inside a table, **Alt+Shift+↑/↓** inserts a row above/below;
**Alt+Shift+←/→** inserts a column left/right.
Use **Ctrl+S** to save and **Ctrl+F** to find text. Click links to follow them, including table-of-contents links in Live mode.

Use **Image → Choose file…** to select a local image. Images are copied to the
visible `assets/` folder as `img-<timestamp>`. On save, unused generated images
are removed after checking other Markdown files in the workspace (or document folder).
Undo restores removed images from a local recovery copy outside the project.

Git changes are marked against the last commit: green for added content, blue
for modified content and red for deletions. Unsaved edits are included. Source
mode shows line markers; formatted modes show markers beside paragraphs and sections.
Adjacent changes form a continuous line. Working Tree comparisons scroll together.

## Language

English is the default. To use Turkish, open VS Code Settings, search for
**Karaca Md: Language**, and select **tr**. You can also add this to `settings.json`:

```json
"karacaMd.language": "tr"
```

Set it to `"en"` to switch back to English. Changes apply immediately.

## Development

```powershell
npm install
npm run compile
npm test
```

Press **F5** in VS Code to try the extension. The current build is **paket-25**.
