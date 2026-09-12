import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  collection,
  doc,
  addDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

/* =========================================================
   Constants
   ========================================================= */
const FONTS = [
  { label: "Serif",   value: "'Source Serif 4', Georgia, serif" },
  { label: "Lora",    value: "'Lora', Georgia, serif" },
  { label: "Georgia", value: "Georgia, 'Times New Roman', serif" },
  { label: "Sans",    value: "'Inter', -apple-system, sans-serif" },
  { label: "Grotesk", value: "'Space Grotesk', -apple-system, sans-serif" },
  { label: "Mono",    value: "'IBM Plex Mono', 'SFMono-Regular', monospace" },
];
const DEFAULT_FONT = FONTS[0].value;

const SIZES = [11, 12, 13, 14, 16, 18, 20, 24];
const DEFAULT_SIZE = 16;

const PAGE_SIZES = [
  { label: "A4", value: "a4" },
  { label: "Letter", value: "letter" },
  { label: "Legal", value: "legal" },
  { label: "Continuous", value: "continuous" },
];
const DEFAULT_PAGE_SIZE = "a4";

const NOTE_COLORS = [
  "#E39A93", "#EFC373", "#9BC792", "#7FC3C9",
  "#8FAEE0", "#B79EDB", "#D9A6C2", "#B9AF9B",
];

const SAVE_DEBOUNCE_MS = 400;
const LAST_SETTINGS_KEY = "notes-app:last-settings";
const LOCAL_NOTES_KEY = "notes-app:local-notes";

/* =========================================================
   DOM references
   ========================================================= */
const sidebar = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebar-backdrop");
const menuBtn = document.getElementById("menu-btn");
const newNoteBtn = document.getElementById("new-note-btn");
const searchInput = document.getElementById("search-input");
const notesListEl = document.getElementById("notes-list");
const emptyStateEl = document.getElementById("empty-state");

const signedOutRow = document.getElementById("signed-out-row");
const signedInRow = document.getElementById("signed-in-row");
const signInOpenBtn = document.getElementById("sign-in-open-btn");
const accountEmailEl = document.getElementById("account-email");
const signOutBtn = document.getElementById("sign-out-btn");

const authModal = document.getElementById("auth-modal");
const authModalClose = document.getElementById("auth-modal-close");
const authForm = document.getElementById("auth-form");
const authEmail = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");
const authError = document.getElementById("auth-error");
const authSubmit = document.getElementById("auth-submit");
const authToggle = document.getElementById("auth-toggle");

const fontSelect = document.getElementById("font-select");
const sizeSelect = document.getElementById("size-select");
const pageSelect = document.getElementById("page-select");
const fmtButtons = Array.from(document.querySelectorAll(".fmt-btn[data-cmd]"));
const colorTagBtn = document.getElementById("color-tag-btn");
const colorPopover = document.getElementById("color-popover");
const pinNoteBtn = document.getElementById("pin-note-btn");
const duplicateNoteBtn = document.getElementById("duplicate-note-btn");
const deleteNoteBtn = document.getElementById("delete-note-btn");
const wordCountEl = document.getElementById("word-count");
const saveStatusEl = document.getElementById("save-status");
const saveStatusText = document.getElementById("save-status-text");

const noNoteState = document.getElementById("no-note-state");
const pageWrap = document.getElementById("page-wrap");
const pageEl = document.getElementById("page");
const titleInput = document.getElementById("title-input");
const bodyEditable = document.getElementById("body-editable");

/* =========================================================
   State
   ========================================================= */
let currentUser = null;
let unsubscribeNotes = null;
let storeMode = "local";       // "local" (on this device only) | "cloud" (synced via Firestore)

let notes = [];                 // notes for the active store, sorted: pinned first, then most recent
let currentNoteId = null;
let searchTerm = "";
let autoOpenAttempted = false;  // open the most recent note automatically, once per store

let lastLocalEditAt = 0;
let isAuthSubmitting = false;
let authMode = "signin";        // "signin" | "signup"

/* =========================================================
   Small helpers
   ========================================================= */
