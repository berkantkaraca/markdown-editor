// Runs inside the real VS Code extension host, never in the shipped extension.
const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
exports.run = async () => {
  const directory = process.env.KARACA_HOST_TEST_CHANNEL;
  const file = process.env.KARACA_HOST_TEST_FILE;
  if (!directory || !file) throw new Error("Missing test channel");
  const extension = vscode.extensions.getExtension("vibecode.karaca-md-editor");
  if (!extension) throw new Error("Karaca extension is not registered");
  await extension.activate();
  const open = () => vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(file), "karaca.mdEditor");
  await open();
  fs.writeFileSync(path.join(directory, "ready"), "ready");
  for (;;) {
    const commandPath = path.join(directory, "command.json");
    if (fs.existsSync(commandPath)) {
      const command = JSON.parse(fs.readFileSync(commandPath, "utf8")); fs.unlinkSync(commandPath);
      if (command.type === "stop") return;
      if (command.type === "reopen") {
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
        await open();
        fs.writeFileSync(path.join(directory, "reopened"), "ready");
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
