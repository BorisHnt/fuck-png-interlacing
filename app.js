const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
let nextItemId = 0;

const state = {
  items: [],
  zipBlob: null,
  zipUrl: "",
  busy: false,
  notice: "",
};

const refs = {
  dropzone: document.querySelector("#dropzone"),
  fileInput: document.querySelector("#file-input"),
  pickButton: document.querySelector("#pick-button"),
  convertButton: document.querySelector("#convert-button"),
  downloadButton: document.querySelector("#download-button"),
  fileList: document.querySelector("#file-list"),
  statusLine: document.querySelector("#status-line"),
  totalCount: document.querySelector("#count-total"),
  interlacedCount: document.querySelector("#count-interlaced"),
  convertedCount: document.querySelector("#count-converted"),
};

refs.pickButton.addEventListener("click", () => refs.fileInput.click());
refs.dropzone.addEventListener("click", () => refs.fileInput.click());
refs.dropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    refs.fileInput.click();
  }
});

refs.fileInput.addEventListener("change", (event) => {
  addFiles(event.target.files);
  event.target.value = "";
});

["dragenter", "dragover"].forEach((type) => {
  refs.dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    refs.dropzone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((type) => {
  refs.dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    refs.dropzone.classList.remove("is-dragging");
  });
});

refs.dropzone.addEventListener("drop", (event) => {
  addFiles(event.dataTransfer.files);
});

refs.convertButton.addEventListener("click", async () => {
  if (!state.items.length || state.busy) {
    return;
  }

  clearZip();
  state.notice = "";
  state.busy = true;
  render();

  for (const item of state.items) {
    if (item.status === "done") {
      continue;
    }

    item.status = "processing";
    item.message = item.interlaced
      ? "Conversion en cours. On arrache Adam7 du fichier."
      : "Reconversion propre en cours. On évite tout retour de cette crasse.";
    render();

    try {
      item.outputBlob = await convertPng(item.file);
      item.outputName = buildOutputName(item.file.name);
      item.status = "done";
      item.message = item.interlaced
        ? "PNG nettoye. L'entrelassement a ete vire proprement."
        : "PNG reconstruit en version plate, sans entrelassement parasite.";
    } catch (error) {
      item.status = "error";
      item.message = `Echec de conversion: ${error instanceof Error ? error.message : "erreur inconnue"}`;
    }

    render();
  }

  if (state.items.some((item) => item.status === "done")) {
    state.notice =
      "Conversion terminee. Le ZIP est en cours d'assemblage pour enterrer cette technologie ratee.";

    try {
      state.zipBlob = await buildZip();
      state.zipUrl = URL.createObjectURL(state.zipBlob);
      state.notice = "";
    } catch (error) {
      state.notice = `Conversion finie, mais le ZIP a echoue: ${
        error instanceof Error ? error.message : "erreur inconnue"
      }`;
    }
  }

  state.busy = false;
  render();
});

refs.downloadButton.addEventListener("click", () => {
  if (!state.zipUrl) {
    return;
  }

  const anchor = document.createElement("a");
  anchor.href = state.zipUrl;
  anchor.download = `png-sans-entrelassement-${Date.now()}.zip`;
  anchor.click();
});

function addFiles(fileList) {
  const files = [...fileList];
  if (!files.length) {
    return;
  }

  clearZip();
  state.notice = "";

  const known = new Set(
    state.items.map((item) => `${item.file.name}-${item.file.size}-${item.file.lastModified}`)
  );

  for (const file of files) {
    const key = `${file.name}-${file.size}-${file.lastModified}`;
    if (known.has(key)) {
      continue;
    }

    known.add(key);
    state.items.push({
      id: `png-${nextItemId++}`,
      file,
      status: "pending",
      message: "Analyse en attente.",
      interlaced: null,
      width: null,
      height: null,
      outputBlob: null,
      outputName: "",
    });
  }

  render();
  analyzePendingItems().catch((error) => {
    state.notice = `Analyse des fichiers interrompue: ${
      error instanceof Error ? error.message : "erreur inconnue"
    }`;
    render();
  });
}

async function analyzePendingItems() {
  for (const item of state.items) {
    if (item.interlaced !== null) {
      continue;
    }

    try {
      const info = await inspectPng(item.file);
      item.interlaced = info.interlaced;
      item.width = info.width;
      item.height = info.height;
      item.message = info.interlaced
        ? "PNG entrelasse detecte. Cet algorithme prehistorique va degager."
        : "PNG deja non entrelasse. Propre, mais on peut le reconstruire sans risque.";
    } catch (error) {
      item.status = "error";
      item.interlaced = false;
      item.message = `Fichier refuse: ${error instanceof Error ? error.message : "PNG invalide"}`;
    }
  }

  render();
}

