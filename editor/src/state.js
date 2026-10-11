/** Mutable app state, DOM refs, library catalog, history helpers. */

export const state = {
  documentMode: "board", // "board" | "soc"
  board: {
    schema_version: "1.0",
    board: "new_board",
    soc: "",
    faces: {
      top: {
        underlay: "",
        children: [],
      },
    },
  },
  socTable: {
    schema_version: "1.0",
    soc: "new_soc",
    description: "",
    pads: {},
  },
  types: {},
  selectedId: null,
  selectedIds: new Set(),
  treeOpen: {},
  previewMode: false,
  drillStack: [],
  underlayObjectUrl: null,
  underlayFileName: null, // filename paired with underlayObjectUrl
  hasUnderlay: false,
  tool: "select", // "select" | "hand" — draw.io style
  spacePan: false, // temporary hand while Space held
  draggingId: null,
  draggingKind: null, // "point" | "label"
  treeDragIds: null,
  search: "",
  marquee: null,
  renaming: false,
  libraryOpen: false,
  libraryPick: null, // active group template for size picker
  gridRows: 1,
  gridCols: 1,
  gridExtent: 8, // visible matrix size (grows toward 15)
  view: { zoom: 1, x: 0, y: 0, rotation: 0 },
  snap: true,
  snapStep: 0.025,
  snapObjects: true, // align to other points / labels while dragging
  alignGuides: null, // { x, y } norm coords while dragging, or null
  peripheralFilter: "", // mux peripheral id to highlight on canvas
  placingLeaderVertexFor: null, // part id awaiting canvas click
  draggingVertex: null, // { id, index }
  skipNextCanvasClick: false, // after marquee / pan so click doesn't clear or open file dialog
};
export const GRID_EXTENT_START = 8;
export const GRID_EXTENT_CAP = 15;

export const history = {
  past: [],
  future: [],
  max: 80,
  pausing: false,
};
export const els = {
  documentMode: document.getElementById("documentMode"),
  boardName: document.getElementById("boardName"),
  boardSoc: document.getElementById("boardSoc"),
  boardSocPackage: document.getElementById("boardSocPackage"),
  boardSocPackages: document.getElementById("boardSocPackages"),
  boardSocLoadBtn: document.getElementById("boardSocLoadBtn"),
  boardSocInput: document.getElementById("boardSocInput"),
  boardSocStatus: document.getElementById("boardSocStatus"),
  boardMuxSource: document.getElementById("boardMuxSource"),
  socName: document.getElementById("socName"),
  socDescription: document.getElementById("socDescription"),
  socReference: document.getElementById("socReference"),
  socJson: document.getElementById("socJson"),
  socPadSelect: document.getElementById("socPadSelect"),
  socPadName: document.getElementById("socPadName"),
  socPadAliases: document.getElementById("socPadAliases"),
  socPadType: document.getElementById("socPadType"),
  socPadDomain: document.getElementById("socPadDomain"),
  socPadJson: document.getElementById("socPadJson"),
  socPadFunctions: document.getElementById("socPadFunctions"),
  socPadAddBtn: document.getElementById("socPadAddBtn"),
  socPadSaveBtn: document.getElementById("socPadSaveBtn"),
  socPadDeleteBtn: document.getElementById("socPadDeleteBtn"),
  socDiagnostics: document.getElementById("socDiagnostics"),
  socExportBtn: document.getElementById("socExportBtn"),
  boardPanel: document.getElementById("boardPanel"),
  socPanel: document.getElementById("socPanel"),
  partTree: document.getElementById("partTree"),
  libraryList: document.getElementById("libraryList"),
  libraryToggle: document.getElementById("libraryToggle"),
  libraryBody: document.getElementById("libraryBody"),
  symLegend: document.getElementById("symLegend"),
  gridPicker: document.getElementById("gridPicker"),
  gridPickerTitle: document.getElementById("gridPickerTitle"),
  gridPickerMatrix: document.getElementById("gridPickerMatrix"),
  gridSizeLabel: document.getElementById("gridSizeLabel"),
  gridRows: document.getElementById("gridRows"),
  gridCols: document.getElementById("gridCols"),
  metaForm: document.getElementById("metaForm"),
  underlayImg: document.getElementById("underlayImg"),
  overlay: document.getElementById("overlay"),
  canvasStage: document.getElementById("canvasStage"),
  canvasWorld: document.getElementById("canvasWorld"),
  canvasRotator: document.getElementById("canvasRotator"),
  underlayRotation: document.getElementById("underlayRotation"),
  viewRotCcwBtn: document.getElementById("viewRotCcwBtn"),
  viewRotCwBtn: document.getElementById("viewRotCwBtn"),
  viewResetBtn: document.getElementById("viewResetBtn"),
  marquee: document.getElementById("marquee"),
  drillPanel: document.getElementById("drillPanel"),
  breadcrumb: document.getElementById("breadcrumb"),
  drillContent: document.getElementById("drillContent"),
  previewToggle: document.getElementById("previewToggle"),
  undoBtn: document.getElementById("undoBtn"),
  redoBtn: document.getElementById("redoBtn"),
  snapToggle: document.getElementById("snapToggle"),
  snapStep: document.getElementById("snapStep"),
  snapObjectsToggle: document.getElementById("snapObjectsToggle"),
  toolSelectBtn: document.getElementById("toolSelectBtn"),
  toolHandBtn: document.getElementById("toolHandBtn"),
  periList: document.getElementById("periList"),
  cheatSheetBtn: document.getElementById("cheatSheetBtn"),
  cheatSheet: document.getElementById("cheatSheet"),
  cheatSheetBody: document.getElementById("cheatSheetBody"),
};


export function takeSnapshot() {
  return {
    documentMode: state.documentMode,
    board: structuredClone(state.board),
    socTable: structuredClone(state.socTable),
    selectedId: state.selectedId,
    selectedIds: [...state.selectedIds],
    treeOpen: { ...state.treeOpen },
  };
}

export function updateHistoryButtons() {
  if (els.undoBtn) els.undoBtn.disabled = history.past.length === 0;
  if (els.redoBtn) els.redoBtn.disabled = history.future.length === 0;
}

export function pushHistory() {
  if (history.pausing) return;
  history.past.push(takeSnapshot());
  if (history.past.length > history.max) history.past.shift();
  history.future = [];
  updateHistoryButtons();
}
