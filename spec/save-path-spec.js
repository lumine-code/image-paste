const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { nativeImage } = require("electron");

describe("image-paste save paths", () => {
  let temporaryRoot,
    scratch,
    projectPath,
    basePath,
    previousProjectPaths,
    dialog,
    pngBuffer,
    editor;

  function prepareDirectory(directory = basePath) {
    dialog.prepare({
      target: { type: "directory", basePath: directory },
      pngBuffer,
      sourceName: "image.png",
    });
  }

  async function openDocument() {
    const documentPath = path.join(basePath, "note.txt");
    fs.writeFileSync(documentPath, "");
    editor = await lumine.workspace.open(documentPath);
  }

  function displayPath(filePath) {
    return filePath.split(path.sep).join("/");
  }

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
    projectPath = path.join(scratch, "project");
    basePath = path.join(projectPath, "docs");
    fs.mkdirSync(basePath, { recursive: true });
    previousProjectPaths = lumine.project.getPaths();
    lumine.project.setPaths([]);
    const pack = await lumine.packages.activatePackage("image-paste");
    dialog = pack.mainModule.getSaveDialog();
    pngBuffer = nativeImage
      .createFromDataURL(
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      )
      .toPNG();
    expect(pngBuffer.length).toBeGreaterThan(0);
  });

  afterEach(async () => {
    editor?.destroy();
    editor = null;
    if (lumine.packages.isPackageLoaded("image-paste")) {
      await lumine.packages.deactivatePackage("image-paste");
      await lumine.packages.unloadPackage("image-paste");
    }
    lumine.project.setPaths(previousProjectPaths);
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

  it("prefills a path relative to a sole project root and saves it at the source directory", async () => {
    lumine.project.setPaths([projectPath]);
    prepareDirectory();

    expect(dialog.miniEditor.getText()).toBe("docs/image.png");
    await dialog.confirm();
    expect(fs.readFileSync(path.join(basePath, "image.png"))).toEqual(pngBuffer);
  });

  it("prefills the source root name and allows switching to another root by name", async () => {
    const otherProject = path.join(scratch, "other");
    fs.mkdirSync(otherProject);
    lumine.project.setPaths([projectPath, otherProject]);
    prepareDirectory();

    expect(dialog.miniEditor.getText()).toBe("project/docs/image.png");
    const warn = spyOn(dialog, "warn").and.callThrough();
    dialog.miniEditor.setText("pictures/image.png");
    await dialog.confirm();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(projectPath)).toEqual(["docs"]);

    dialog.miniEditor.setText("other/pictures/image.png");
    await dialog.confirm();
    expect(fs.readFileSync(path.join(otherProject, "pictures", "image.png"))).toEqual(pngBuffer);
    expect(fs.readdirSync(basePath)).toEqual([]);
  });

  it("prefills an absolute path outside the project and accepts a native absolute destination", async () => {
    lumine.project.setPaths([projectPath]);
    prepareDirectory(scratch);

    expect(dialog.miniEditor.getText()).toBe(displayPath(path.join(scratch, "image.png")));
    const absolutePath = path.join(scratch, "elsewhere", "absolute.png");
    dialog.miniEditor.setText(absolutePath);
    await dialog.confirm();
    expect(fs.readFileSync(absolutePath)).toEqual(pngBuffer);
  });

  it("falls back to the sole project root for relative input from outside the project", async () => {
    lumine.project.setPaths([projectPath]);
    prepareDirectory(scratch);

    dialog.miniEditor.setText("pictures/image.png");
    await dialog.confirm();
    expect(fs.readFileSync(path.join(projectPath, "pictures", "image.png"))).toEqual(pngBuffer);
  });

  it("uses an absolute prefill when root names collide and rejects an ambiguous prefix", async () => {
    const firstRoot = path.join(scratch, "first", "shared");
    const secondRoot = path.join(scratch, "second", "shared");
    fs.mkdirSync(firstRoot, { recursive: true });
    fs.mkdirSync(secondRoot, { recursive: true });
    lumine.project.setPaths([firstRoot, secondRoot]);
    prepareDirectory(firstRoot);

    const absolutePrefill = displayPath(path.join(firstRoot, "image.png"));
    expect(dialog.miniEditor.getText()).toBe(absolutePrefill);
    const warn = spyOn(dialog, "warn").and.callThrough();
    dialog.miniEditor.setText("shared/image.png");
    await dialog.confirm();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(firstRoot)).toEqual([]);
    expect(fs.readdirSync(secondRoot)).toEqual([]);

    dialog.miniEditor.setText(absolutePrefill);
    await dialog.confirm();
    expect(fs.readFileSync(path.join(firstRoot, "image.png"))).toEqual(pngBuffer);
  });

  it("rejects a relative path when there is no project root", async () => {
    prepareDirectory();
    const warn = spyOn(dialog, "warn").and.callThrough();
    dialog.miniEditor.setText("image.png");
    await dialog.confirm();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(basePath)).toEqual([]);
  });

  it("accepts a relative parent path like the Tree View move dialog", async () => {
    lumine.project.setPaths([projectPath]);
    prepareDirectory();

    dialog.miniEditor.setText("../image.png");
    await dialog.confirm();
    expect(fs.readFileSync(path.join(scratch, "image.png"))).toEqual(pngBuffer);
    expect(fs.readdirSync(basePath)).toEqual([]);
  });

  it("rejects blank and directory-only paths without creating files", async () => {
    lumine.project.setPaths([projectPath]);
    prepareDirectory();
    const warn = spyOn(dialog, "warn").and.callThrough();

    for (const input of [" ", "docs/", ".", ".."]) {
      dialog.miniEditor.setText(input);
      await dialog.confirm();
    }

    expect(warn).toHaveBeenCalledTimes(4);
    expect(fs.readdirSync(scratch)).toEqual(["project"]);
    expect(fs.readdirSync(projectPath)).toEqual(["docs"]);
    expect(fs.readdirSync(basePath)).toEqual([]);
  });

  if (process.platform === "win32") {
    it("rejects drive-relative and drive-less Windows paths", async () => {
      lumine.project.setPaths([projectPath]);
      prepareDirectory();
      const warn = spyOn(dialog, "warn").and.callThrough();
      const mkdir = spyOn(fs.promises, "mkdir").and.resolveTo();
      const writeFile = spyOn(fs.promises, "writeFile").and.resolveTo();

      for (const input of ["\\image.png", "C:image.png"]) {
        dialog.miniEditor.setText(input);
        await dialog.confirm();
      }

      expect(warn).toHaveBeenCalledTimes(2);
      expect(mkdir).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
    });
  }

  it("suggests assets alongside a document and inserts the final document-relative path", async () => {
    lumine.project.setPaths([projectPath]);
    await openDocument();
    dialog.prepare({ target: { type: "text-editor", editor, basePath }, pngBuffer });

    expect(dialog.miniEditor.getText()).toMatch(/^docs\/assets\/note-[a-f0-9]{8}\.png$/);
    dialog.miniEditor.setText("pictures/new.png");
    await dialog.confirm();
    expect(fs.readFileSync(path.join(projectPath, "pictures", "new.png"))).toEqual(pngBuffer);
    expect(editor.getText()).toBe("../pictures/new.png");
  });

  for (const selectionType of ["document-relative", "absolute"]) {
    it(`preserves a ${selectionType} editor selection when displaying a project-relative path`, async () => {
      lumine.project.setPaths([projectPath]);
      await openDocument();
      const selectedPath = path.join(projectPath, "pictures", "selected.png");
      const originalText = selectionType === "absolute" ? selectedPath : "../pictures/selected.png";
      editor.setText(originalText);
      editor.selectAll();
      dialog.prepare({ target: { type: "text-editor", editor, basePath }, pngBuffer });

      expect(dialog.miniEditor.getText()).toBe("pictures/selected.png");
      await dialog.confirm();
      expect(fs.readFileSync(selectedPath)).toEqual(pngBuffer);
      expect(editor.getText()).toBe("../pictures/selected.png");
    });
  }

  for (const text of ["first\nsecond", "x".repeat(5000)]) {
    it(`does not read a ${text.includes("\n") ? "multiline" : "long"} selection for path prefill`, async () => {
      editor = await lumine.workspace.open();
      editor.setText(text);
      editor.selectAll();
      const read = spyOn(editor, "getSelectedText").and.throwError("unbounded path prefill");
      try {
        expect(() =>
          dialog.prepare({ target: { type: "text-editor", editor, basePath }, pngBuffer }),
        ).not.toThrow();
        expect(read).not.toHaveBeenCalled();
        expect(dialog.miniEditor.getText()).toMatch(/image-.*\.png$/);
      } finally {
        read.and.callThrough();
      }
      expect(editor.getText()).toBe(text);
    });
  }
});
