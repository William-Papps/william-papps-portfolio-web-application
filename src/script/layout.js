const css = document.createElement("link");
css.rel = "stylesheet";

async function loadParts(id, file) {
  const res = await fetch(file);
  document.getElementById(id).innerHTML = await res.text();
}

loadParts("header", "/components/header.html");
loadParts("footer", "/components/footer.html");