async function inspectPng(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  if (bytes.length < 33) {
    throw new Error("fichier trop court pour etre un PNG valable");
  }

  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) {
      throw new Error("signature PNG invalide");
    }
  }

  const chunkType = String.fromCharCode(...bytes.slice(12, 16));
  if (chunkType !== "IHDR") {
    throw new Error("en-tete IHDR manquant");
  }

  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const interlaceMethod = bytes[28];

  return {
    width,
    height,
    interlaced: interlaceMethod === 1,
  };
}

async function convertPng(file) {
  const bitmap = typeof createImageBitmap === "function" ? await createImageBitmap(file) : await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const context = canvas.getContext("2d");
  if (!context) {
    if (typeof bitmap.close === "function") {
      bitmap.close();
    }
    throw new Error("contexte canvas indisponible");
  }

  context.drawImage(bitmap, 0, 0);
  if (typeof bitmap.close === "function") {
    bitmap.close();
  }

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result);
        return;
      }

      reject(new Error("export PNG impossible"));
    }, "image/png");
  });

  canvas.width = 0;
  canvas.height = 0;
  return blob;
}

async function loadImage(file) {
  const url = URL.createObjectURL(file);

  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("decodage image impossible"));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function buildZip() {
  if (!window.JSZip) {
    throw new Error("librairie ZIP absente");
  }

  const zip = new window.JSZip();

  for (const item of state.items) {
    if (item.status !== "done" || !item.outputBlob) {
      continue;
    }

    zip.file(item.outputName, item.outputBlob);
  }

  zip.file(
    "lisez-moi-bordel.txt",
    [
      "Ces PNG ont ete reexportes sans entrelassement.",
      "Adam7 reste une idee douteuse qu'on laisse derriere soi.",
      `Fichiers convertis: ${state.items.filter((item) => item.status === "done").length}`,
    ].join("\n")
  );

  return zip.generateAsync({ type: "blob" });
}

function buildOutputName(name) {
  const dotIndex = name.toLowerCase().lastIndexOf(".png");
  const base = dotIndex >= 0 ? name.slice(0, dotIndex) : name;
  return `${base}-sans-entrelassement.png`;
}

function clearZip() {
  state.zipBlob = null;

  if (state.zipUrl) {
    URL.revokeObjectURL(state.zipUrl);
    state.zipUrl = "";
  }
}

function render() {
  const total = state.items.length;
  const interlaced = state.items.filter((item) => item.interlaced).length;
  const converted = state.items.filter((item) => item.status === "done").length;
  const hasWork = state.items.some((item) => item.status !== "error");

  refs.totalCount.textContent = String(total);
  refs.interlacedCount.textContent = String(interlaced);
  refs.convertedCount.textContent = String(converted);

  refs.convertButton.disabled = !hasWork || state.busy;
  refs.downloadButton.disabled = !state.zipUrl || state.busy;

  if (!state.items.length) {
    refs.statusLine.textContent = state.notice || "Aucune horreur entrelacee chargee pour le moment.";
    refs.fileList.innerHTML =
      '<li class="empty-state">Importe un ou plusieurs PNG et le site les reexportera en version normale, sans cette absurdité d\'entrelassement.</li>';
    return;
  }

  if (state.notice) {
    refs.statusLine.textContent = state.notice;
  } else if (state.busy) {
    refs.statusLine.textContent = "Nettoyage en cours. On casse les genoux de l'entrelassement fichier par fichier.";
  } else if (state.zipUrl) {
    refs.statusLine.textContent = "ZIP pret. Tu peux telecharger les PNG nettoyes.";
  } else if (interlaced > 0) {
    refs.statusLine.textContent = `${interlaced} fichier(s) entrelasses detectes. Il est temps de virer cette vieille honte.`;
  } else {
    refs.statusLine.textContent =
      "Aucun entrelassement detecte, mais les PNG peuvent quand meme etre reconstruits proprement.";
  }

  refs.fileList.innerHTML = state.items
    .map((item) => {
      const flavorClass =
        item.status === "error"
          ? "error"
          : item.status === "done"
            ? "normal"
            : item.interlaced
              ? "interlaced"
              : "pending";

      const flavorLabel =
        item.status === "error"
          ? "erreur"
          : item.status === "done"
            ? "converti"
            : item.interlaced
              ? "entrelasse"
              : item.interlaced === false
                ? "normal"
                : "analyse";

      const dimensions =
        item.width && item.height ? `${item.width}x${item.height}` : "dimensions inconnues";

      const cardClass =
        item.status === "error" ? "file-card is-error" : item.status === "done" ? "file-card is-done" : "file-card";

      return `
        <li class="${cardClass}">
          <div class="file-head">
            <p class="file-name">${escapeHtml(item.file.name)}</p>
            <span class="badge ${flavorClass}">${flavorLabel}</span>
          </div>
          <div class="file-meta">
            <span>${formatBytes(item.file.size)}</span>
            <span>${dimensions}</span>
          </div>
          <p class="file-status">${escapeHtml(item.message)}</p>
        </li>
      `;
    })
    .join("");
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

render();
