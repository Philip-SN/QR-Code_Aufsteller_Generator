import { generate } from "@pdfme/generator";
import { barcodes, image, svg } from "@pdfme/schemas";

//##################
// GLOBAL VARIABLES
const TEMPLATE_FILE_NAME = "QR-Code_Aufsteller_TEMPLATE.pdf";
let debounceTimer = null;

//###############
// PDFME PLUGINS
const plugins = {
  qrcode: barcodes.qrcode,
  image,
  svg,
};

//##############
// GLOBAL STATE
/**
 * @typedef {Object} State
 * @property {"text" | "image"} mode - current input mode
 * @property {string} inputText - input text to use for QR-Code when mode is set to "text"
 * @property {boolean} imageIsSvg - bool if the input image is an SVG
 * @property {string | ImageData | null} inputImageData - loaded image data (e.g., base64 string, URL, or ImageData)
 * @property {string} inputImageName - original filename of the loaded image
 * @property {string} inputImageSizeText - human-readable file size string (e.g., "200 KB") of the uploaded image
 * @property {Uint8Array | null} templatePdfBytes - raw byte array of the template PDF
 * @property {boolean} isGenerating - bool indicating an active PDF build process
 * @property {Blob | null} currentPdfBlob - PDF binary as a Blob
 * @property {string | null} currentPdfUrl - object URL (`blob:...`) of `currentPdfBlob`
 */

/** @type {State} */
const state = {
  mode: "text",
  inputText: "https://www.sn.at/sn-card/",
  imageIsSvg: false,
  inputImageData: null,
  inputImageName: "",
  inputImageSizeText: "",
  templatePdfBytes: null,
  isGenerating: false,
  currentPdfBlob: null,
  currentPdfUrl: null,
};

//##############
// DOM ELEMENTS
const elements = {
  // input tabs
  urlTab: document.querySelector("#urlTab"),
  imgTab: document.querySelector("#imgTab"),
  urlPane: document.querySelector("#urlPane"),
  imgPane: document.querySelector("#imgPane"),
  // url/text input
  urlInput: document.querySelector("#urlInput"),
  // img upload
  imgDropzone: document.querySelector("#imgDropzone"),
  imgFileInput: document.querySelector("#imgFileInput"),
  dropzoneEmpty: document.querySelector("#dropzoneEmpty"),
  dropzoneLoaded: document.querySelector("#dropzoneLoaded"),
  imgThumb: document.querySelector("#imgThumb"),
  imgFileName: document.querySelector("#imgFileName"),
  imgFileSize: document.querySelector("#imgFileSize"),
  removeImgBtn: document.querySelector("#removeImgBtn"),
  // preview section
  previewStatus: document.querySelector("#previewStatus"),
  pdfPreviewFrame: document.querySelector("#pdfPreviewFrame"),
  loadingOverlay: document.querySelector("#loadingOverlay"),
  // preview btns
  downloadPdfBtn: document.querySelector("#downloadPdfBtn"),
  printPdfBtn: document.querySelector("#printPdfBtn"),
  openTabBtn: document.querySelector("#openTabBtn"),
};

//######
// INIT
if (document.readyState === "complete") {
  init();
} else {
  window.addEventListener("DOMContentLoaded", () => {
    init();
  });
}

//###########
// FUNCTIONS
async function init() {
  setupEventListeners();

  try {
    await loadTemplatePdf();
    executePdfGeneration();
  } catch (err) {
    console.error("loading template failed:", err);
    elements.previewStatus.innerHTML = `<span style="color: #ef4444;">keine Vorlage gefunden!</span>`;
    alert(err.message);
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

// convert to PNG via canvas
async function fileToRasterPng(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || 512;
        canvas.height = img.naturalHeight || 512;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const pngDataUrl = canvas.toDataURL("image/png");
        resolve(pngDataUrl);
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Das Bild konnte nicht dekodiert werden."));
    };

    img.src = objectUrl;
  });
}

// load static template PDF from static folder
async function loadTemplatePdf() {
  const candidateUrls = [`./${TEMPLATE_FILE_NAME}`, TEMPLATE_FILE_NAME, new URL(TEMPLATE_FILE_NAME, window.location.href).href];

  for (const url of candidateUrls) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const header = new TextDecoder().decode(bytes.slice(0, 5));
        if (header.startsWith("%PDF")) {
          state.templatePdfBytes = bytes;
          return;
        }
      }
    } catch {
      // fail and try next url
    }
  }

  throw new Error(`Die Vorlage "${TEMPLATE_FILE_NAME}" konnte nicht gefunden oder geladen werden.`);
}

// PDF generation
function buildTemplateAndInputs() {
  let qrType = "qrcode";
  let qrContent = "https://www.sn.at/sn-card/";

  switch (state?.mode) {
    case "text":
      if (state?.inputText.trim()) {
        qrContent = state.inputText.trim();
      } else {
        console.error("got input mode 'text', but faulty input. got:", state?.inputText);
      }
      break;

    case "image":
      if (state?.inputImageData) {
        if (state.imageIsSvg) {
          qrType = "svg";
          qrContent = state.inputImageData;
        } else {
          qrType = "image";
          qrContent = state.inputImageData;
        }
      } else {
        console.error("faulty inputImageData:", state?.inputImageData);
      }
      break;

    default:
      console.error("input mode not valid, got:", state?.mode);
      break;
  }

  const template = {
    basePdf: state.templatePdfBytes,
    schemas: [
      [
        {
          name: "aufsteller_code",
          type: qrType,
          position: { x: 49, y: 75 },
          width: 50,
          height: 50,
        },
      ],
      [], // page 2 unmodified
    ],
  };

  const inputs = [{ aufsteller_code: qrContent }];

  return { template, inputs };
}

