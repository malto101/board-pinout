import { state, updateHistoryButtons } from "./state.js";
import { applyViewTransform, updateSnapToggle } from "./view.js";
import {
  bindUi,
  refresh,
  setLibraryOpen,
  renderLibrary,
  renderSymLegend,
  closeGridPicker,
  setTool,
  setPlaceholderUnderlay,
} from "./ui.js";

/** Boot entry — Vite loads this module from index.html. */
async function boot() {
  bindUi();
  const typesResp = await fetch("/types.bundle.json");
  const typesDoc = await typesResp.json();
  state.types = typesDoc.types || {};
  setLibraryOpen(false);
  renderLibrary();
  renderSymLegend();
  closeGridPicker();
  applyViewTransform();
  updateSnapToggle();
  setTool("select");

  setPlaceholderUnderlay();
  refresh();
  updateHistoryButtons();
}

boot();
