const fs = require("fs");
const path = require("path");
const { CompositeDisposable, Disposable } = require("lumine");
const { nativeImage } = require("electron");
let SaveDialog = null;

module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "image-paste",
      tips: [
        "{% if keys['image-paste:paste'] %}You can paste an image from the clipboard into the project with {{ 'image-paste:paste' | keystroke }}{% else %}You can paste an image from the clipboard straight into the project and have its relative path inserted.{% endif %}",
      ],
    };
  },

  activate() {
    this.disposables = new CompositeDisposable();
    this.saveDialog = null;
    this.pasteRequest = null;
    this.pasteSequence = 0;
    this.pasteProvider = { handlePaste: (context) => this.handlePaste(context) };

    this.disposables.add(
      lumine.pasteProviders.add(this.pasteProvider, { priority: 100 }),
      lumine.commands.add("lumine-text-editor:not([mini])", {
        "image-paste:paste": {
          description: "Save the clipboard image beside the file and link to it.",
          didDispatch: () => this.pasteIntoFocusedEditor(),
        },
      }),
      lumine.commands.add(".tree-view", {
        "image-paste:paste": {
          description: "Save the clipboard image beside the file and link to it.",
          didDispatch: () => this.pasteIntoSelectedTreePath(),
        },
      }),
    );
  },

  deactivate() {
    this.pasteRequest = null;
    this.disposables?.dispose();
    this.saveDialog?.destroy?.();
    this.disposables = null;
    this.saveDialog = null;
    this.pasteProvider = null;
    this.treeView = null;
  },

  consumeTreeViewSelection(treeView) {
    this.treeView = treeView;
    return new Disposable(() => {
      if (this.treeView === treeView) this.treeView = null;
    });
  },

  pasteIntoFocusedEditor() {
    const editor = lumine.workspace.getFocusedTextEditor({ includeMini: false });
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
    if (!this.disposables) return false;
    if (!["text-editor", "terminal", "directory"].includes(context.target?.type)) return false;
    if (context.target.editor?.isDestroyed()) return false;
    const request = this.createPasteRequest({ ...context.target });
    const imageFile = this.imageFileFromDataTransfer(context.clipboardData);
    if (imageFile) {
      const target = this.resolveTarget(request.target);
      if (!target) return this.notifyMissingTarget();
      this.prepareImageFile(imageFile, target, request);
      return true;
    }

    // ClipboardEvent data is valid only during the event. If it contained no
    // image, pass synchronously; programmatic pastes can await Electron 44's
    // Promise-based clipboard through the Lumine API.
    if (context.clipboardData) return false;

    const didRead = lumine.clipboard.readImage();
    return didRead != null && typeof didRead.then === "function"
      ? didRead.then(
          (image) => this.handleNativeImage(image, context, request),
          (error) => {
            if (this.isCurrentPaste(request)) throw error;
            return false;
          },
        )
      : this.handleNativeImage(didRead, context, request);
  },

  createPasteRequest(target) {
    return { target, owner: this.disposables, sequence: ++this.pasteSequence };
  },

  isCurrentPaste(request) {
    return (
      this.disposables != null &&
      this.disposables === request.owner &&
      (!this.pasteRequest || this.pasteRequest.sequence <= request.sequence) &&
      !request.target?.editor?.isDestroyed()
    );
  },

  handleNativeImage(image, context, request) {
    if (image.isEmpty()) {
      if (context.explicit && this.isCurrentPaste(request))
        lumine.notifications.addInfo("The clipboard does not contain an image.");
      return false;
    }
    // Only images retire earlier image work. Empty reads still fall through
    // to ordinary text paste, including concurrent or retired requests.
    if (!this.isCurrentPaste(request)) return true;
    const pngBuffer = image.toPNG();
    if (pngBuffer.length === 0) return false;
    this.pasteRequest = request;
    const target = this.resolveTarget(request.target);
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

    if (target?.type === "terminal" && target.model) {
      // A terminal's `path` is the directory it was launched in. It is the only
      // location the terminal knows about, and it is what the shell's own
      // relative paths were resolved against before the user cd'd anywhere.
      const basePath = target.path || lumine.project.getPaths()[0];
      if (!basePath) return null;
      return { type: "terminal", model: target.model, basePath };
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

  async prepareImageFile(file, target, request) {
    if (!this.disposables) return;
    request ??= this.createPasteRequest(target);
    if (!this.isCurrentPaste(request)) return;
    this.pasteRequest = request;
    try {
      const sourceBuffer = Buffer.from(await file.arrayBuffer());
      if (!this.isCurrentPaste(request)) return;
      const image = nativeImage.createFromBuffer(sourceBuffer);
      if (image.isEmpty()) throw new Error("The clipboard image could not be decoded.");
      const pngBuffer = image.toPNG();
      this.getSaveDialog().prepare({ target, pngBuffer, sourceName: file.name });
    } catch (error) {
      if (!this.isCurrentPaste(request)) return;
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
