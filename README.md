# Karaca MD

A WYSIWYG Markdown editor for VS Code by **berkantkaraca**.

## Use

Open a `.md` file with **Karaca MD Editor**.

- **Live:** edit formatted text directly.
- **Source:** edit Markdown code.
- **Split:** view source and preview side by side.
- **Reading:** view the document without editing.

The toolbar supports formatting, lists, tables, links, images, math and Mermaid diagrams.
Use **Ctrl+S** to save and **Ctrl+F** to find text.

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

Press **F5** in VS Code to try the extension. The current build is **paket-14**.
