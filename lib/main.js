const fs = require("fs");
const path = require("path");
const { CompositeDisposable, Disposable } = require("lumine");
const { nativeImage } = require("electron");
let SaveDialog = null;

module.exports = {
  activate() {
    this.disposables = new CompositeDisposable();
    this.saveDialog = null;
    this.pasteProvider = { handlePaste: (context) => this.handlePaste(context) };

    this.disposables.add(
      lumine.pasteProviders.add(this.pasteProvider, { priority: 100 }),
      lumine.commands.add("lumine-text-editor:not([mini])", {
        "image-paste:paste": () => this.pasteIntoActiveEditor(),
      }),
      lumine.commands.add(".tree-view", {
        "image-paste:paste": () => this.pasteIntoSelectedTreePath(),
      }),
    );
  },

  deactivate() {
    this.disposables?.dispose();
    this.saveDialog?.destroy?.();
    this.disposables = null;
    this.saveDialog = null;
    this.pasteProvider = null;
  },

  consumeTreeViewSelection(treeView) {
    this.treeView = treeView;
    return new Disposable(() => {
      this.treeView = null;
    });
  },

  pasteIntoActiveEditor() {
    const editor = lumine.textEditors.getActiveTextEditor();
    if (!editor) return false;
    return this.handlePaste({
      target: { type: "text-editor", editor },
      explicit: true,
    });
  },

  pasteIntoSelectedTreePath() {
    const selectedPath = this.treeView?.selectedPaths()?.[0];
    if (!selectedPath) {
      lumine.notifications.addWarning("Select a tree-view file or directory first.");
      return false;
    }
    return this.handlePaste({
      target: { type: "directory", path: selectedPath },
      explicit: true,
    });
  },

  handlePaste(context) {
    const imageFile = this.imageFileFromDataTransfer(context.clipboardData);
    if (imageFile) {
      const target = this.resolveTarget(context.target);
      if (!target) return this.notifyMissingTarget();
      this.prepareImageFile(imageFile, target);
      return true;
    }

    const image = lumine.clipboard.readImage();
    if (image.isEmpty()) {
      if (context.explicit)
        lumine.notifications.addInfo("The clipboard does not contain an image.");
      return false;
    }

    const pngBuffer = image.toPNG();
    if (pngBuffer.length === 0) return false;
    const target = this.resolveTarget(context.target);
    if (!target) return this.notifyMissingTarget();
    this.getSaveDialog().prepare({ target, pngBuffer });
    return true;
  },

  notifyMissingTarget() {
    lumine.notifications.addWarning("Save the editor or open a project before pasting an image.");
    return true;
  },

  resolveTarget(target) {
    if (target?.type === "text-editor") {
      const { editor } = target;
      const editorPath = editor?.getPath();
      const basePath = editorPath ? path.dirname(editorPath) : lumine.project.getPaths()[0];
      if (!basePath) return null;
      return { type: "text-editor", editor, basePath };
    }

    if (target?.type === "directory" && target.path) {
      let directoryPath = target.path;
      try {
        if (!fs.statSync(directoryPath).isDirectory()) directoryPath = path.dirname(directoryPath);
      } catch {
        return null;
      }
      return { type: "directory", basePath: directoryPath };
    }

    return null;
  },

  imageFileFromDataTransfer(clipboardData) {
    if (!clipboardData) return null;
    const files = Array.from(clipboardData.files || []);
    const directFile = files.find((file) => file.type?.startsWith("image/"));
    if (directFile) return directFile;

    for (const item of Array.from(clipboardData.items || [])) {
      if (item.type?.startsWith("image/") && typeof item.getAsFile === "function") {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
    return null;
  },

  async prepareImageFile(file, target) {
    try {
      const sourceBuffer = Buffer.from(await file.arrayBuffer());
      const image = nativeImage.createFromBuffer(sourceBuffer);
      if (image.isEmpty()) throw new Error("The clipboard image could not be decoded.");
      const pngBuffer = image.toPNG();
      this.getSaveDialog().prepare({ target, pngBuffer, sourceName: file.name });
    } catch (error) {
      lumine.notifications.addError("Unable to read the clipboard image.", {
        detail: error.message,
        dismissable: true,
      });
    }
  },

  getSaveDialog() {
    if (this.saveDialog == null) {
      if (SaveDialog == null) SaveDialog = require("./save-dialog");
      this.saveDialog = new SaveDialog({ nativeImage });
    }
    return this.saveDialog;
  },
};
