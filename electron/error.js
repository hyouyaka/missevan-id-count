const params = new URLSearchParams(window.location.search);
const message = params.get("message");
if (message) {
  document.getElementById("message").textContent = message;
}
