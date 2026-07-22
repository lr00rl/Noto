import { EditorState } from "@codemirror/state";
import { isDocumentWithinLimit } from "./session";

export const documentSizeLimit = (onRejected: () => void) => {
  let rejectionPending = false;
  return EditorState.transactionFilter.of((transaction) => {
    if (!transaction.docChanged) return transaction;
    if (isDocumentWithinLimit(transaction.newDoc.toString())) return transaction;
    if (!rejectionPending) {
      rejectionPending = true;
      queueMicrotask(() => {
        rejectionPending = false;
        onRejected();
      });
    }
    return [];
  });
};
