const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const INFO_MESSAGES = {
  "text-editor":
    "Enter a path relative to the current editor or selected directory for the pasted image.",
  directory:
    "Enter a path relative to the current editor or selected directory for the pasted image.",
  terminal: "Enter a path relative to the terminal's working directory for the pasted image.",
};

// A path goes onto a terminal's input line bare whenever it can, because that
// is what both a shell and a prompt-reading program such as an agent CLI accept
// without interpretation. Only whitespace forces the issue, and double quotes
// are the one spelling cmd, PowerShell and every POSIX shell agree on. Inside
// them POSIX still expands four characters, so those are escaped; on Windows
// none of them can appear in a path except `$`, and escaping the separator
// there would break the path outright.
function quoteForShell(filePath) {
  if (!/\s/.test(filePath)) return filePath;
  if (process.platform === "win32") return `"${filePath}"`;
  return `"${filePath.replace(/(["\\$`])/g, "\\$1")}"`;
}

module.exports = class SaveDialog {
  constructor({ nativeImage }) {
    this.nativeImage = nativeImage;

    this.previewElement = document.createElement("div");
    this.previewElement.classList.add("image-paste-preview");

    this.imageElement = document.createElement("img");
    this.imageElement.alt = "Clipboard image preview";
    this.previewElement.appendChild(this.imageElement);

    this.inputDialogView = lumine.workspace.buildInputDialog({
      className: "image-paste save-dialog",
      infoMessage: INFO_MESSAGES["text-editor"],
      contentElement: this.previewElement,
      // The destination path is seeded before the dialog is shown: the query
      // here is the value being edited, not a filter to start empty.
      preserveQuery: true,
      // The dialog clears the warning itself; the pending overwrite has to go
      // with it, or typing away from an existing path and back would skip the
      // confirmation the second visit is supposed to ask for.
      didChangeQuery: () => {
        this.overwritePath = null;
      },
      didConfirm: () => this.confirm(),
      didCancel: () => this.hide(),
    });
    this.miniEditor = this.inputDialogView.refs.queryEditor;
  }

  destroy() {
    this.inputDialogView.destroy();
  }

  prepare({ target, pngBuffer, sourceName = null }) {
    this.target = target;
    this.pngBuffer = Buffer.from(pngBuffer);
    this.saving = false;

    const hash = crypto.createHash("md5").update(this.pngBuffer).digest("hex").slice(0, 8);
    let initialPath;
    if (target.type === "text-editor") {
      const selectedText = target.editor.getSelectedText();
      if (selectedText && !selectedText.includes("\n")) {
        initialPath = selectedText;
      } else {
        const editorName = target.editor.getPath()
          ? path.parse(target.editor.getPath()).name
          : "image";
        initialPath = path.join(
          lumine.config.get("image-paste.assetsDirectory"),
          `${editorName}-${hash}.png`,
        );
      }
    } else {
      initialPath = sourceName || `${hash}.png`;
    }

    initialPath = this.normalizeImagePath(initialPath);
    if (lumine.config.get("image-paste.forwardSlash")) {
      initialPath = initialPath.replace(/\\/g, "/");
    }
    this.miniEditor.setText(initialPath);
    this.inputDialogView.update({
      infoMessage: INFO_MESSAGES[target.type] ?? INFO_MESSAGES["text-editor"],
    });
    this.clearWarning();
    this.imageElement.src = lumine.config.get("image-paste.imagePreview")
      ? `data:image/png;base64,${this.pngBuffer.toString("base64")}`
      : "";
    this.inputDialogView.show();
    this.selectBaseName(initialPath);
  }

  hide() {
    this.inputDialogView.hide();
  }

  clearWarning() {
    this.overwritePath = null;
    this.inputDialogView.update({ status: null });
  }

  warn(message) {
    this.inputDialogView.update({ status: { type: "warning", message } });
  }

  selectBaseName(relativePath) {
    const normalizedPath = relativePath.replace(/\\/g, "/");
    const slashIndex = normalizedPath.lastIndexOf("/");
    const extensionLength = path.extname(normalizedPath).length;
    this.miniEditor.setSelectedBufferRange([
      [0, slashIndex + 1],
      [0, normalizedPath.length - extensionLength],
    ]);
  }

  normalizeImagePath(relativePath) {
    relativePath = String(relativePath)
      .trim()
      .replace(/[<>:"|?*\0]/g, "");
    const extension = path.extname(relativePath).toLowerCase();
    if ([".png", ".jpg", ".jpeg"].includes(extension)) return relativePath;
    if (extension) return relativePath.slice(0, -extension.length) + ".png";
    return relativePath + ".png";
  }

  insertPath(filePath) {
    if (this.target.type === "terminal") {
      // The shell's own working directory drifts as the user cd's, and the
      // terminal only ever knew the one it launched in, so a relative path
      // would resolve against the wrong directory as soon as anyone moved.
      // Absolute is the only spelling that stays true, and it goes in with
      // native separators because that is what the platform's shell reads.
      this.target.model?.paste(quoteForShell(filePath));
      return;
    }

    const editor = this.target.editor;
    if (!editor || editor.isDestroyed()) return;

    const editorDirectory = editor.getPath()
      ? path.dirname(editor.getPath())
      : this.target.basePath;
    let insertionPath = path.relative(editorDirectory, filePath);
    if (lumine.config.get("image-paste.forwardSlash")) {
      insertionPath = insertionPath.replace(/\\/g, "/");
    }
    editor.insertText(insertionPath);
  }

  async confirm() {
    if (this.saving || !this.target || !this.pngBuffer) return;

    let relativePath = this.normalizeImagePath(this.miniEditor.getText());
    if (path.isAbsolute(relativePath)) {
      this.warn("Enter a path relative to the selected project or directory.");
      return;
    }

    const filePath = path.resolve(this.target.basePath, relativePath);
    const pathFromBase = path.relative(this.target.basePath, filePath);
    if (pathFromBase.startsWith(".." + path.sep) || path.isAbsolute(pathFromBase)) {
      this.warn("The image must remain inside the selected project or directory.");
      return;
    }
    if (!path.basename(filePath)) return;

    if (fs.existsSync(filePath) && this.overwritePath !== filePath) {
      this.overwritePath = filePath;
      this.warn("The file already exists. Confirm again to overwrite it.");
      return;
    }

    this.saving = true;
    try {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      const extension = path.extname(filePath).toLowerCase();
      const imageBuffer = [".jpg", ".jpeg"].includes(extension)
        ? this.nativeImage.createFromBuffer(this.pngBuffer).toJPEG(95)
        : this.pngBuffer;
      await fs.promises.writeFile(filePath, imageBuffer);

      this.insertPath(filePath);
      this.hide();
    } catch (error) {
      lumine.notifications.addError("Unable to save the clipboard image.", {
        detail: error.message,
        dismissable: true,
      });
    } finally {
      this.saving = false;
    }
  }
};
