# image-paste

Paste clipboard images into projects as image files.

## Features

- **Native clipboard support**: reads standard image data from clipboard events with an Electron fallback.
- **Safe relative paths**: saves images inside the editor's directory or selected tree-view directory.
- **Automatic naming**: suggests stable names based on the document and image content.
- **Editor integration**: inserts a relative path only after the image is written successfully.
- **Tree-view integration**: saves images into the selected directory without replacing tree-view's internal clipboard.
- **Terminal integration**: writes an absolute, shell-safe path onto a terminal's input line.

## Installation

To install `image-paste` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/image-paste`.

## Commands

Commands available in `lumine-text-editor:not([mini])`:

- `image-paste:paste`: save the clipboard image and insert its relative path.

Commands available in `.tree-view`:

- `image-paste:paste`: save the clipboard image in the selected directory.

## Usage

Copy an image, invoke the normal paste command or `image-paste:paste`, review the suggested path, and confirm the save. Editor paths are relative to the current document's directory; tree-view paths remain relative to the selected directory. PNG, JPG, and JPEG output names are supported; other extensions are converted to PNG.

Pasting into a terminal saves relative to the directory that terminal was launched in, then writes the saved file's **absolute** path onto the input line — the shell may have cd'd elsewhere since, and only an absolute path stays true. It is quoted only when it contains whitespace, and never followed by a newline, so nothing is submitted for you. This is the form command-line programs read an image in, including coding agents that take one by path.

## Customization

Customize the modal with CSS and package custom properties:

```css
.image-paste.save-dialog {
  max-width: 52rem;
  --image-paste-preview-max-height: 24rem;
}
```

## Services

- `tree-view.selection`: consumed to locate the selected directory for explicit image paste commands.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
