const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { nativeImage } = require("electron");

describe("image-paste relative save path contract", () => {
  let temporaryRoot, scratch, basePath, dialog, pngBuffer, editor;

  beforeEach(async () => {
    jasmine.useRealClock();
    for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"]) {
      spyOn(lumine.shell, method).and.resolveTo();
    }
    spyOn(lumine.application, "openWindow").and.resolveTo();
    spyOn(lumine.clipboard, "readImage").and.throwError(
      "Fixture must not read the native clipboard",
    );
    temporaryRoot = fs.realpathSync.native(os.tmpdir());
    scratch = fs.realpathSync.native(fs.mkdtempSync(path.join(temporaryRoot, "image-path-")));
    basePath = path.join(scratch, "selected");
    fs.mkdirSync(basePath);
    const pack = await lumine.packages.activatePackage("image-paste");
    dialog = pack.mainModule.getSaveDialog();
    pngBuffer = nativeImage
      .createFromDataURL(
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      )
      .toPNG();
    expect(pngBuffer.length).toBeGreaterThan(0);
    dialog.prepare({ target: { type: "directory", basePath }, pngBuffer, sourceName: "image.png" });
  });

  afterEach(async () => {
    editor?.destroy();
    editor = null;
    if (lumine.packages.isPackageLoaded("image-paste")) {
      await lumine.packages.deactivatePackage("image-paste");
      await lumine.packages.unloadPackage("image-paste");
    }
    const target = fs.realpathSync.native(scratch);
    const relative = path.relative(fs.realpathSync.native(temporaryRoot), target);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(".." + path.sep) ||
      path.isAbsolute(relative)
    ) {
      throw new Error("Refusing cleanup outside the owned temporary child");
    }
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });

  it("rejects an entered native absolute path before normalization can change its meaning", async () => {
    const absolutePath = path.join(scratch, "absolute.png");
    const warn = spyOn(dialog, "warn").and.callThrough();
    dialog.miniEditor.setText(absolutePath);
    await dialog.confirm();
    expect(warn).toHaveBeenCalledWith(
      "Enter a path relative to the selected project or directory.",
    );
    expect(fs.readdirSync(basePath)).toEqual([]);
    expect(fs.existsSync(absolutePath)).toBe(false);
  });

  it("retains rejection of a relative parent-directory escape", async () => {
    const escapedPath = path.join(scratch, "escape.png");
    const warn = spyOn(dialog, "warn").and.callThrough();
    dialog.miniEditor.setText(path.join("..", "escape.png"));
    await dialog.confirm();
    expect(warn).toHaveBeenCalledWith(
      "The image must remain inside the selected project or directory.",
    );
    expect(fs.readdirSync(basePath)).toEqual([]);
    expect(fs.existsSync(escapedPath)).toBe(false);
  });

  it("rejects an absolute path selected in a real editor without sanitizing its prefilled query", async () => {
    const absolutePath = path.join(scratch, "selected-absolute.png");
    const documentPath = path.join(basePath, "note.txt");
    fs.writeFileSync(documentPath, "owned document\n");
    editor = await lumine.workspace.open(documentPath);
    editor.setText(absolutePath);
    editor.selectAll();
    const warn = spyOn(dialog, "warn").and.callThrough();
    dialog.prepare({ target: { type: "text-editor", editor, basePath }, pngBuffer });
    await dialog.confirm();
    expect(warn).toHaveBeenCalledWith(
      "Enter a path relative to the selected project or directory.",
    );
    expect(fs.readdirSync(basePath)).toEqual(["note.txt"]);
    expect(fs.existsSync(absolutePath)).toBe(false);
    expect(fs.readFileSync(documentPath, "utf8")).toBe("owned document\n");
    expect(editor.getText()).toBe(absolutePath);
  });

  it("writes an ordinary relative image path with the captured native PNG bytes", async () => {
    dialog.miniEditor.setText(path.join("assets", "ordinary.png"));
    await dialog.confirm();
    expect(fs.readFileSync(path.join(basePath, "assets", "ordinary.png"))).toEqual(pngBuffer);
  });
});
