/*! Queueline embed v1 — https://queueline-rouge.vercel.app
 * Usage: <script src="https://YOUR-QUEUELINE/embed.js" data-waitlist="WAITLIST_ID" async></script>
 * Optional: data-target="#css-selector" (mount point), data-button="Join", data-accent="#0f766e", data-placeholder="you@company.com"
 */
(function () {
  "use strict";
  var scripts = [];
  if (document.currentScript) scripts.push(document.currentScript);
  var tagged = document.querySelectorAll("script[data-waitlist]");
  for (var i = 0; i < tagged.length; i++) if (scripts.indexOf(tagged[i]) < 0) scripts.push(tagged[i]);

  for (var j = 0; j < scripts.length; j++) boot(scripts[j]);

  function boot(script) {
    if (!script || script.__queueline) return;
    var id = script.getAttribute("data-waitlist");
    if (!id) return;
    script.__queueline = true;
    var api = new URL(script.src, location.href).origin + "/api/waitlists/" + encodeURIComponent(id);
    var mode = script.getAttribute("data-mode") === "hosted" ? "hosted" : "widget";
    var accent = safeColor(script.getAttribute("data-accent")) || "#0f5c4d";
    var buttonText = script.getAttribute("data-button") || "Join the waitlist";
    var placeholder = script.getAttribute("data-placeholder") || "you@example.com";

    var target = script.getAttribute("data-target");
    var host = target ? document.querySelector(target) : null;
    if (!host) {
      host = document.createElement("div");
      script.parentNode.insertBefore(host, script.nextSibling);
    }
    host.setAttribute("data-queueline-widget", id);
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    var storeKey = "queueline:" + id;
    var shownAt = Date.now();
    var info = null;

    var style = document.createElement("style");
    style.textContent = css(accent, mode);
    root.appendChild(style);
    var box = document.createElement("div");
    box.className = "ql " + mode;
    box.setAttribute("aria-live", "polite");
    root.appendChild(box);

    // A status key in the URL (from the confirmation link) wins over local storage.
    var params = new URLSearchParams(location.search);
    var urlKey = params.get("me");
    if (urlKey && /^[a-z0-9]{20}$/.test(urlKey)) save(urlKey);
    var ref = (params.get("ref") || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);

    renderForm();
    fetchJson(api).then(function (r) {
      if (r.ok) {
        info = r.data;
        updateCount();
      } else if (r.status === 404) {
        box.innerHTML = '<p class="err">This waitlist is not available.</p>';
      }
    });
    var key = load();
    if (key) {
      fetchJson(api + "/status?key=" + key).then(function (r) {
        if (r.ok) renderStatus(r.data, false);
        else if (r.status === 404) forget();
      });
    }

    function renderForm(message) {
      box.innerHTML =
        '<form class="form" novalidate>' +
        '<label class="sr" for="ql-email-' + id + '">Email address</label>' +
        '<div class="row">' +
        '<input id="ql-email-' + id + '" name="email" type="email" autocomplete="email" required placeholder="' + esc(placeholder) + '">' +
        '<button type="submit">' + esc(buttonText) + "</button>" +
        "</div>" +
        '<div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>' +
        '<p class="msg" role="status">' + (message ? esc(message) : "") + "</p>" +
        '<p class="count"></p>' +
        "</form>";
      updateCount();
      var form = box.querySelector("form");
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var email = form.email.value.trim();
        var msg = box.querySelector(".msg");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
          msg.textContent = "Enter a valid email address.";
          msg.className = "msg err";
          form.email.setAttribute("aria-invalid", "true");
          form.email.focus();
          return;
        }
        var btn = form.querySelector("button");
        btn.disabled = true;
        btn.textContent = "Joining…";
        msg.textContent = "";
        // The server rejects submissions faster than a person could type; wait out the remainder instead.
        var wait = Math.max(0, 700 - (Date.now() - shownAt));
        new Promise(function (r) { setTimeout(r, wait); }).then(function () { return fetchJson(api + "/signups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email, ref: ref || null, website: form.website.value, elapsed: Date.now() - shownAt, source: mode }),
        }); }).then(function (r) {
          btn.disabled = false;
          btn.textContent = buttonText;
          if (!r.ok) {
            msg.textContent = (r.data && r.data.message) || "Couldn't join right now. Please try again.";
            msg.className = "msg err";
            return;
          }
          if (r.data.statusKey) save(r.data.statusKey);
          renderStatus(r.data, true);
        });
      });
    }

    function renderStatus(d, fresh) {
      if (!d || !d.referralLink) {
        box.innerHTML = '<p class="big">Thanks!</p>';
        return;
      }
      if (d.status === "admitted") {
        box.innerHTML =
          '<div class="done"><p class="label">Your status</p><p class="big">You’re in.</p>' +
          "<p>Your spot has been offered. Watch your inbox for next steps.</p>" +
          '<button type="button" class="link" data-act="other">Not you? Use another email</button></div>';
        wireOther();
        return;
      }
      var pos = d.position;
      var of = d.total ? ' <span class="of">of ' + fmt(d.total) + "</span>" : "";
      var pts = d.pointsPerReferral;
      var lead = d.existing ? "You’re already on the list." : fresh ? "You’re on the list." : "Welcome back.";
      var share = encodeURIComponent(d.referralLink);
      var text = encodeURIComponent("I just joined the waitlist" + (info && info.name ? " for " + info.name : "") + ". Join me:");
      box.innerHTML =
        '<div class="done">' +
        '<p class="label">' + esc(lead) + "</p>" +
        '<p class="big" data-testid="ql-position">#' + fmt(pos) + of + "</p>" +
        (pts > 0
          ? "<p>Each friend who joins with your link moves you up " + pts + " spot" + (pts === 1 ? "" : "s") + ". " +
            friends(d.referrals) + "</p>"
          : "<p>Share your link with friends. " + friends(d.referrals) + "</p>") +
        '<label class="sr" for="ql-link-' + id + '">Your referral link</label>' +
        '<div class="row"><input id="ql-link-' + id + '" class="mono" readonly value="' + esc(d.referralLink) + '">' +
        '<button type="button" data-act="copy">Copy link</button></div>' +
        '<p class="share">Share on ' +
        '<a target="_blank" rel="noopener" href="https://x.com/intent/post?text=' + text + "&url=" + share + '">X</a> · ' +
        '<a target="_blank" rel="noopener" href="https://wa.me/?text=' + text + "%20" + share + '">WhatsApp</a> · ' +
        '<a target="_blank" rel="noopener" href="https://www.linkedin.com/sharing/share-offsite/?url=' + share + '">LinkedIn</a> · ' +
        '<a href="mailto:?subject=' + text + "&body=" + share + '">Email</a></p>' +
        (load() ? "" : '<p class="hint">Bookmark this page link to check your spot later.</p>') +
        '<button type="button" class="link" data-act="other">Not you? Use another email</button>' +
        "</div>";
      var copy = box.querySelector('[data-act="copy"]');
      copy.addEventListener("click", function () {
        var input = box.querySelector(".mono");
        var done = function () {
          copy.textContent = "Copied";
          setTimeout(function () { copy.textContent = "Copy link"; }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(input.value).then(done, function () { input.select(); });
        else { input.select(); document.execCommand && document.execCommand("copy"); done(); }
      });
      wireOther();
    }

    function wireOther() {
      var b = box.querySelector('[data-act="other"]');
      if (b) b.addEventListener("click", function () { forget(); shownAt = Date.now(); renderForm(); });
    }

    function updateCount() {
      var el = box.querySelector(".count");
      if (el && info && info.count) el.textContent = fmt(info.count) + (info.count === 1 ? " person has" : " people have") + " joined.";
    }

    function save(k) { try { localStorage.setItem(storeKey, k); } catch (e) {} }
    function load() { try { var v = localStorage.getItem(storeKey); return v && /^[a-z0-9]{20}$/.test(v) ? v : null; } catch (e) { return null; } }
    function forget() { try { localStorage.removeItem(storeKey); } catch (e) {} }
  }

  function fetchJson(url, opts) {
    return fetch(url, opts || {})
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
      })
      .catch(function () { return { ok: false, status: 0, data: { message: "Network error. Check your connection and try again." } }; });
  }
  function friends(n) {
    return 'Friends who joined through it: <span data-testid="ql-referrals">' + n + "</span>.";
  }
  function fmt(n) { return typeof n === "number" ? n.toLocaleString() : "–"; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function safeColor(c) { return c && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : null; }

  function css(accent, mode) {
    var big = mode === "hosted" ? "56px" : "40px";
    return (
      ":host{all:initial;display:block}" +
      ".ql{font:16px/1.5 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#16181d;max-width:520px}" +
      ".ql.widget{background:#fff;border:1px solid #d9dce1;border-radius:10px;padding:20px}" +
      ".row{display:flex;gap:8px;flex-wrap:wrap}" +
      "input{flex:1 1 220px;min-width:0;font:inherit;padding:11px 12px;border:1px solid #9aa1ab;border-radius:6px;background:#fff;color:#16181d}" +
      "input:focus{outline:2px solid " + accent + ";outline-offset:1px;border-color:" + accent + "}" +
      "input[aria-invalid=true]{border-color:#b42318}" +
      "button{font:inherit;font-weight:600;padding:11px 16px;border:0;border-radius:6px;background:" + accent + ";color:#fff;cursor:pointer}" +
      "button:hover{filter:brightness(1.08)}button:focus-visible{outline:2px solid #16181d;outline-offset:2px}button:disabled{opacity:.6;cursor:wait}" +
      "button.link{background:none;color:#4a515c;padding:0;font-weight:400;text-decoration:underline;margin-top:12px;font-size:14px}" +
      ".msg{min-height:1.2em;margin:8px 0 0;font-size:14px;color:#4a515c}.msg.err,.err{color:#b42318}" +
      ".count{margin:4px 0 0;font-size:14px;color:#4a515c}" +
      ".label{margin:0;font-size:14px;color:#4a515c}" +
      ".big{margin:2px 0 8px;font-size:" + big + ";line-height:1.05;font-weight:700;letter-spacing:-0.02em;font-variant-numeric:tabular-nums}" +
      ".of{font-size:.4em;font-weight:500;color:#4a515c;letter-spacing:0}" +
      ".done p{margin:0 0 10px}.share{font-size:14px;color:#4a515c}.share a{color:#16181d}" +
      ".hint{font-size:13px;color:#4a515c}" +
      ".mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:14px;background:#f6f7f8}" +
      ".hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}" +
      ".sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}"
    );
  }
})();
