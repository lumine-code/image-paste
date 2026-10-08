const fs = require("fs");
const os = require("os");
const path = require("path");
const { nativeImage } = require("electron");

describe("image-paste", () => {
  let directoryPath, originalSaveDialog, imagePaste, SaveDialog;

  beforeEach(async () => {
    const pack = await lumine.packages.activatePackage("image-paste");
    // Package activation can replace the module generation after a previous
    // spec unload. Reacquire the live exports instead of retaining a stale
    // top-level require from the discarded generation.
    imagePaste = pack.mainModule;
    SaveDialog = require("../lib/save-dialog");
    directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "image-paste-"));
    originalSaveDialog = imagePaste.saveDialog;
    imagePaste.saveDialog = { prepare: jasmine.createSpy("prepare") };
  });

  afterEach(() => {
    imagePaste.saveDialog = originalSaveDialog;
    // Retries because Windows keeps a directory non-empty until the last handle on a child
    // closes, and `force` swallows only ENOENT.
    fs.rmSync(directoryPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("claims image data and snapshots it before opening the save dialog", async () => {
    const pngBuffer = Buffer.from("png image data");
    spyOn(lumine.clipboard, "readImage").and.returnValue(
      Promise.resolve({
        isEmpty: () => false,
        toPNG: () => pngBuffer,
      }),
    );

    expect(
      await imagePaste.handlePaste({ target: { type: "directory", path: directoryPath } }),
    ).toBe(true);
    expect(imagePaste.saveDialog.prepare).toHaveBeenCalledWith({
      target: { type: "directory", basePath: directoryPath },
      pngBuffer,
    });
  });

  it("falls through when the clipboard does not contain an image", () => {
    spyOn(lumine.clipboard, "readImage").and.returnValue({ isEmpty: () => true });

    expect(imagePaste.handlePaste({ target: { type: "directory", path: directoryPath } })).toBe(
      false,
    );
    expect(imagePaste.saveDialog.prepare).not.toHaveBeenCalled();
  });

  it("explains why an image cannot be pasted into an untitled editor", () => {
    const pngBuffer = Buffer.from("png image data");
    spyOn(lumine.clipboard, "readImage").and.returnValue({
      isEmpty: () => false,
      toPNG: () => pngBuffer,
    });
    spyOn(lumine.notifications, "addWarning");
    lumine.project.setPaths([]);
    const editor = lumine.workspace.buildTextEditor();

    expect(imagePaste.handlePaste({ target: { type: "text-editor", editor } })).toBe(true);
    expect(lumine.notifications.addWarning).toHaveBeenCalledWith(
      "Save the editor or open a project before pasting an image.",
    );
    expect(imagePaste.saveDialog.prepare).not.toHaveBeenCalled();
  });

  describe("the terminal target", () => {
    let model;

    beforeEach(() => {
      model = { paste: jasmine.createSpy("model.paste") };
    });

    it("saves relative to the directory the terminal was launched in", () => {
      const pngBuffer = Buffer.from("png image data");
      spyOn(lumine.clipboard, "readImage").and.returnValue({
        isEmpty: () => false,
        toPNG: () => pngBuffer,
      });

      expect(
        imagePaste.handlePaste({ target: { type: "terminal", model, path: directoryPath } }),
      ).toBe(true);
      expect(imagePaste.saveDialog.prepare).toHaveBeenCalledWith({
        target: { type: "terminal", model, basePath: directoryPath },
        pngBuffer,
      });
    });

    it("writes an absolute path, because the shell may have cd'd away", () => {
      const filePath = path.join(directoryPath, "screenshot.png");

      SaveDialog.prototype.insertPath.call({ target: { type: "terminal", model } }, filePath);

      expect(model.paste).toHaveBeenCalledWith(filePath);
    });

    it("quotes a path a shell would otherwise split", () => {
      const filePath = path.join(directoryPath, "two words.png");

      SaveDialog.prototype.insertPath.call({ target: { type: "terminal", model } }, filePath);

      expect(model.paste).toHaveBeenCalledWith(`"${filePath}"`);
    });

    it("never submits the line it wrote", () => {
      const filePath = path.join(directoryPath, "screenshot.png");

      SaveDialog.prototype.insertPath.call({ target: { type: "terminal", model } }, filePath);

      expect(model.paste.calls.argsFor(0)[0]).not.toMatch(/[\r\n]/);
    });
  });

  it("normalizes unsupported output extensions to PNG", () => {
    expect(SaveDialog.prototype.normalizeImagePath("assets/example.gif")).toBe(
      "assets/example.png",
    );
    expect(SaveDialog.prototype.normalizeImagePath("assets/example.jpg")).toBe(
      "assets/example.jpg",
    );
  });

  it("keeps the preview layout on the model inside its modal host", async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    const dialog = new SaveDialog({ nativeImage });

    try {
      const panelElement = dialog.inputDialogHost.getPanel().getElement();
      expect(panelElement.matches("lumine-panel.modal.image-paste.save-dialog")).toBe(true);
      expect(getComputedStyle(dialog.inputDialog.getElement()).display).toBe("flex");
      expect(getComputedStyle(dialog.previewElement).alignSelf).toBe("center");
    } finally {
      await dialog.destroy();
    }
  });

  it("handles the normal editor paste command through the provider registry", async () => {
    const editorDirectory = path.join(directoryPath, "docs");
    fs.mkdirSync(editorDirectory);
    const editorPath = path.join(editorDirectory, "document.md");
    fs.writeFileSync(editorPath, "");
    lumine.project.setPaths([directoryPath]);
    const editor = await lumine.workspace.open(editorPath);
    const image = nativeImage.createFromDataURL(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    );
    expect(image.isEmpty()).toBe(false);
    // Spied rather than written for real: the round trip to the native
    // clipboard is core's to test, and a spec has no business clobbering the
    // clipboard of whoever is running it.
    spyOn(lumine.clipboard, "readImage").and.returnValue(Promise.resolve(image));

    await lumine.views.getView(editor).pasteText();

    const { target, pngBuffer } = imagePaste.saveDialog.prepare.calls.mostRecent().args[0];
    expect(target.type).toBe("text-editor");
    expect(target.editor).toBe(editor);
    expect(target.basePath).toBe(editorDirectory);
    expect(pngBuffer).toEqual(jasmine.any(Buffer));
  });

  describe("pending image reads", () => {
    const pngData = () =>
      nativeImage
        .createFromDataURL(
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        )
        .toPNG();

    function deferred() {
      let resolve, reject;
      const promise = new Promise((done, fail) => {
        resolve = done;
        reject = fail;
      });
      return { promise, resolve, reject };
    }

    it("does not recreate a dialog after image decoding outlives deactivation", async () => {
      const read = deferred();
      const dialog = imagePaste.saveDialog;
      spyOn(imagePaste, "getSaveDialog").and.returnValue(dialog);
      const pending = imagePaste.prepareImageFile(
        { name: "image.png", arrayBuffer: () => read.promise },
        { type: "directory", basePath: directoryPath },
      );
      await lumine.packages.deactivatePackage("image-paste");
      read.resolve(pngData());
      await pending;
      expect(imagePaste.getSaveDialog).not.toHaveBeenCalled();
      expect(dialog.prepare).not.toHaveBeenCalled();
    });

    it("does not prepare UI after a programmatic clipboard read outlives deactivation", async () => {
      const read = deferred();
      const dialog = imagePaste.saveDialog;
      spyOn(lumine.clipboard, "readImage").and.returnValue(read.promise);
      spyOn(imagePaste, "getSaveDialog").and.returnValue(dialog);
      const pending = imagePaste.handlePaste({
        target: { type: "directory", path: directoryPath },
      });
      await lumine.packages.deactivatePackage("image-paste");
      read.resolve({ isEmpty: () => false, toPNG: pngData });
      await pending;
      expect(imagePaste.getSaveDialog).not.toHaveBeenCalled();
      expect(dialog.prepare).not.toHaveBeenCalled();
    });

    it("keeps a newer image when file decodes finish in reverse order", async () => {
      const first = deferred(),
        second = deferred();
      const target = { type: "directory", basePath: directoryPath };
      const firstPaste = imagePaste.prepareImageFile(
        { name: "first.png", arrayBuffer: () => first.promise },
        target,
      );
      const secondPaste = imagePaste.prepareImageFile(
        { name: "second.png", arrayBuffer: () => second.promise },
        target,
      );
      second.resolve(pngData());
      await secondPaste;
      first.resolve(pngData());
      await firstPaste;
      expect(imagePaste.saveDialog.prepare).toHaveBeenCalledTimes(1);
      expect(imagePaste.saveDialog.prepare.calls.mostRecent().args[0].sourceName).toBe(
        "second.png",
      );
    });

    it("does not offer an image to an editor destroyed during its read", async () => {
      const read = deferred();
      const editor = lumine.workspace.buildTextEditor();
      editor.getBuffer().setPath(path.join(directoryPath, "document.md"));
      spyOn(lumine.clipboard, "readImage").and.returnValue(read.promise);
      const pending = imagePaste.handlePaste({ target: { type: "text-editor", editor } });
      editor.destroy();
      read.resolve({ isEmpty: () => false, toPNG: pngData });
      await pending;
      expect(imagePaste.saveDialog.prepare).not.toHaveBeenCalled();
    });

    it("does not report a rejected decode belonging to a retired activation", async () => {
      const read = deferred();
      const report = spyOn(lumine.notifications, "addError");
      const pending = imagePaste.prepareImageFile(
        { arrayBuffer: () => read.promise },
        { type: "directory", basePath: directoryPath },
      );
      await lumine.packages.deactivatePackage("image-paste");
      read.reject(new Error("Read failed"));
      await pending;
      expect(report).not.toHaveBeenCalled();
    });

    it("passes an empty superseded clipboard read back to text paste", async () => {
      const read = deferred();
      const pngBuffer = pngData();
      spyOn(lumine.clipboard, "readImage").and.returnValues(read.promise, {
        isEmpty: () => false,
        toPNG: () => pngBuffer,
      });
      const context = { target: { type: "directory", path: directoryPath } };
      const firstPaste = imagePaste.handlePaste(context);
      expect(imagePaste.handlePaste(context)).toBe(true);
      read.resolve({ isEmpty: () => true });
      expect(await firstPaste).toBe(false);
      expect(imagePaste.saveDialog.prepare).toHaveBeenCalledTimes(1);
    });

    it("ignores a rejected clipboard read from a retired provider", async () => {
      const read = deferred();
      spyOn(lumine.clipboard, "readImage").and.returnValue(read.promise);
      const pending = imagePaste.handlePaste({
        target: { type: "directory", path: directoryPath },
      });
      await lumine.packages.deactivatePackage("image-paste");
      read.reject(new Error("Clipboard closed"));
      await expectAsync(pending).toBeResolvedTo(false);
    });

    it("passes both concurrent empty clipboard reads through to text paste", async () => {
      const read = deferred();
      spyOn(lumine.clipboard, "readImage").and.returnValues(read.promise, { isEmpty: () => true });
      const context = { target: { type: "directory", path: directoryPath } };
      const first = imagePaste.handlePaste(context);
      expect(imagePaste.handlePaste(context)).toBe(false);
      read.resolve({ isEmpty: () => true });
      expect(await first).toBe(false);
      expect(imagePaste.saveDialog.prepare).not.toHaveBeenCalled();
    });
  });

  it("keeps the newer tree-view provider when an old service edge disconnects", () => {
    const original = imagePaste.treeView;
    const first = {},
      second = {};
    const firstEdge = imagePaste.consumeTreeViewSelection(first);
    const secondEdge = imagePaste.consumeTreeViewSelection(second);
    try {
      firstEdge.dispose();
      expect(imagePaste.treeView).toBe(second);
      secondEdge.dispose();
      expect(imagePaste.treeView).toBeNull();
    } finally {
      firstEdge.dispose();
      secondEdge.dispose();
      imagePaste.treeView = original;
    }
  });

  describe("pending image saves", () => {
    let dialog;

    beforeEach(() => {
      dialog = new SaveDialog({ nativeImage });
    });

    afterEach(() => dialog.destroy());

    it("saves the confirmed bytes and inserts into the original target while a new image is prepared", async () => {
      let finishMkdir;
      spyOn(fs.promises, "mkdir").and.returnValue(
        new Promise((done) => {
          finishMkdir = done;
        }),
      );
      const write = spyOn(fs.promises, "writeFile").and.resolveTo();
      const firstModel = { paste: jasmine.createSpy("first paste") };
      const secondModel = { paste: jasmine.createSpy("second paste") };
      const firstBytes = Buffer.from("first image");
      dialog.prepare({
        target: { type: "terminal", model: firstModel, basePath: directoryPath },
        pngBuffer: firstBytes,
        sourceName: "first.png",
      });
      const pending = dialog.confirm();
      dialog.prepare({
        target: { type: "terminal", model: secondModel, basePath: directoryPath },
        pngBuffer: Buffer.from("second image"),
        sourceName: "second.png",
      });
      const hide = spyOn(dialog, "hide");
      finishMkdir();
      await pending;
      const firstPath = path.join(directoryPath, "first.png");
      expect(write).toHaveBeenCalledOnceWith(firstPath, firstBytes);
      expect(firstModel.paste).toHaveBeenCalledWith(firstPath);
      expect(secondModel.paste).not.toHaveBeenCalled();
      expect(hide).not.toHaveBeenCalled();
    });

    it("does not clear a newer save's in-flight state", async () => {
      let finishFirst, finishSecond;
      const first = new Promise((done) => {
        finishFirst = done;
      });
      const second = new Promise((done) => {
        finishSecond = done;
      });
      const mkdir = spyOn(fs.promises, "mkdir").and.returnValues(first, second);
      spyOn(fs.promises, "writeFile").and.resolveTo();
      const target = { type: "directory", basePath: directoryPath };
      dialog.prepare({ target, pngBuffer: Buffer.from("first"), sourceName: "first.png" });
      const firstSave = dialog.confirm();
      dialog.prepare({ target, pngBuffer: Buffer.from("second"), sourceName: "second.png" });
      const secondSave = dialog.confirm();
      finishFirst();
      await firstSave;
      expect(dialog.saving).toBe(true);
      await dialog.confirm();
      expect(mkdir).toHaveBeenCalledTimes(2);
      finishSecond();
      await secondSave;
      expect(dialog.saving).toBe(false);
    });

    it("does not start writing or touch its target after destruction during mkdir", async () => {
      let finishMkdir;
      spyOn(fs.promises, "mkdir").and.returnValue(
        new Promise((done) => {
          finishMkdir = done;
        }),
      );
      const write = spyOn(fs.promises, "writeFile").and.resolveTo();
      const model = { paste: jasmine.createSpy("paste") };
      dialog.prepare({
        target: { type: "terminal", model, basePath: directoryPath },
        pngBuffer: Buffer.from("image"),
        sourceName: "image.png",
      });
      const pending = dialog.confirm();
      await dialog.destroy();
      finishMkdir();
      await pending;
      expect(write).not.toHaveBeenCalled();
      expect(model.paste).not.toHaveBeenCalled();
    });

    it("writes confirmed images at the same path in confirmation order", async () => {
      let finishFirstMkdir;
      const firstMkdir = new Promise((done) => {
        finishFirstMkdir = done;
      });
      const mkdir = spyOn(fs.promises, "mkdir").and.returnValues(firstMkdir, Promise.resolve());
      const write = spyOn(fs.promises, "writeFile").and.resolveTo();
      const target = { type: "directory", basePath: directoryPath };
      dialog.prepare({ target, pngBuffer: Buffer.from("first"), sourceName: "same.png" });
      const firstSave = dialog.confirm();
      dialog.prepare({ target, pngBuffer: Buffer.from("second"), sourceName: "same.png" });
      const secondSave = dialog.confirm();
      expect(mkdir).toHaveBeenCalledTimes(1);
      finishFirstMkdir();
      await Promise.all([firstSave, secondSave]);
      expect(write.calls.allArgs().map((args) => args[1].toString())).toEqual(["first", "second"]);
    });
  });
});
