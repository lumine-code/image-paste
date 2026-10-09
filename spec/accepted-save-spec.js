const fs = require("fs");
const os = require("os");
const path = require("path");
const { nativeImage } = require("electron");

describe("Confirmed image saves", () => {
  let directory, dialog, saves, releaseMkdir;

  beforeEach(async () => {
    for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"])
      spyOn(lumine.shell, method).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    const pack = await lumine.packages.activatePackage("image-paste");
    dialog = pack.mainModule.getSaveDialog();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "image-paste-confirmed-"));
    saves = [];
    releaseMkdir = null;
  });

  afterEach(async () => {
    releaseMkdir?.();
    await Promise.all(saves);
    if (lumine.packages.isPackageLoaded("image-paste")) {
      await lumine.packages.deactivatePackage("image-paste");
      await lumine.packages.unloadPackage("image-paste");
    }
    const root = fs.realpathSync(os.tmpdir());
    const target = fs.realpathSync(directory);
    if (!target.startsWith(root + path.sep)) throw new Error("Unsafe fixture cleanup path");
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  function imageBytes(colour) {
    const image = nativeImage.createFromDataURL(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    );
    // Distinct valid byte payloads let a second confirmed PNG prove ordering.
    return Buffer.concat([image.toPNG(), Buffer.from(colour)]);
  }

  function pauseFirstMkdir() {
    const mkdir = fs.promises.mkdir.bind(fs.promises);
    const gate = new Promise((resolve) => {
      releaseMkdir = resolve;
    });
    let first = true;
    spyOn(fs.promises, "mkdir").and.callFake(async (...args) => {
      if (first && args[0] === directory) {
        first = false;
        await gate;
      }
      return mkdir(...args);
    });
  }

  it("finishes the confirmed file after package deactivation closes its dialog", async () => {
    const bytes = imageBytes("first");
    dialog.prepare({
      target: { type: "directory", basePath: directory },
      pngBuffer: bytes,
      sourceName: "accepted.png",
    });
    const insert = spyOn(dialog, "insertPath").and.callThrough();
    pauseFirstMkdir();
    saves.push(dialog.confirm());
    await lumine.packages.deactivatePackage("image-paste");
    expect(dialog.destroyed).toBe(true);
    releaseMkdir();
    await Promise.all(saves);
    const destination = path.join(directory, "accepted.png");
    expect(fs.existsSync(destination)).toBe(true);
    if (fs.existsSync(destination)) expect(fs.readFileSync(destination)).toEqual(bytes);
    expect(insert).not.toHaveBeenCalled();
  });

  it("settles already confirmed saves in order after their dialog closes", async () => {
    const target = { type: "directory", basePath: directory };
    const first = imageBytes("first"),
      second = imageBytes("second");
    const write = spyOn(fs.promises, "writeFile").and.callThrough();
    pauseFirstMkdir();
    dialog.prepare({ target, pngBuffer: first, sourceName: "same.png" });
    saves.push(dialog.confirm());
    dialog.prepare({ target, pngBuffer: second, sourceName: "same.png" });
    saves.push(dialog.confirm());
    await lumine.packages.deactivatePackage("image-paste");
    releaseMkdir();
    await Promise.all(saves);
    expect(write.calls.allArgs().map((args) => args[1])).toEqual([first, second]);
    const destination = path.join(directory, "same.png");
    expect(fs.existsSync(destination)).toBe(true);
    if (fs.existsSync(destination)) expect(fs.readFileSync(destination)).toEqual(second);
  });
});
