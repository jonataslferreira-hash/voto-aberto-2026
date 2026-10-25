import { soundNotes } from "./election-events.js";
export function createEventDisplay({ overlay, soundButton, soundStatus, app }) {
  let audio = null,
    enabled = false,
    timeout = null,
    returnFocus = null;
  const status = (message) => {
    soundStatus.textContent = message;
    soundButton.setAttribute("aria-pressed", String(enabled));
    soundButton.textContent = enabled ? "Silenciar sons" : "Ativar sons";
  };
  async function toggleSound() {
    if (enabled) {
      enabled = false;
      status("Sons desativados.");
      return;
    }
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw new Error("Áudio não suportado neste navegador.");
      audio ??= new Audio();
      await audio.resume();
      if (audio.state !== "running")
        throw new Error(
          "O navegador não liberou o áudio. Toque novamente para ativar.",
        );
      enabled = true;
      status("Sons ativados para viradas e confirmação oficial de vitória.");
      play({ kind: "lead", number: "22" });
    } catch (error) {
      enabled = false;
      status(error.message);
    }
  }
  function play(event) {
    if (!enabled || !audio || audio.state !== "running") return;
    const time = audio.currentTime;
    for (const note of soundNotes(event.number, event.kind)) {
      const oscillator = audio.createOscillator(),
        gain = audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = note.frequency;
      gain.gain.setValueAtTime(0, time + note.start);
      gain.gain.linearRampToValueAtTime(0.11, time + note.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        time + note.start + note.duration,
      );
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start(time + note.start);
      oscillator.stop(time + note.start + note.duration + 0.02);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    }
  }
  function dismiss() {
    clearTimeout(timeout);
    overlay.hidden = true;
    overlay.classList.remove("is-visible");
    app.inert = false;
    if (overlay.contains(document.activeElement) && returnFocus?.isConnected)
      returnFocus.focus();
    returnFocus = null;
  }
  function show(event, label) {
    if (document.hidden) return;
    dismiss();
    returnFocus = document.activeElement;
    overlay.dataset.kind = event.kind;
    overlay.dataset.color = event.color;
    overlay.setAttribute(
      "role",
      event.kind === "victory" ? "dialog" : "status",
    );
    if (event.kind === "victory") {
      overlay.setAttribute("aria-modal", "true");
      app.inert = true;
    } else overlay.removeAttribute("aria-modal");
    overlay.querySelector("[data-event-eyebrow]").textContent =
      event.kind === "victory" ? "CONFIRMADO PELO TSE" : "VIRADA NA APURAÇÃO";
    overlay.querySelector("[data-event-name]").textContent = event.name;
    overlay.querySelector("[data-event-message]").textContent =
      event.kind === "victory" ? "VENCEU A ELEIÇÃO" : "ASSUMIU A LIDERANÇA";
    overlay.querySelector("[data-event-context]").textContent =
      `${label} · ${new Date(event.at).toLocaleString("pt-BR", { timeZone: "America/Bahia" })} · ${event.votes.toLocaleString("pt-BR")} votos`;
    const link = overlay.querySelector("[data-event-source]");
    link.href = event.source;
    link.textContent = "Consultar a fonte";
    overlay.hidden = false;
    overlay.classList.add("is-visible");
    if (event.kind === "victory")
      overlay.querySelector("[data-event-close]").focus();
    play(event);
    timeout = setTimeout(dismiss, event.kind === "victory" ? 8000 : 4500);
  }
  overlay
    .querySelector("[data-event-close]")
    .addEventListener("click", dismiss);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !overlay.hidden) dismiss();
    if (
      event.key === "Tab" &&
      !overlay.hidden &&
      overlay.dataset.kind === "victory"
    ) {
      const focusable = [...overlay.querySelectorAll("button,a")];
      const first = focusable[0],
        last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  soundButton.addEventListener("click", toggleSound);
  status("Toque em Ativar sons para permitir áudio neste navegador.");
  return { show, dismiss };
}
