const hostEl = document.getElementById("host") as HTMLParagraphElement | null;
const apiUrlEl = document.getElementById("api-url") as HTMLParagraphElement | null;
const outEl = document.getElementById("out") as HTMLPreElement | null;

declare const API_BASE_URL: string;

const host = window.location.hostname;
const apiUrl = API_BASE_URL || "";

if (hostEl) hostEl.textContent = `Frontend host: ${host}`;
if (apiUrlEl) apiUrlEl.textContent = `Calling: ${apiUrl}`;

if (!apiUrl) {
  if (outEl) outEl.textContent = "API request failed: API_BASE_URL is not configured";
  throw new Error("missing API_BASE_URL");
}

fetch(apiUrl)
  .then(async (res) => {
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  })
  .then((data) => {
    if (outEl) outEl.textContent = JSON.stringify(data, null, 2);
  })
  .catch((err) => {
    if (outEl) outEl.textContent = `API request failed: ${String(err)}`;
  });
