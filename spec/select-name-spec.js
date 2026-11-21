const path = require("node:path");

describe("Selecting the image filename", () => {
  let dialog;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    const { mainModule } = await lumine.packages.activatePackage("image-paste");
    dialog = mainModule.getSaveDialog();
    dialog.prepare({
      target: { type: "directory", basePath: __dirname },
      pngBuffer: Buffer.from("image"),
      sourceName: "figure.draft.png",
    });
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("image-paste");
  });

  async function pressF2() {
    const target = dialog.miniEditor.getElement();
    const event = new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: target });
    Object.defineProperty(event, "path", { value: [target] });
    lumine.keymaps.handleKeyboardEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await flushMicrotasks(10);
    return dialog.miniEditor.getSelectedText();
  }

  it("opens on the base name and uses F2 to include or exclude the extension", async () => {
    expect(dialog.miniEditor.getSelectedText()).toBe("figure.draft");
    expect(await pressF2()).toBe("figure.draft.png");
    expect(await pressF2()).toBe("figure.draft");
    expect(dialog.inputDialogHost.isVisible()).toBe(true);
  });

  it("uses the current path and preserves the directory prefix", async () => {
    const query = path.join("project.v1", "figures", "edited.jpg");
    await dialog.inputDialog.setQuery(query);
    expect(await pressF2()).toBe("edited.jpg");
    expect(await pressF2()).toBe("edited");
    expect(dialog.inputDialog.getQuery()).toBe(query);
  });

  it("keeps the whole filename selected when there is no extension", async () => {
    await dialog.inputDialog.setQuery("project.v1/.image");
    expect(await pressF2()).toBe(".image");
    expect(await pressF2()).toBe(".image");
  });
});
