const fs = require("fs");
const os = require("os");
const path = require("path");
const { nativeImage } = require("electron");
const imagePaste = require("../lib/main");
const SaveDialog = require("../lib/save-dialog");

describe("image-paste", () => {
  let directoryPath, originalSaveDialog;

  beforeEach(async () => {
    await lumine.packages.activatePackage("image-paste");
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

  it("claims image data and snapshots it before opening the save dialog", () => {
    const pngBuffer = Buffer.from("png image data");
    spyOn(lumine.clipboard, "readImage").and.returnValue({
      isEmpty: () => false,
      toPNG: () => pngBuffer,
    });

    expect(imagePaste.handlePaste({ target: { type: "directory", path: directoryPath } })).toBe(
      true,
    );
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
    spyOn(lumine.clipboard, "readImage").and.returnValue(image);

    lumine.views.getView(editor).pasteText();

    const { target, pngBuffer } = imagePaste.saveDialog.prepare.calls.mostRecent().args[0];
    expect(target.type).toBe("text-editor");
    expect(target.editor).toBe(editor);
    expect(target.basePath).toBe(editorDirectory);
    expect(pngBuffer).toEqual(jasmine.any(Buffer));
  });
});
