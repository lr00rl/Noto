import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import "./editor.css";

const CSP_NONCE = "noto-web-editor";
const host = document.querySelector<HTMLElement>("#editor");

if (host === null) {
  throw new Error("Missing #editor mount point");
}

new EditorView({
  doc: "",
  extensions: [
    basicSetup,
    markdown(),
    EditorView.cspNonce.of(CSP_NONCE),
    EditorView.lineWrapping,
  ],
  parent: host,
});
