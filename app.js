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

const SAVE_DEBOUNCE_MS = 700;
const LAST_SETTINGS_KEY = "notes-app:last-settings";

/* =========================================================
   DOM references
   ========================================================= */
const authScreen = document.getElementById("auth-screen");
const appScreen = document.getElementById("app-screen");

const authForm = document.getElementById("auth-form");
const authEmail = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");
const authError = document.getElementById("auth-error");
const authSubmit = document.getElementById("auth-submit");
const authToggle = document.getElementById("auth-toggle");

const sidebar = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebar-backdrop");
const menuBtn = document.getElementById("menu-btn");
const newNoteBtn = document.getElementById("new-note-btn");
const searchInput = document.getElementById("search-input");
const notesListEl = document.getElementById("notes-list");
const emptyStateEl = document.getElementById("empty-state");
const accountEmailEl = document.getElementById("account-email");
const signOutBtn = document.getElementById("sign-out-btn");

const fontSelect = document.getElementById("font-select");
const sizeSelect = document.getElementById("size-select");
const pageSelect = document.getElementById("page-select");
const fmtButtons = Array.from(document.querySelectorAll(".fmt-btn"));
const deleteNoteBtn = document.getElementById("delete-note-btn");
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

let notes = [];               // all notes for the signed-in user, most recently updated first
let currentNoteId = null;      // which note is open in the editor
let searchTerm = "";

let saveTimer = null;
let lastLocalEditAt = 0;       // Date.now() of the most recent local keystroke, used to avoid
                                // clobbering in-progress edits with a remote snapshot update
let isAuthSubmitting = false;
let authMode = "signin";       // "signin" | "signup"

/* =========================================================
   Small helpers
   ========================================================= */
function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
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
  if (value instanceof Timestamp) return value.toDate();
  if (value.toDate) return value.toDate();
  return null;
}

/* =========================================================
   Auth screen
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
    default:
      return "Something went wrong. Please try again.";
  }
}

signOutBtn.addEventListener("click", () => {
  signOut(auth);
});

/* =========================================================
   Auth state -> show the right screen, wire up Firestore
   ========================================================= */
onAuthStateChanged(auth, (user) => {
  currentUser = user;

  if (unsubscribeNotes) {
    unsubscribeNotes();
    unsubscribeNotes = null;
  }

  if (user) {
    authScreen.hidden = true;
    appScreen.hidden = false;
    accountEmailEl.textContent = user.email || "";
    subscribeToNotes(user.uid);
  } else {
    appScreen.hidden = true;
    authScreen.hidden = false;
    notes = [];
    currentNoteId = null;
    renderNotesList();
    showNoNoteState();
    authForm.reset();
    setAuthMode("signin");
  }
});

/* =========================================================
   Firestore: subscribe to this user's notes
   ========================================================= */
function notesCollection(uid) {
  return collection(db, "users", uid, "notes");
}

function subscribeToNotes(uid) {
  const q = query(notesCollection(uid), orderBy("updatedAt", "desc"));
  unsubscribeNotes = onSnapshot(
    q,
    (snapshot) => {
      notes = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderNotesList();

      if (currentNoteId) {
        const openNote = notes.find((n) => n.id === currentNoteId);
        if (!openNote) {
          // Note was deleted (e.g. from another device)
          currentNoteId = null;
          showNoNoteState();
        } else {
          maybeRefreshEditorFromRemote(openNote);
        }
      }
    },
    (err) => {
      console.error("Notes subscription error:", err);
      setSaveStatus("offline", "Offline");
    }
  );
}

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

    const title = document.createElement("span");
    title.className = "note-title";
    title.textContent = note.title && note.title.trim() ? note.title : "Untitled";

    const time = document.createElement("span");
    time.className = "note-time";
    time.textContent = relativeTime(toDate(note.updatedAt) || toDate(note.createdAt));

    top.appendChild(title);
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
  const note = notes.find((n) => n.id === id);
  if (!note) return;

  currentNoteId = id;
  renderNotesList();
  showEditor();
  closeSidebarDrawer();

  titleInput.value = note.title || "";
  bodyEditable.innerHTML = note.html || "";

  const font = note.font || DEFAULT_FONT;
  const size = note.fontSize || DEFAULT_SIZE;
  const pageSize = note.pageSize || DEFAULT_PAGE_SIZE;

  fontSelect.value = font;
  sizeSelect.value = String(size);
  pageSelect.value = pageSize;
  applyEditorStyles(font, size, pageSize);

  setSaveStatus("saved", "Saved");
}