function scheduleGenerate(delay = 180) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    executePdfGeneration();
  }, delay);
}

async function executePdfGeneration() {
  if (state?.isGenerating || !state?.templatePdfBytes) return;
  state.isGenerating = true;
  elements.loadingOverlay.style.display = "";

  try {
    const { template, inputs } = buildTemplateAndInputs();
    const pdfBytes = await generate({ template, inputs, plugins });

    // cleanup
    if (state.currentPdfUrl) {
      URL.revokeObjectURL(state.currentPdfUrl);
    }

    const blob = new Blob([pdfBytes.buffer], { type: "application/pdf" });
    state.currentPdfBlob = blob;
    state.currentPdfUrl = URL.createObjectURL(blob);

    // update preview
    elements.pdfPreviewFrame.src = state.currentPdfUrl;
    elements.previewStatus.innerHTML = "";
  } catch (err) {
    console.error("PDF generation error:", err);
    elements.previewStatus.innerHTML = `<span style="color: #ef4444;">⚠️ Fehler</span>`;
  } finally {
    state.isGenerating = false;
    elements.loadingOverlay.style.display = "none";
  }
}

// image file handlers
async function processImageFile(file) {
  if (!file) return;

  const isSvg = file.name.toLowerCase().endsWith(".svg") || file.type === "image/svg+xml";

  try {
    if (isSvg) {
      const textContent = await file.text();
      if (!(textContent.includes("<svg") && textContent.includes("</svg>"))) {
        alert("Die Datei enthält kein gültiges SVG-Markup.");
        return;
      }
      state.inputImageData = textContent;
      state.imageIsSvg = true;
      elements.imgThumb.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(textContent)}`;
    } else {
      const pngDataUrl = await fileToRasterPng(file);
      state.inputImageData = pngDataUrl;
      state.imageIsSvg = false;
      elements.imgThumb.src = pngDataUrl;
    }

    state.inputImageName = file.name;
    state.inputImageSizeText = formatBytes(file.size);

    elements.imgFileName.textContent = state.inputImageName;
    elements.imgFileSize.textContent = state.inputImageSizeText;

    elements.dropzoneEmpty.classList.add("hide");
    elements.dropzoneLoaded.classList.remove("hide");

    scheduleGenerate(0);
  } catch (err) {
    console.error("Error processing image:", err);
    alert(`Das Bild konnte nicht verarbeitet werden: ${err.message}`);
  }
}

function removeImage() {
  state.inputImageData = null;
  state.imageIsSvg = false;
  state.inputImageName = "";
  state.inputImageSizeText = "";
  elements.imgFileInput.value = "";
  elements.dropzoneLoaded.classList.add("hide");
  elements.dropzoneEmpty.classList.remove("hide");
  scheduleGenerate(0);
}

function setupEventListeners() {
  // input mode tab switch
  elements.urlTab.addEventListener("click", () => {
    state.mode = "text";
    elements.urlTab.classList.add("active");
    elements.urlTab.setAttribute("aria-selected", "true");
    elements.imgTab.classList.remove("active");
    elements.imgTab.setAttribute("aria-selected", "false");
    elements.urlPane.classList.add("active");
    elements.imgPane.classList.remove("active");
    scheduleGenerate(0);
  });
  elements.imgTab.addEventListener("click", () => {
    state.mode = "image";
    elements.imgTab.classList.add("active");
    elements.imgTab.setAttribute("aria-selected", "true");
    elements.urlTab.classList.remove("active");
    elements.urlTab.setAttribute("aria-selected", "false");
    elements.imgPane.classList.add("active");
    elements.urlPane.classList.remove("active");
    scheduleGenerate(0);
  });

  // url/text input
  elements.urlInput.addEventListener("input", (e) => {
    state.inputText = e.target.value;
    scheduleGenerate(200);
  });

  // dropzone click
  elements.imgDropzone.addEventListener("click", (e) => {
    if (e.target.closest("#removeImgBtn")) return;
    elements.imgFileInput.click();
  });
  // input change event
  elements.imgFileInput.addEventListener("change", (e) => {
    if (e?.target.files[0]) {
      processImageFile(e.target.files[0]);
    }
  });
  // dropzone drag & drop events
  elements.imgDropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    elements.imgDropzone.classList.add("dragover");
  });
  elements.imgDropzone.addEventListener("dragleave", () => {
    elements.imgDropzone.classList.remove("dragover");
  });
  elements.imgDropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    elements.imgDropzone.classList.remove("dragover");
    if (e?.dataTransfer.files[0]) {
      processImageFile(e.dataTransfer.files[0]);
    }
  });

  // remove img btn
  elements.removeImgBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    removeImage();
  });

  // download pdf btn
  elements.downloadPdfBtn.addEventListener("click", () => {
    if (!state.currentPdfUrl) return;
    const a = document.createElement("a");
    a.href = state.currentPdfUrl;
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = `SN-Card-Aufsteller-A5-${dateStr}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

  // print pdf btn
  elements.printPdfBtn.addEventListener("click", () => {
    if (!state.currentPdfUrl) return;
    try {
      const iframe = elements.pdfPreviewFrame;
      if (iframe?.contentWindow) {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        return;
      }
    } catch (err) {
      console.warn("Direct iframe printing not permitted by browser sandbox:", err);
    }
    // fallback: open in new tab for direct printing
    window.open(state.currentPdfUrl, "_blank");
  });

  // open pdf in new tab btn
  elements.openTabBtn.addEventListener("click", () => {
    if (!state.currentPdfUrl) return;
    window.open(state.currentPdfUrl, "_blank");
  });
}
