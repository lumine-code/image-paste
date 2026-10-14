// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: ["language-gfm"],
  viewport: { width: 1100, height: 620 },
  async before() {},
  async prepare(context) {
    const { lumine, state, fixture, open } = context;
    state.editor = await open("image-paste/README.md");
    await lumine.project.setPaths([fixture("image-paste")]);
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Paste a real plot image into the project and choose its relative filename.",
      timeout: 60000,
      async run(context) {
        const { lumine, state, fixture } = context;
        {
          state.editor.moveToBottom();
          const bytes = require("fs").readFileSync(fixture("data/waveform.png"));
          const transfer = new DataTransfer();
          transfer.items.add(new File([bytes], "signal.png", { type: "image/png" }));
          state.editor.getElement().focus();
          lumine.packages.getActivePackage("image-paste").mainModule.handlePaste({
            target: { type: "text-editor", editor: state.editor },
            clipboardData: transfer,
            explicit: true,
          });
        }
      },
      ready() {
        return Boolean(document.querySelector(".image-paste"));
      },
    },
  ],
  async cleanup() {},
};
