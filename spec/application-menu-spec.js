const path = require("node:path");

describe("Image paste application menu", () => {
  let main, editor, background, button, tree;

  function attachTree() {
    tree = document.createElement("div");
    tree.classList.add("tree-view");
    lumine.workspace.getElement().appendChild(tree);
  }

  function expectTreePaste(directoryPath, dispatchElement = tree) {
    expect(main.handlePaste).toHaveBeenCalledTimes(1);
    const { target, event, explicit } = main.handlePaste.calls.mostRecent().args[0];
    expect(target).toEqual({ type: "directory", path: directoryPath });
    expect(event.target).toBe(dispatchElement);
    expect(explicit).toBe(true);
  }

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage("image-paste")).mainModule;
    background = await lumine.workspace.open();
    editor = await lumine.workspace.open();
    button = document.createElement("button");
    lumine.workspace.getElement().appendChild(button);
    spyOn(main, "handlePaste").and.returnValue(true);
  });
  afterEach(async () => {
    button.remove();
    tree?.remove();
    tree = null;
    background.destroy();
    editor.destroy();
    await lumine.packages.deactivatePackage("image-paste");
  });
  it("disables pasting from surfaces that handle neither images nor files", async () => {
    button.focus();
    await lumine.commands.dispatch(button, "image-paste:paste");
    expect(main.handlePaste).not.toHaveBeenCalled();
    expect(lumine.commands.canDispatch(button, "image-paste:paste")).toBe(false);
  });
  it("retains the inactive editor that received the command", async () => {
    await lumine.commands.dispatch(background.getElement(), "image-paste:paste");
    expect(main.handlePaste).toHaveBeenCalledOnceWith({
      target: { type: "text-editor", editor: background },
      explicit: true,
    });
  });
  it("pastes beside the primary tree selection when another entry comes first", async () => {
    attachTree();
    const selectedDirectory = path.join(__dirname, "selected");
    const selectedFile = path.join(selectedDirectory, "note.md");
    main.treeView = {
      getSelectionSnapshot: () => ({
        paths: [__dirname, selectedFile],
        primary: { path: selectedFile, kind: "file" },
      }),
      selectedPaths: () => [__dirname, selectedFile],
    };

    expect(lumine.commands.canDispatch(tree, "image-paste:paste")).toBe(true);
    await lumine.commands.dispatch(tree, "image-paste:paste");
    expectTreePaste(selectedDirectory);
  });
  it("keeps legacy tree selection providers usable without reading them for availability", async () => {
    attachTree();
    const selectedPaths = jasmine.createSpy("selectedPaths").and.returnValue([__dirname]);
    main.treeView = { selectedPaths };

    expect(lumine.commands.canDispatch(tree, "image-paste:paste")).toBe(true);
    expect(selectedPaths).not.toHaveBeenCalled();
    await lumine.commands.dispatch(tree, "image-paste:paste");
    expectTreePaste(__dirname);
  });
  it("disables tree paste without a selection and keeps editor paste available", async () => {
    attachTree();
    main.treeView = { getSelectionSnapshot: () => ({ primary: null }) };

    expect(lumine.commands.canDispatch(tree, "image-paste:paste")).toBe(false);
    expect(lumine.commands.canDispatch(editor.element, "image-paste:paste")).toBe(true);
    await lumine.commands.dispatch(tree, "image-paste:paste");
    expect(main.handlePaste).not.toHaveBeenCalled();
  });
  it("handles an editor nested inside the tree only once through the tree owner", async () => {
    attachTree();
    tree.appendChild(editor.element);
    main.treeView = {
      getSelectionSnapshot: () => ({ primary: { path: __dirname, kind: "directory" } }),
    };
    await lumine.commands.dispatch(editor.element, "image-paste:paste");
    expectTreePaste(__dirname, editor.element);
  });
  it("disables image insertion in read-only editors", () => {
    editor.setReadOnly(true);
    expect(lumine.commands.canDispatch(editor.element, "image-paste:paste")).toBe(false);
    lumine.commands.dispatch(editor.element, "image-paste:paste");
    expect(main.handlePaste).not.toHaveBeenCalled();
  });
});
