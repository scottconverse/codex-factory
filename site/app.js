const menuButton = document.querySelector(".menu-button");
const navLinks = document.querySelector("#nav-links");

if (menuButton && navLinks) {
  const closeMenu = () => {
    menuButton.setAttribute("aria-expanded", "false");
    navLinks.classList.remove("open");
  };

  menuButton.addEventListener("click", () => {
    const open = menuButton.getAttribute("aria-expanded") === "true";
    menuButton.setAttribute("aria-expanded", String(!open));
    navLinks.classList.toggle("open", !open);
  });

  navLinks.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
      closeMenu();
      menuButton.focus();
    }
  });
}

const copyPromptButton = document.querySelector(".copy-prompt");
const copyStatus = document.querySelector(".copy-status");

if (copyPromptButton && copyStatus) {
  copyPromptButton.addEventListener("click", async () => {
    const prompt = document.getElementById(copyPromptButton.dataset.copyTarget);
    try {
      await navigator.clipboard.writeText(prompt.textContent);
      copyStatus.textContent = "Coordinator prompt copied.";
    } catch {
      copyStatus.textContent = "Copy failed. Select the prompt manually.";
    }
  });
}