function makeId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readLastSettings() {
  try {
    const raw = localStorage.getItem(LAST_SETTINGS_KEY);
    if (!raw) return { font: DEFAULT_FONT, size: DEFAULT_SIZE, pageSize: DEFAULT_PAGE_SIZE };
    const parsed = JSON.parse(raw);
    return {
      font: parsed.font || DEFAULT_FONT,
      size: parsed.size || DEFAULT_SIZE,
      pageSize: parsed.pageSize || DEFAULT_PAGE_SIZE,
    };
  } catch {
    return { font: DEFAULT_FONT, size: DEFAULT_SIZE, pageSize: DEFAULT_PAGE_SIZE };
  }
}

function writeLastSettings(settings) {
  try {
    localStorage.setItem(LAST_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

function relativeTime(date) {
  if (!date) return "";
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 10) return "now";
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function plainTextFromHtml(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "";
  return (tmp.textContent || "").replace(/\s+/g, " ").trim();
}

function toDate(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (value instanceof Timestamp) return value.toDate();
  if (value.toDate) return value.toDate();
  return null;
}

function sortNotes(list) {
  return [...list].sort((a, b) => {
    const pa = a.pinned ? 1 : 0;
    const pb = b.pinned ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const da = toDate(a.updatedAt) || toDate(a.createdAt) || new Date(0);
    const db = toDate(b.updatedAt) || toDate(b.createdAt) || new Date(0);
    return db - da;
  });
}

/* =========================================================
   Local storage — notes kept on this device only
   ========================================================= */
function loadLocalNotesRaw() {
  try {
    const raw = localStorage.getItem(LOCAL_NOTES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalNotesRaw(list) {
  try {
    localStorage.setItem(LOCAL_NOTES_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

function loadLocal() {
  storeMode = "local";
  notes = sortNotes(loadLocalNotesRaw());
  renderNotesList();
  maybeAutoOpen();
}

/* =========================================================
   Firestore — notes synced to the signed-in account
   ========================================================= */
function notesCollection(uid) {
  return collection(db, "users", uid, "notes");
}

function subscribeToNotes(uid) {
  const q = query(notesCollection(uid), orderBy("updatedAt", "desc"));
  unsubscribeNotes = onSnapshot(
    q,
    (snapshot) => {
      notes = sortNotes(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      renderNotesList();
      maybeAutoOpen();

      if (currentNoteId) {
        const openedNote = notes.find((n) => n.id === currentNoteId);
        if (!openedNote) {
          currentNoteId = null;
          showNoNoteState();
        } else {
          maybeRefreshEditorFromRemote(openedNote);
        }
      }
    },
    (err) => {
      console.error("Notes subscription error:", err);
      setSaveStatus("offline", "Offline");
    }
  );
}

// Moves any notes written before sign-in into the account, so nothing is lost.
async function migrateLocalNotesToCloud(uid) {
  const localList = loadLocalNotesRaw();
  if (!localList.length) return;

  try {
    for (const note of localList) {
      await addDoc(notesCollection(uid), {
        title: note.title || "",
        html: note.html || "",
        font: note.font || DEFAULT_FONT,
        fontSize: note.fontSize || DEFAULT_SIZE,
        pageSize: note.pageSize || DEFAULT_PAGE_SIZE,
        pinned: !!note.pinned,
        color: note.color || null,
        createdAt: note.createdAt ? Timestamp.fromDate(new Date(note.createdAt)) : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    saveLocalNotesRaw([]);
  } catch (err) {
    console.error("Could not move notes on this device into your account:", err);
    // Leave local notes in place so nothing is lost; migration will retry next sign-in.
  }
}

/* =========================================================
   Store abstraction — same calls work whether notes live
   locally or in Firestore
   ========================================================= */
async function createNote() {
  const last = readLastSettings();
  const base = {
    title: "",
    html: "",
    font: last.font,
    fontSize: last.size,
    pageSize: last.pageSize,
    pinned: false,
    color: null,
  };

  if (storeMode === "cloud" && currentUser) {
    const ref = await addDoc(notesCollection(currentUser.uid), {
      ...base,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  }

  const id = makeId();
  const now = new Date().toISOString();
  const note = { ...base, id, createdAt: now, updatedAt: now };
  const list = loadLocalNotesRaw();
  list.push(note);
  saveLocalNotesRaw(list);
  notes = sortNotes(list);
  renderNotesList();
  return id;
}

async function updateNote(id, payload) {
  if (storeMode === "cloud" && currentUser) {
    await setDoc(doc(db, "users", currentUser.uid, "notes", id), { ...payload, updatedAt: serverTimestamp() }, { merge: true });
    return;
  }

  const list = loadLocalNotesRaw();
  const idx = list.findIndex((n) => n.id === id);
  if (idx === -1) return;
  list[idx] = { ...list[idx], ...payload, updatedAt: new Date().toISOString() };
  saveLocalNotesRaw(list);
  notes = sortNotes(list);
  renderNotesList();
}

async function removeNote(id) {
  if (storeMode === "cloud" && currentUser) {
    await deleteDoc(doc(db, "users", currentUser.uid, "notes", id));
    return;
  }

  const list = loadLocalNotesRaw().filter((n) => n.id !== id);
  saveLocalNotesRaw(list);
  notes = sortNotes(list);
  renderNotesList();
}

function getNoteById(id) {
  return notes.find((n) => n.id === id) || null;
}

/* =========================================================
   Auth: modal open/close
   ========================================================= */
function setAuthMode(mode) {
  authMode = mode;
  if (mode === "signup") {
    authSubmit.textContent = "Create account";
    authToggle.textContent = "Have an account? Sign in";
  } else {
    authSubmit.textContent = "Continue";
    authToggle.textContent = "New here? Create an account";
  }
  authError.hidden = true;
}

function openAuthModal() {
  authModal.hidden = false;
  setTimeout(() => authEmail.focus(), 0);
}

function closeAuthModal() {
  authModal.hidden = true;
  authForm.reset();
  authError.hidden = true;
  setAuthMode("signin");
}

signInOpenBtn.addEventListener("click", openAuthModal);
authModalClose.addEventListener("click", closeAuthModal);
authModal.addEventListener("click", (e) => {
  if (e.target === authModal) closeAuthModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !authModal.hidden) closeAuthModal();
});

authToggle.addEventListener("click", () => {
  setAuthMode(authMode === "signin" ? "signup" : "signin");
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (isAuthSubmitting) return;

  const email = authEmail.value.trim();
  const password = authPassword.value;

  authError.hidden = true;
  isAuthSubmitting = true;
  authSubmit.disabled = true;

  try {
    if (authMode === "signup") {
      await createUserWithEmailAndPassword(auth, email, password);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    closeAuthModal();
  } catch (err) {
    authError.textContent = friendlyAuthError(err);
    authError.hidden = false;
  } finally {
    isAuthSubmitting = false;
    authSubmit.disabled = false;
  }
});

function friendlyAuthError(err) {
  const code = err && err.code ? err.code : "";
  switch (code) {
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Email or password is incorrect.";
    case "auth/email-already-in-use":
      return "An account already exists for that email. Try signing in.";
    case "auth/weak-password":
      return "Password should be at least 6 characters.";
    case "auth/network-request-failed":
      return "Can't reach the network. Check your connection and try again.";
    case "auth/unauthorized-domain":
      return "This site isn't authorized yet — add its domain in Firebase Authentication settings.";
    default:
      return "Something went wrong. Please try again.";
  }
}

signOutBtn.addEventListener("click", () => {
  signOut(auth);
});

/* =========================================================
   Auth state -> switch between local and cloud storage
   ========================================================= */
onAuthStateChanged(auth, async (user) => {
  if (currentNoteId) {
    // Flush any in-progress edit into the outgoing store (local or cloud)
    // before switching, so a sign-in/out never drops a keystroke.
    cancelScheduledSave();
    saveCurrentNote();
  }

  currentUser = user;

  if (unsubscribeNotes) {
    unsubscribeNotes();
    unsubscribeNotes = null;
  }

  if (user) {
    signedOutRow.hidden = true;
    signedInRow.hidden = false;
    accountEmailEl.textContent = user.email || "";

    await migrateLocalNotesToCloud(user.uid);

    storeMode = "cloud";
    currentNoteId = null;
    autoOpenAttempted = false;
    showNoNoteState();
    subscribeToNotes(user.uid);
  } else {
    signedOutRow.hidden = false;
    signedInRow.hidden = true;
    currentNoteId = null;
    autoOpenAttempted = false;
    showNoNoteState();
    loadLocal();
  }
});

/* =========================================================
   Rendering: sidebar list
   ========================================================= */
function filteredNotes() {
  if (!searchTerm) return notes;
  const term = searchTerm.toLowerCase();
  return notes.filter((n) => {
    const title = (n.title || "").toLowerCase();
    const body = plainTextFromHtml(n.html).toLowerCase();
    return title.includes(term) || body.includes(term);
  });
}

function renderNotesList() {
  const list = filteredNotes();
  notesListEl.innerHTML = "";

  emptyStateEl.hidden = notes.length !== 0;

  if (notes.length > 0 && list.length === 0) {
    const noResult = document.createElement("p");
    noResult.className = "empty-sub";
    noResult.style.padding = "10px 10px";
    noResult.textContent = "No notes match your search.";
    notesListEl.appendChild(noResult);
    return;
  }

  for (const note of list) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "note-row" + (note.id === currentNoteId ? " active" : "");
    row.setAttribute("aria-current", note.id === currentNoteId ? "true" : "false");

    const top = document.createElement("div");
    top.className = "note-row-top";

    const titleWrap = document.createElement("div");
    titleWrap.className = "note-title-wrap";

    if (note.color) {
      const dot = document.createElement("span");
      dot.className = "note-color-dot";
      dot.style.background = note.color;
      titleWrap.appendChild(dot);
    }

    if (note.pinned) {
      const pin = document.createElement("span");
      pin.className = "note-pin-icon";
      pin.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11"><path d="M14.5 3.5l6 6-3 3-1-1-3.5 3.5.6 3.4-1.4 1.4-4-4-4 4-1.4-1.4 4-4-4-4L4.7 9l3.4.6L11.5 6.1l-1-1 3-3Z" fill="currentColor"/></svg>';
      titleWrap.appendChild(pin);
    }

    const title = document.createElement("span");
    title.className = "note-title";
    title.textContent = note.title && note.title.trim() ? note.title : "Untitled";
    titleWrap.appendChild(title);

    const time = document.createElement("span");
    time.className = "note-time";
    time.textContent = relativeTime(toDate(note.updatedAt) || toDate(note.createdAt));

    top.appendChild(titleWrap);
    top.appendChild(time);

    const snippet = document.createElement("div");
    snippet.className = "note-snippet";
    const snippetText = plainTextFromHtml(note.html);
    snippet.textContent = snippetText || "No additional text";

    row.appendChild(top);
    row.appendChild(snippet);

    row.addEventListener("click", () => openNote(note.id));

    notesListEl.appendChild(row);
  }
}

searchInput.addEventListener("input", () => {
  searchTerm = searchInput.value.trim();
  renderNotesList();
});

function maybeAutoOpen() {
  if (autoOpenAttempted) return;
  autoOpenAttempted = true;
  if (!currentNoteId && notes.length > 0) {
    openNote(notes[0].id);
  }
}

/* =========================================================
   Editor: open / new / delete
   ========================================================= */
function showNoNoteState() {
  noNoteState.hidden = false;
  pageWrap.hidden = true;
}

function showEditor() {
  noNoteState.hidden = true;
  pageWrap.hidden = false;
}

function openNote(id) {
  if (currentNoteId && currentNoteId !== id) {
    // Flush whatever was just typed into the note we're leaving, right now —
    // captured synchronously before we swap the editor's contents below.
    cancelScheduledSave();
    saveCurrentNote();
  }

  const note = getNoteById(id);
  if (!note) return;

  currentNoteId = id;
  renderNotesList();
  showEditor();
  closeSidebarDrawer();
  closeColorPopover();

  applyNoteToEditor(note);
  setSaveStatus("saved", "Saved");
}

function applyNoteToEditor(note) {
  titleInput.value = note.title || "";
  bodyEditable.innerHTML = note.html || "";

  const font = note.font || DEFAULT_FONT;
  const size = note.fontSize || DEFAULT_SIZE;
  const pageSize = note.pageSize || DEFAULT_PAGE_SIZE;

  fontSelect.value = font;
  sizeSelect.value = String(size);
  pageSelect.value = pageSize;
  applyEditorStyles(font, size, pageSize);

  pinNoteBtn.classList.toggle("is-active", !!note.pinned);
  updateColorPopoverSelection(note.color || null);
  updateWordCount();
}

function maybeRefreshEditorFromRemote(note) {
  const isFocused = document.activeElement === titleInput || bodyEditable.contains(document.activeElement);
  const recentlyEditedLocally = Date.now() - lastLocalEditAt < SAVE_DEBOUNCE_MS + 1500;
  if (isFocused || recentlyEditedLocally) return;

  if (titleInput.value !== (note.title || "")) titleInput.value = note.title || "";
  const newHtml = note.html || "";
  if (bodyEditable.innerHTML !== newHtml) bodyEditable.innerHTML = newHtml;

  const font = note.font || DEFAULT_FONT;
  const size = note.fontSize || DEFAULT_SIZE;
  const pageSize = note.pageSize || DEFAULT_PAGE_SIZE;
  fontSelect.value = font;
  sizeSelect.value = String(size);
  pageSelect.value = pageSize;
  applyEditorStyles(font, size, pageSize);

  pinNoteBtn.classList.toggle("is-active", !!note.pinned);
  updateColorPopoverSelection(note.color || null);
  updateWordCount();
}

newNoteBtn.addEventListener("click", async () => {
  if (currentNoteId) {
    // Flush the note we're leaving before switching to a fresh blank one.
    cancelScheduledSave();
    saveCurrentNote();
  }
  try {
    const id = await createNote();
    currentNoteId = id;
    const last = readLastSettings();
    titleInput.value = "";
    bodyEditable.innerHTML = "";
    fontSelect.value = last.font;
    sizeSelect.value = String(last.size);
    pageSelect.value = last.pageSize;
    applyEditorStyles(last.font, last.size, last.pageSize);
    pinNoteBtn.classList.remove("is-active");
    updateColorPopoverSelection(null);
    updateWordCount();
    showEditor();
    closeSidebarDrawer();
    setSaveStatus("saved", "Saved");
    titleInput.focus();
  } catch (err) {
    console.error("Could not create note:", err);
    setSaveStatus("offline", "Couldn't create note");
  }
});

deleteNoteBtn.addEventListener("click", async () => {
  if (!currentNoteId) return;
  const note = getNoteById(currentNoteId);
  const label = note && note.title ? `"${note.title}"` : "this note";
  const confirmed = window.confirm(`Delete ${label}? This can't be undone.`);
  if (!confirmed) return;

  cancelScheduledSave(); // don't let a queued write resurrect the note we're about to delete

  const idToDelete = currentNoteId;
  currentNoteId = null;
  showNoNoteState();

  try {
    await removeNote(idToDelete);
  } catch (err) {
    console.error("Could not delete note:", err);
  }
});

duplicateNoteBtn.addEventListener("click", async () => {
  if (!currentNoteId) return;
  const note = getNoteById(currentNoteId);
  if (!note) return;

  // Flush first so the duplicate can be built from whatever's live in the
  // editor right now, not from a possibly-stale copy in the notes list.
  cancelScheduledSave();
  await saveCurrentNote();

  const { font, size, pageSize } = currentEditorSettings();
  const liveTitle = titleInput.value;
  const liveHtml = bodyEditable.innerHTML;

  try {
    const id = await createNote();
    const copyTitle = liveTitle && liveTitle.trim() ? `${liveTitle} copy` : "";
    await updateNote(id, {
      title: copyTitle,
      html: liveHtml,
      font,
      fontSize: size,
      pageSize,
      pinned: false,
      color: note.color || null,
    });
    openNote(id);
  } catch (err) {
    console.error("Could not duplicate note:", err);
  }
});

pinNoteBtn.addEventListener("click", async () => {
  if (!currentNoteId) return;
  const note = getNoteById(currentNoteId);
  if (!note) return;
  const nextPinned = !note.pinned;
  pinNoteBtn.classList.toggle("is-active", nextPinned);
  try {
    await updateNote(currentNoteId, { pinned: nextPinned });
  } catch (err) {
    console.error("Could not update pin:", err);
  }
});

/* =========================================================
   Editor: color tag popover
   ========================================================= */
function buildColorPopover() {
  colorPopover.innerHTML = "";

  const noneBtn = document.createElement("button");
  noneBtn.type = "button";
  noneBtn.className = "color-swatch color-swatch-none";
  noneBtn.setAttribute("aria-label", "No color");
  noneBtn.dataset.color = "";
  colorPopover.appendChild(noneBtn);

  for (const hex of NOTE_COLORS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "color-swatch";
    btn.style.background = hex;
    btn.dataset.color = hex;
    btn.setAttribute("aria-label", "Set note color");
    colorPopover.appendChild(btn);
  }

  colorPopover.addEventListener("click", async (e) => {
    const btn = e.target.closest(".color-swatch");
    if (!btn || !currentNoteId) return;
    const color = btn.dataset.color || null;
    updateColorPopoverSelection(color);
    closeColorPopover();
    try {
      await updateNote(currentNoteId, { color });
    } catch (err) {
      console.error("Could not update color:", err);
    }
  });
}
buildColorPopover();

function updateColorPopoverSelection(color) {
  const swatches = colorPopover.querySelectorAll(".color-swatch");
  swatches.forEach((el) => {
    const val = el.dataset.color || null;
    el.classList.toggle("is-selected", val === color);
  });
}

function openColorPopover() {
  colorPopover.hidden = false;
}
function closeColorPopover() {
  colorPopover.hidden = true;
}
colorTagBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  colorPopover.hidden ? openColorPopover() : closeColorPopover();
});
document.addEventListener("click", (e) => {
  if (!colorPopover.hidden && !colorPopover.contains(e.target) && e.target !== colorTagBtn) {
    closeColorPopover();
  }
});

/* =========================================================
   Editor: toolbar (font, size, page size, formatting)
   ========================================================= */
function populateSelects() {
  fontSelect.innerHTML = "";
  for (const f of FONTS) {
    const opt = document.createElement("option");
    opt.value = f.value;
    opt.textContent = f.label;
    fontSelect.appendChild(opt);
  }

  sizeSelect.innerHTML = "";
  for (const s of SIZES) {
    const opt = document.createElement("option");
    opt.value = String(s);
    opt.textContent = `${s}pt`;
    sizeSelect.appendChild(opt);
  }

  pageSelect.innerHTML = "";
  for (const p of PAGE_SIZES) {
    const opt = document.createElement("option");
    opt.value = p.value;
    opt.textContent = p.label;
    pageSelect.appendChild(opt);
  }
}
populateSelects();

function applyEditorStyles(font, size, pageSize) {
  bodyEditable.style.fontFamily = font;
  titleInput.style.fontFamily = font;
  bodyEditable.style.fontSize = size + "px";
  pageEl.dataset.size = pageSize;
}

function currentEditorSettings() {
  return {
    font: fontSelect.value,
    size: Number(sizeSelect.value),
    pageSize: pageSelect.value,
  };
}

fontSelect.addEventListener("change", () => {
  const { font, size, pageSize } = currentEditorSettings();
  applyEditorStyles(font, size, pageSize);
  writeLastSettings({ font, size, pageSize });
  queueSave();
});

sizeSelect.addEventListener("change", () => {
  const { font, size, pageSize } = currentEditorSettings();
  applyEditorStyles(font, size, pageSize);
  writeLastSettings({ font, size, pageSize });
  queueSave();
});

pageSelect.addEventListener("change", () => {
  const { font, size, pageSize } = currentEditorSettings();
  applyEditorStyles(font, size, pageSize);
  writeLastSettings({ font, size, pageSize });
  queueSave();
});

fmtButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const cmd = btn.dataset.cmd;
    bodyEditable.focus();
    document.execCommand(cmd, false, null);
    updateFormatButtonStates();
    lastLocalEditAt = Date.now();
    queueSave();
  });
});

function updateFormatButtonStates() {
  fmtButtons.forEach((btn) => {
    const cmd = btn.dataset.cmd;
    let active = false;
    try {
      active = document.queryCommandState(cmd);
    } catch {
      active = false;
    }
    btn.classList.toggle("is-active", active);
  });
}

document.addEventListener("selectionchange", () => {
  if (document.activeElement === bodyEditable || bodyEditable.contains(document.activeElement)) {
    updateFormatButtonStates();
  }
});

// Keyboard shortcuts for formatting, so Cmd/Ctrl+B/I/U behave consistently.
bodyEditable.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  const key = e.key.toLowerCase();
  const cmdMap = { b: "bold", i: "italic", u: "underline" };
  if (cmdMap[key]) {
    e.preventDefault();
    document.execCommand(cmdMap[key], false, null);
    updateFormatButtonStates();
    lastLocalEditAt = Date.now();
    queueSave();
  }
});

/* =========================================================
   Editor: word count
   ========================================================= */
function updateWordCount() {
  const text = (bodyEditable.textContent || "").trim();
  const words = text ? text.split(/\s+/).length : 0;
  wordCountEl.textContent = words === 1 ? "1 word" : `${words} words`;
}

/* =========================================================
   Editor: typing -> debounced save
   ========================================================= */
titleInput.addEventListener("input", () => {
  lastLocalEditAt = Date.now();
  queueSave();
});

bodyEditable.addEventListener("input", () => {
  lastLocalEditAt = Date.now();
  updateWordCount();
  queueSave();
});

titleInput.addEventListener("blur", flushIfPending);
bodyEditable.addEventListener("blur", flushIfPending);

let saveTimer = null;

function cancelScheduledSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

// Shows "Saving…" the instant you type, then writes shortly after you pause —
// so autosave always feels immediate even though writes are lightly batched.
function queueSave() {
  cancelScheduledSave();
  setSaveStatus("saving", "Saving…");
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveCurrentNote();
  }, SAVE_DEBOUNCE_MS);
}

// Writes right away instead of waiting out the debounce — used whenever
// focus leaves the editor, so nothing is left unsaved.
function flushIfPending() {
  if (saveTimer) {
    cancelScheduledSave();
    saveCurrentNote();
  }
}

function setSaveStatus(state, text) {
  saveStatusEl.classList.remove("saving", "saved", "offline");
  saveStatusEl.classList.add(state);
  saveStatusText.textContent = text;
}

async function saveCurrentNote() {
  if (!currentNoteId) return;

  setSaveStatus("saving", "Saving…");

  const { font, size, pageSize } = currentEditorSettings();
  const payload = {
    title: titleInput.value,
    html: bodyEditable.innerHTML,
    font,
    fontSize: size,
    pageSize,
  };

  try {
    await updateNote(currentNoteId, payload);
    setSaveStatus("saved", storeMode === "cloud" ? "Saved" : "Saved on this device");
  } catch (err) {
    console.error("Could not save note:", err);
    setSaveStatus("offline", "Will sync when online");
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && currentNoteId) {
    cancelScheduledSave();
    saveCurrentNote();
  }
});

// Best-effort: catch the case where the tab or app is closed outright
// mid-keystroke, e.g. swiping away the PWA on iPad.
window.addEventListener("pagehide", () => {
  if (currentNoteId) {
    cancelScheduledSave();
    saveCurrentNote();
  }
});

/* =========================================================
   Sidebar drawer (narrow screens / iPad portrait)
   ========================================================= */
function openSidebarDrawer() {
  sidebar.classList.add("open");
  sidebarBackdrop.hidden = false;
}
function closeSidebarDrawer() {
  sidebar.classList.remove("open");
  sidebarBackdrop.hidden = true;
}
menuBtn.addEventListener("click", () => {
  sidebar.classList.contains("open") ? closeSidebarDrawer() : openSidebarDrawer();
});
sidebarBackdrop.addEventListener("click", closeSidebarDrawer);

/* =========================================================
   Service worker registration (PWA / offline app shell)
   ========================================================= */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}

window.addEventListener("online", () => currentNoteId && setSaveStatus("saved", "Saved"));
window.addEventListener("offline", () => setSaveStatus("offline", "Offline — will sync later"));

/* =========================================================
   Boot: show notes immediately from local storage.
   onAuthStateChanged (above) will switch to cloud sync shortly
   after, if there's a signed-in session.
   ========================================================= */
showNoNoteState();
loadLocal();
