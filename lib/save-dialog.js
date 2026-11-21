const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const MAX_PATH_PREFILL_UNITS = 4096;

const isWindows = process.platform === "win32";
const pathSeparator = isWindows ? /[\\/]/ : /\//;
const trailingSeparator = isWindows ? /[\\/]$/ : /\/$/;
const ABSOLUTE_PATH_PROMPT = "Enter an absolute path for the pasted image.";
const PROJECT_PATH_PROMPT = "Enter a path relative to the project root, or an absolute path.";
const MULTI_ROOT_PROMPT =
  "Start the path with a unique project folder name, or enter an absolute path.";

function rootsNamed(projectPaths, name) {
  const key = isWindows ? name.toLowerCase() : name;
  return projectPaths.filter((root) => {
    const rootName = path.basename(root);
    return (isWindows ? rootName.toLowerCase() : rootName) === key;
  });
}

function displayPath(filePath) {
  return isWindows && lumine.config.get("image-paste.forwardSlash")
    ? filePath.replace(/\\/g, "/")
    : filePath;
}

function hasFileName(filePath) {
  const name = path.basename(filePath);
  return Boolean(name && name !== "." && name !== ".." && !trailingSeparator.test(filePath));
}

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
  constructor({
    nativeImage,
    window = lumine.workspace.getMainWindow(),
    pendingSaves = new Map(),
  }) {
    const document = window.getDocument();
    this.nativeImage = nativeImage;
    this.generation = 0;
    this.destroyed = false;
    this.pendingSaves = pendingSaves;

    this.previewElement = document.createElement("div");
    this.previewElement.classList.add("image-paste-preview");

    this.imageElement = document.createElement("img");
    this.imageElement.alt = "Clipboard image preview";
    this.previewElement.appendChild(this.imageElement);

    this.inputDialogHost = lumine.workspace.addInputDialog(
      {
        infoMessage: ABSOLUTE_PATH_PROMPT,
        contentElement: this.previewElement,
        commands: {
          "image-paste:save-image": {
            description: "Save the clipboard image at the entered path.",
            didDispatch: () => this.confirm(),
          },
          "image-paste:select-name": {
            description: "Select the full filename, or the filename without its extension.",
            didDispatch: () => this.selectName(),
          },
        },
        actions: [
          {
            command: "image-paste:save-image",
            context: "dialog",
            primary: true,
            // Validation and the first overwrite warning keep the dialog open;
            // confirm() closes it only after the image was written successfully.
            disposition: "stay",
            dispatch: "local",
          },
          {
            command: "image-paste:select-name",
            context: "dialog",
            disposition: "stay",
            dispatch: "local",
          },
        ],
      },
      { className: "image-paste save-dialog", window },
    );
    this.inputDialog = this.inputDialogHost.getModel();
    // The dialog clears the warning itself; the pending overwrite has to go
    // with it, or typing away from an existing path and back would skip the
    // confirmation the second visit is supposed to ask for.
    this.inputDialog.onDidChangeQuery(() => {
      this.overwritePath = null;
    });
    this.miniEditor = this.inputDialog.getQueryEditor();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation++;
    this.target = null;
    this.pngBuffer = null;
    return this.inputDialogHost.destroy();
  }

  prepare({ target, pngBuffer, sourceName = null }) {
    if (this.destroyed) return;
    this.generation++;
    this.target = target;
    this.pngBuffer = Buffer.from(pngBuffer);
    this.saving = false;
    this.projectPaths = lumine.project.getPaths();

    const hash = crypto.createHash("md5").update(this.pngBuffer).digest("hex").slice(0, 8);
    let initialPath;
    if (target.type === "text-editor") {
      const range = target.editor.getSelectedBufferRange();
      const selectedText =
        range.isSingleLine() && range.end.column - range.start.column <= MAX_PATH_PREFILL_UNITS
          ? target.editor.getSelectedText().trim()
          : "";
      if (hasFileName(selectedText) && !/[\r\n]/.test(selectedText)) {
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
      initialPath = (sourceName && path.basename(sourceName)) || `${hash}.png`;
    }

    initialPath = this.normalizeImagePath(initialPath);
    if (target.basePath && !path.parse(initialPath).root) {
      initialPath = path.resolve(target.basePath, initialPath);
    }
    initialPath = displayPath(this.formatSuggestedPath(initialPath));
    this.inputDialog.setInfoMessage(
      this.projectPaths.length > 1
        ? MULTI_ROOT_PROMPT
        : this.projectPaths.length === 1
          ? PROJECT_PATH_PROMPT
          : ABSOLUTE_PATH_PROMPT,
    );
    this.clearWarning();
    const showPreview = lumine.config.get("image-paste.imagePreview");
    this.previewElement.hidden = !showPreview;
    this.imageElement.src = showPreview
      ? `data:image/png;base64,${this.pngBuffer.toString("base64")}`
      : "";
    this.inputDialogHost.show({ query: initialPath, selectQuery: false });
    this.selectBaseName(initialPath);
  }

  hide() {
    this.inputDialogHost.hide();
  }

  clearWarning() {
    this.overwritePath = null;
    this.inputDialog.clearStatus();
  }

  warn(message) {
    this.inputDialog.setStatus({ type: "warning", message });
  }

  nameRanges(filePath) {
    const start = Math.max(filePath.lastIndexOf(path.sep), filePath.lastIndexOf("/")) + 1;
    const extensionLength = path.extname(filePath.slice(start)).length;
    return {
      name: [
        [0, start],
        [0, filePath.length],
      ],
      baseName: [
        [0, start],
        [0, filePath.length - extensionLength],
      ],
    };
  }

  selectBaseName(filePath) {
    this.miniEditor.setSelectedBufferRange(this.nameRanges(filePath).baseName);
  }

  selectName() {
    if (!this.inputDialog.getQueryStatus().available) return;
    const { name, baseName } = this.nameRanges(this.inputDialog.getQuery());
    const selection = this.miniEditor.getSelectedBufferRange();
    this.miniEditor.setSelectedBufferRange(selection.isEqual(name) ? baseName : name);
  }

  normalizeImagePath(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    if ([".png", ".jpg", ".jpeg"].includes(extension)) return filePath;
    if (extension) return filePath.slice(0, -extension.length) + ".png";
    return filePath + ".png";
  }

  formatSuggestedPath(filePath) {
    if (!path.isAbsolute(filePath)) return filePath;

    const [root, relative] = lumine.project.relativizePath(filePath);
    if (!root) return filePath;
    if (this.projectPaths.length === 1) return relative;

    const name = path.basename(root);
    return name && rootsNamed(this.projectPaths, name).length === 1
      ? path.join(name, relative)
      : filePath;
  }

  resolveSavePath(query) {
    if (!hasFileName(query)) {
      this.warn("Enter a file name for the pasted image.");
      return null;
    }
    let root;
    if (path.isAbsolute(query)) {
      root = path.parse(query).root;
      query = query.slice(root.length);
      if (isWindows && root.length === 1) {
        this.warn("Enter a full absolute path including the drive or network share.");
        return null;
      }
    } else if (this.projectPaths.length === 1) {
      [root] = this.projectPaths;
    } else if (this.projectPaths.length > 1) {
      const separator = query.search(pathSeparator);
      const matches = separator > 0 ? rootsNamed(this.projectPaths, query.slice(0, separator)) : [];
      if (matches.length === 1) {
        [root] = matches;
        query = query.slice(separator + 1);
      }
    }

    if (!root) {
      this.warn(this.projectPaths.length > 1 ? MULTI_ROOT_PROMPT : ABSOLUTE_PATH_PROMPT);
      return null;
    }

    if (query.includes("\0") || (isWindows && /[<>:"|?*]/.test(query))) {
      this.warn("The image path contains an invalid character.");
      return null;
    }

    return path.join(root, this.normalizeImagePath(query));
  }

  insertPath(filePath, target = this.target) {
    if (target.type === "terminal") {
      // The shell's own working directory drifts as the user cd's, and the
      // terminal only ever knew the one it launched in, so a relative path
      // would resolve against the wrong directory as soon as anyone moved.
      // Absolute is the only spelling that stays true, and it goes in with
      // native separators because that is what the platform's shell reads.
      target.model?.paste(quoteForShell(filePath));
      return;
    }

    const editor = target.editor;
    if (!editor || editor.isDestroyed() || editor.isReadOnly?.()) return;

    const editorDirectory = editor.getPath() ? path.dirname(editor.getPath()) : target.basePath;
    const insertionPath = editorDirectory ? path.relative(editorDirectory, filePath) : filePath;
    editor.insertText(displayPath(insertionPath));
  }

  async confirm() {
    if (this.destroyed || this.saving || !this.target || !this.pngBuffer) return;
    const target = this.target;
    if (
      target.type === "text-editor" &&
      (target.editor.isDestroyed() || target.editor.isReadOnly?.())
    ) {
      this.warn("The target editor is closed or read-only.");
      return;
    }
    const pngBuffer = this.pngBuffer;
    const generation = this.generation;

    const filePath = this.resolveSavePath(this.miniEditor.getText().trim());
    if (!filePath) return;

    if (fs.existsSync(filePath) && this.overwritePath !== filePath) {
      this.overwritePath = filePath;
      this.warn("The file already exists. Confirm again to overwrite it.");
      return;
    }

    this.saving = true;
    const saveKey = process.platform === "win32" ? filePath.toLowerCase() : filePath;
    const previousSave = this.pendingSaves.get(saveKey);
    // A later confirmed image at the same path must be written after its
    // predecessor, even when the first mkdir or write is still pending.
    const pendingSave = (async () => {
      if (previousSave) await previousSave.catch(() => {});
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      const extension = path.extname(filePath).toLowerCase();
      const imageBuffer = [".jpg", ".jpeg"].includes(extension)
        ? this.nativeImage.createFromBuffer(pngBuffer).toJPEG(95)
        : pngBuffer;
      await fs.promises.writeFile(filePath, imageBuffer);
    })();
    this.pendingSaves.set(saveKey, pendingSave);
    try {
      await pendingSave;
      if (this.destroyed) return;
      this.insertPath(filePath, target);
      if (this.generation === generation) this.hide();
    } catch (error) {
      if (this.destroyed) return;
      lumine.notifications.addError("Unable to save the clipboard image.", {
        detail: error.message,
        dismissable: true,
      });
    } finally {
      if (this.pendingSaves.get(saveKey) === pendingSave) this.pendingSaves.delete(saveKey);
      if (this.generation === generation) this.saving = false;
    }
  }
};
