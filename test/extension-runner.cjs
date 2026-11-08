// Runs inside the real VS Code extension host, never in the shipped extension.
const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
exports.run = async () => {
  const directory = process.env.KARACA_HOST_TEST_CHANNEL;
  const file = process.env.KARACA_HOST_TEST_FILE;
  if (!directory || !file) throw new Error("Missing test channel");
  const extension = vscode.extensions.getExtension("berkantkaraca.karaca-md-editor");
  if (!extension) throw new Error("Karaca extension is not registered");
  await extension.activate();
  let gitRepository;
  if (fs.existsSync(path.join(path.dirname(file), ".git"))) {
    const git = await vscode.extensions.getExtension("vscode.git").activate();
    gitRepository = await git.getAPI(1).openRepository(vscode.Uri.file(path.dirname(file)));
    await gitRepository?.status();
  }
  const open = () => vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(file), "karaca.mdEditor", { preview: false });
  await open();
  fs.writeFileSync(path.join(directory, "ready"), "ready");
  for (;;) {
    const commandPath = path.join(directory, "command.json");
    if (fs.existsSync(commandPath)) {
      const command = JSON.parse(fs.readFileSync(commandPath, "utf8")); fs.unlinkSync(commandPath);
      if (command.type === "stop") return;
      if (command.type === "switch-note") {
        const other = path.join(directory, "other.md");
        fs.writeFileSync(other, "# Other note\n");
        await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(other), "karaca.mdEditor", { preview: false });
      }
      if (command.type === "switch-back") await open();
      if (command.type === "open-diff") {
        await vscode.workspace.getConfiguration("workbench").update("diffEditorAssociations", {"*.md":"karaca.mdEditor"}, vscode.ConfigurationTarget.Global);
        const modified = vscode.Uri.file(file);
        const original = modified.with({scheme:"git",query:JSON.stringify({path:modified.fsPath,ref:"HEAD~1"})});
        await vscode.commands.executeCommand("vscode.diff",original,modified,"Working Tree",{preview:false,override:"karaca.mdEditor"});
        fs.writeFileSync(path.join(directory,"diff-open"),"ready");
      }
      if (command.type === "close-diff") {
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor"); await open();
        fs.writeFileSync(path.join(directory,"diff-closed"),"ready");
      }
      if (command.type === "git-status") await gitRepository?.status();
      if (command.type === "git-new-file") {
        const note = path.join(path.dirname(file), "new-note.md"); fs.writeFileSync(note, "# New note\n\nNew paragraph.\n");
        await gitRepository?.status();
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
        await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(note), "karaca.mdEditor");
        fs.writeFileSync(path.join(directory, "new-file-open"), "ready");
      }
      if (command.type === "language") {
        await vscode.workspace.getConfiguration("karacaMd").update("language", command.language, vscode.ConfigurationTarget.Global);
      }
      if (command.type === "reopen") {
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
        await open();
        fs.writeFileSync(path.join(directory, "reopened"), "ready");
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
