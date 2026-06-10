/**
 * DOM UI: the join modal (name + optional server URL), the bottom toolbar
 * (mute / share), and the screen-share viewer overlay. Canvas handles the
 * world; everything chrome-like lives here.
 */
import { Net } from "./net.ts";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, css: Partial<CSSStyleDeclaration>, html?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e.style, css);
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** Ask for a display name (and let advanced users override the server). */
export function mountJoin(onJoin: (name: string) => void): void {
  const saved = localStorage.getItem("hearth_name") || "";
  const overlay = el("div", {
    position: "fixed", inset: "0", background: "#0b0d12ee",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: "9000",
  });
  overlay.innerHTML = `
    <div style="background:#1b1f2a;border:1px solid #ffffff14;border-radius:16px;
                padding:32px;width:min(340px,90vw);display:flex;flex-direction:column;gap:14px;color:#e6e8ef">
      <div style="font-size:24px;font-weight:700;letter-spacing:1px">🔥 Hearth</div>
      <div style="font-size:13px;color:#8b91a3">Walk around. Hear who's near you.</div>
      <input id="h-name" placeholder="Your name" maxlength="24" value="${saved}"
        style="padding:11px 13px;border-radius:9px;border:none;font-size:15px;background:#0f1117;color:#fff" />
      <button id="h-join" style="padding:12px;border:none;border-radius:9px;background:#f0883e;
        color:#1b1f2a;font-weight:700;font-size:15px;cursor:pointer">Enter</button>
      <details style="font-size:12px;color:#8b91a3">
        <summary style="cursor:pointer">Advanced: server</summary>
        <input id="h-server" placeholder="leave blank for default"
          style="margin-top:8px;width:100%;padding:9px;border-radius:8px;border:none;background:#0f1117;color:#fff" />
      </details>
    </div>`;
  document.body.appendChild(overlay);

  const nameInput = overlay.querySelector<HTMLInputElement>("#h-name")!;
  const serverInput = overlay.querySelector<HTMLInputElement>("#h-server")!;
  const join = () => {
    const name = nameInput.value.trim() || "anon";
    localStorage.setItem("hearth_name", name);
    if (serverInput.value.trim()) Net.setUrl(serverInput.value);
    overlay.remove();
    onJoin(name);
  };
  overlay.querySelector("#h-join")!.addEventListener("click", join);
  nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
  nameInput.focus();
}

export interface Toolbar {
  setMuted(m: boolean): void;
  setSharing(s: boolean): void;
}

export function mountToolbar(opts: {
  onToggleMute: () => void;
  onToggleShare: () => void;
}): Toolbar {
  const bar = el("div", {
    position: "fixed", bottom: "16px", left: "50%", transform: "translateX(-50%)",
    display: "flex", gap: "10px", zIndex: "8000",
  });
  const mkBtn = (label: string) =>
    el("button", {
      padding: "10px 16px", borderRadius: "10px", border: "none", cursor: "pointer",
      background: "#1b1f2aee", color: "#e6e8ef", fontSize: "14px", fontWeight: "600",
      backdropFilter: "blur(6px)",
    }, label);

  const muteBtn = mkBtn("🎤 Mute");
  const shareBtn = mkBtn("🖥 Share");
  muteBtn.addEventListener("click", opts.onToggleMute);
  shareBtn.addEventListener("click", opts.onToggleShare);
  bar.append(muteBtn, shareBtn);
  document.body.appendChild(bar);

  return {
    setMuted(m) { muteBtn.innerHTML = m ? "🔇 Muted" : "🎤 Mute"; },
    setSharing(s) {
      shareBtn.innerHTML = s ? "🛑 Stop share" : "🖥 Share";
      shareBtn.style.background = s ? "#f0883e" : "#1b1f2aee";
      shareBtn.style.color = s ? "#1b1f2a" : "#e6e8ef";
    },
  };
}

/** Viewer overlay for incoming, in-range screen shares (one tile per peer). */
export class ScreenOverlay {
  private container: HTMLElement;
  private videos = new Map<string, HTMLVideoElement>();

  constructor() {
    this.container = el("div", {
      position: "fixed", top: "12px", right: "12px", display: "flex",
      flexDirection: "column", gap: "8px", zIndex: "7000", maxWidth: "42vw",
    });
    document.body.appendChild(this.container);
  }

  set(peerId: string, stream: MediaStream | null, name: string): void {
    if (!stream) { this.clear(peerId); return; }
    let v = this.videos.get(peerId);
    if (!v) {
      const wrap = el("div", {
        position: "relative", borderRadius: "10px", overflow: "hidden",
        border: "2px solid #f0883e", background: "#000",
      });
      wrap.id = `share-${peerId}`;
      v = el("video", { width: "100%", display: "block" });
      v.autoplay = true;
      v.playsInline = true;
      v.muted = true; // screen-share audio not handled; avoid echo
      const tag = el("div", {
        position: "absolute", bottom: "0", left: "0", right: "0",
        padding: "3px 6px", fontSize: "11px", background: "#000a", color: "#fff",
      }, `🖥 ${name}`);
      wrap.append(v, tag);
      this.container.appendChild(wrap);
      this.videos.set(peerId, v);
    }
    v.srcObject = stream;
    v.play().catch(() => {});
  }

  clear(peerId: string): void {
    const v = this.videos.get(peerId);
    if (v) {
      document.getElementById(`share-${peerId}`)?.remove();
      this.videos.delete(peerId);
    }
  }
}
