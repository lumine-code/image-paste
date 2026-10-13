describe("clipboard image dialogs in editor windows", () => {
  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("image-paste");
  });
  afterEach(async () => {
    await lumine.packages.deactivatePackage("image-paste");
    await lumine.workspace.discardEditorWindows();
  });
  it("shares write ordering while keeping pending images and their paths local", async () => {
    const workspace = lumine.workspace;
    const main = lumine.packages.getActivePackage("image-paste").mainModule;
    const first = await workspace.open();
    const extra = await workspace.openEditorWindow({ show: false });
    const second = workspace.buildTextEditor();
    extra.getEditorContainer().getActivePane().activateItem(second, { activatePane: true });
    const local = main.getSaveDialog(workspace.getMainWindow());
    const remote = main.getSaveDialog(extra);
    const target = (editor) => ({ type: "text-editor", editor, basePath: __dirname });
    local.prepare({ target: target(first), pngBuffer: Buffer.from("first") });
    remote.prepare({ target: target(second), pngBuffer: Buffer.from("second") });
    local.inputDialog.setQuery("first.png");
    remote.inputDialog.setQuery("second.png");
    expect(local.inputDialogHost.isVisible()).toBe(true);
    expect(remote.inputDialogHost.isVisible()).toBe(true);
    expect(remote.inputDialog.getElement().ownerDocument).toBe(extra.getDocument());
    expect(local.inputDialog.getQuery()).toBe("first.png");
    expect(remote.inputDialog.getQuery()).toBe("second.png");
    expect(local.pendingSaves).toBe(remote.pendingSaves);
    const localRequest = main.createPasteRequest({ editor: first });
    const remoteRequest = main.createPasteRequest({ editor: second });
    main.pasteRequests.set(extra, remoteRequest);
    expect(main.isCurrentPaste(localRequest)).toBe(true);
    await workspace.attachWindow(extra);
    expect(main.isCurrentPaste(remoteRequest)).toBe(false);
    expect(main.dialogs.has(extra)).toBe(false);
  });
});
