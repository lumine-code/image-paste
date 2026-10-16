describe("Image paste application menu", () => {
  let main, editor, background, button, tree;
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
  it("routes a tree-view invocation once to its selected path", async () => {
    tree = document.createElement("div");
    tree.classList.add("tree-view");
    lumine.workspace.getElement().appendChild(tree);
    main.treeView = { selectedPaths: () => [__dirname] };
    await lumine.commands.dispatch(tree, "image-paste:paste");
    expect(main.handlePaste).toHaveBeenCalledOnceWith({
      target: { type: "directory", path: __dirname },
      explicit: true,
    });
  });
  it("handles an editor nested inside the tree only once through the tree owner", async () => {
    tree = document.createElement("div");
    tree.className = "tree-view";
    lumine.workspace.getElement().appendChild(tree);
    tree.appendChild(editor.element);
    main.treeView = { selectedPaths: () => [__dirname] };
    await lumine.commands.dispatch(editor.element, "image-paste:paste");
    expect(main.handlePaste).toHaveBeenCalledOnceWith({
      target: { type: "directory", path: __dirname },
      explicit: true,
    });
  });
  it("disables image insertion in read-only editors", () => {
    editor.setReadOnly(true);
    expect(lumine.commands.canDispatch(editor.element, "image-paste:paste")).toBe(false);
    lumine.commands.dispatch(editor.element, "image-paste:paste");
    expect(main.handlePaste).not.toHaveBeenCalled();
  });
});
