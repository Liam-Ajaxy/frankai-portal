import { api } from "../api.client.js";
import { h, fmtAgo } from "../dom.util.js";
import { field, errorLine } from "../ui.util.js";
import { navigate } from "../router.js";

export const title = "Connect your terminal";

const banner = (kind, heading, text) => h("div", { class: `banner banner-${kind}` }, h("h2", {}, heading), h("p", {}, text));

export async function render(container) {
  const code = (new URLSearchParams(location.search).get("code") ?? "").trim().toUpperCase();

  // No code in the link: let the person type the one their terminal shows
  if (!code) {
    const input = h("input", { type: "text", placeholder: "ABCD-EFGH", maxlength: 12, required: true, autocomplete: "off" });
    const form = h(
      "form",
      { class: "stack" },
      h("p", { class: "muted" }, "Run frankai login in your terminal, choose the browser option, then type the code it shows."),
      field("Code from your terminal", input),
      h("button", { class: "btn", type: "submit" }, "Continue")
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      navigate(`/connect?code=${encodeURIComponent(input.value.trim())}`);
    });
    container.replaceChildren(form);
    return;
  }

  let info;
  try {
    info = await api(`/device/info?code=${encodeURIComponent(code)}`);
  } catch (err) {
    container.replaceChildren(
      banner("bad", "This link doesn't work", err.message),
      h("p", {}, "Run ", h("code", {}, "frankai login"), " in your terminal for a fresh one.")
    );
    return;
  }

  const error = errorLine();
  const approve = h("button", { class: "btn", type: "button" }, "Yes, connect it");
  const deny = h("button", { class: "btn btn-ghost", type: "button" }, "No, that wasn't me");

  async function decide(path, done) {
    approve.disabled = deny.disabled = true;
    error.textContent = "";
    try {
      await api(path, { method: "POST", body: { user_code: info.user_code } });
      container.replaceChildren(done);
    } catch (err) {
      error.textContent = err.message;
      approve.disabled = deny.disabled = false;
    }
  }
  approve.addEventListener("click", () =>
    decide("/device/approve", banner("good", "Connected!", "Go back to your terminal: it signs in by itself. You can close this tab."))
  );
  deny.addEventListener("click", () =>
    decide("/device/deny", banner("warn", "Nothing was connected", "The terminal was refused. If you didn't start this, you can ignore it."))
  );

  container.replaceChildren(
    h("p", { class: "muted" }, "A terminal is asking to sign in to your Frank AI account."),
    h(
      "div",
      { class: "card section" },
      h("div", { class: "card-label" }, "Code (it must match your terminal)"),
      h("div", { class: "card-value mono" }, info.user_code),
      h("div", { class: "card-sub" }, `${info.device_name} · from ${info.requested_from} · ${fmtAgo(info.requested_at)}`)
    ),
    h("p", {}, "Only continue if you just ran ", h("code", {}, "frankai login"), " on your own computer. Approving gives it a Terminal key for your account."),
    h("div", { class: "actions" }, approve, deny),
    error
  );
}