function maybeRefreshEditorFromRemote(note) {
  // Don't yank text out from under someone who is actively typing,
  // and don't reapply a write we just made ourselves.
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
}

newNoteBtn.addEventListener("click", async () => {
  if (!currentUser) return;
  const last = readLastSettings();
  const newDoc = {
    title: "",
    html: "",
    font: last.font,
    fontSize: last.size,
    pageSize: last.pageSize,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  try {
    const ref = await addDoc(notesCollection(currentUser.uid), newDoc);
    currentNoteId = ref.id;
    // Optimistically show a blank editor right away; the snapshot will confirm shortly.
    titleInput.value = "";
    bodyEditable.innerHTML = "";
    fontSelect.value = last.font;
    sizeSelect.value = String(last.size);
    pageSelect.value = last.pageSize;
    applyEditorStyles(last.font, last.size, last.pageSize);
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
  if (!currentUser || !currentNoteId) return;
  const note = notes.find((n) => n.id === currentNoteId);
  const label = note && note.title ? `"${note.title}"` : "this note";
  const confirmed = window.confirm(`Delete ${label}? This can't be undone.`);
  if (!confirmed) return;

  const idToDelete = currentNoteId;
  currentNoteId = null;
  showNoNoteState();

  try {
    await deleteDoc(doc(db, "users", currentUser.uid, "notes", idToDelete));
  } catch (err) {
    console.error("Could not delete note:", err);
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
  scheduleSave();
});

sizeSelect.addEventListener("change", () => {
  const { font, size, pageSize } = currentEditorSettings();
  applyEditorStyles(font, size, pageSize);
  writeLastSettings({ font, size, pageSize });
  scheduleSave();
});

pageSelect.addEventListener("change", () => {
  const { font, size, pageSize } = currentEditorSettings();
  applyEditorStyles(font, size, pageSize);
  writeLastSettings({ font, size, pageSize });
  scheduleSave();
});

fmtButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const cmd = btn.dataset.cmd;
    bodyEditable.focus();
    document.execCommand(cmd, false, null);
    updateFormatButtonStates();
    lastLocalEditAt = Date.now();
    scheduleSave();
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

/* =========================================================
   Editor: typing -> debounced save
   ========================================================= */
titleInput.addEventListener("input", () => {
  lastLocalEditAt = Date.now();
  scheduleSave();
});

bodyEditable.addEventListener("input", () => {
  lastLocalEditAt = Date.now();
  scheduleSave();
});

const scheduleSave = debounce(saveCurrentNote, SAVE_DEBOUNCE_MS);

function setSaveStatus(state, text) {
  saveStatusEl.classList.remove("saving", "saved", "offline");
  saveStatusEl.classList.add(state);
  saveStatusText.textContent = text;
}

async function saveCurrentNote() {
  if (!currentUser || !currentNoteId) return;

  setSaveStatus("saving", "Saving…");

  const { font, size, pageSize } = currentEditorSettings();
  const payload = {
    title: titleInput.value,
    html: bodyEditable.innerHTML,
    font,
    fontSize: size,
    pageSize,
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, "users", currentUser.uid, "notes", currentNoteId), payload, { merge: true });
    setSaveStatus("saved", "Saved");
  } catch (err) {
    console.error("Could not save note:", err);
    setSaveStatus("offline", "Will sync when online");
  }
}

// Save immediately if the page is being hidden/closed with unsaved changes.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && currentNoteId) {
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

showNoNoteState();
