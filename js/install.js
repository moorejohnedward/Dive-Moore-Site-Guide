/* Offline support and the "Install app" button. */
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

let installPrompt = null;
const installBtn = document.getElementById("install");
addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  installPrompt = e;
  installBtn.classList.add("show");
});
installBtn.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installBtn.classList.remove("show");
});
addEventListener("appinstalled", () => installBtn.classList.remove("show"));
