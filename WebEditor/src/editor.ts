import { minimalSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { documentSizeLimit } from "./editor-limits";
import { markdownProjection } from "./markdown-projection-extension";
import { createNativePostMessage, EditorSession } from "./session";
import "./editor.css";

const CSP_NONCE = "noto-web-editor";
const host = document.querySelector<HTMLElement>("#editor");
let session: EditorSession | null = null;
const editable = new Compartment();

if (host === null) {
  throw new Error("Missing #editor mount point");
}

const extensions = [
  minimalSetup,
  markdown(),
  markdownProjection(),
  EditorView.cspNonce.of(CSP_NONCE),
  EditorView.lineWrapping,
  documentSizeLimit(() => session?.rejectOversizedChange()),
  editable.of(EditorView.editable.of(false)),
  EditorView.updateListener.of((update) => {
    for (const transaction of update.transactions) {
      if (transaction.docChanged) session?.recordDocChange(transaction.state.doc.toString());
    }
  }),
];

const makeState = (doc: string) => EditorState.create({ doc, extensions });
const view = new EditorView({
  state: makeState(""),
  parent: host,
});

type NotoWindow = Window & {
  webkit?: { messageHandlers?: { notoBridge?: { postMessage(message: unknown): void } } };
  notoBridge?: {
    bootstrap(command: unknown): { decision: string };
    receive(message: unknown): { decision: string };
  };
};

const bridgeWindow = window as NotoWindow;
const postMessage = createNativePostMessage(bridgeWindow.webkit?.messageHandlers?.notoBridge);
let receive: (message: unknown) => { decision: string };
let bootstrap: (command: unknown) => { decision: string };

if (postMessage === null) {
  host.dataset.bridgeState = "fatal";
  host.setAttribute("aria-label", "Native bridge unavailable");
  receive = () => ({ decision: "rejectUnavailable" });
  bootstrap = () => ({ decision: "rejectUnavailable" });
} else {
  session = new EditorSession({
    editor: {
      getText: () => view.state.doc.toString(),
      replaceDocument: (text) => view.setState(makeState(text)),
      setEditable: (isEditable) => view.dispatch({ effects: editable.reconfigure(EditorView.editable.of(isEditable)) }),
      setAppearance: (appearance) => { document.documentElement.dataset.appearance = appearance; },
    },
    postMessage,
  });
  receive = (message: unknown) => session?.receive(message) ?? { decision: "rejectUnavailable" };
  bootstrap = (command: unknown) => session?.bootstrap(command) ?? { decision: "rejectUnavailable" };
}

bridgeWindow.notoBridge = Object.freeze({ bootstrap, receive });
