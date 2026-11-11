/**
 * auth_guard.js — 層級二雲端受保護題庫與學校帳號白名單門禁系統
 * 最高管理員：taboogirl@mail.lhvs.tyc.edu.tw, tinachang19790501@gmail.com
 * 允許學生網域：@s.lhvs.tyc.edu.tw (及授權老師 @mail.lhvs.tyc.edu.tw)
 */
(function () {
  const FB_API_KEY = atob("QUl6YVN5QVROM3VjalgwREJ1S2plZm1NMGJTZXR4LTNZYk42T09J");
  const FIRESTORE_DOC_BASE = "https://firestore.googleapis.com/v1/projects/smartclass-tinachang-0501/databases/(default)/documents";

  const ADMIN_EMAILS = [
    "taboogirl@mail.lhvs.tyc.edu.tw",
    "tinachang19790501@gmail.com"
  ];

  const ALLOWED_DOMAINS = [
    "@s.lhvs.tyc.edu.tw",
    "@mail.lhvs.tyc.edu.tw"
  ];

  const firebaseConfig = {
    apiKey: FB_API_KEY,
    authDomain: "smartclass-tinachang-0501.firebaseapp.com",
    projectId: "smartclass-tinachang-0501",
    storageBucket: "smartclass-tinachang-0501.firebasestorage.app",
    messagingSenderId: "643663499622",
    appId: "1:643663499622:web:eb4554c230c0095a2b38a7"
  };

  if (typeof firebase !== "undefined" && !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  function isAdminEmail(email) {
    return ADMIN_EMAILS.includes((email || "").toLowerCase().trim());
  }

  function isSchoolDomain(email) {
    const lower = (email || "").toLowerCase().trim();
    return ALLOWED_DOMAINS.some(d => lower.endsWith(d));
  }

  async function getFreshIdToken(forceRefresh = false) {
    const user = firebase.auth().currentUser;
    if (!user) return null;
    return await user.getIdToken(forceRefresh);
  }

  async function authFetchFirestore(relativePath, options = {}) {
    const token = await getFreshIdToken(false);
    const headers = Object.assign({}, options.headers || {}, {
      "Content-Type": "application/json"
    });
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const url = `${FIRESTORE_DOC_BASE}/${relativePath}${relativePath.includes("?") ? "&" : "?"}key=${FB_API_KEY}`;
    return fetch(url, Object.assign({}, options, { headers }));
  }

  async function checkWhitelistAccess(user) {
    if (!user || !user.email) {
      return { authorized: false, reason: "not_signed_in" };
    }
    const email = user.email.toLowerCase().trim();
    const idToken = await user.getIdToken(true);

    if (isAdminEmail(email)) {
      return {
        authorized: true,
        isAdmin: true,
        email,
        idToken,
        whitelistInfo: {
          name: user.displayName || "張慧玲老師",
          classId: "教師管理員",
          seatNum: 0
        }
      };
    }

    if (!user.emailVerified || !isSchoolDomain(email)) {
      return {
        authorized: false,
        isAdmin: false,
        reason: "wrong_domain",
        email
      };
    }

    try {
      const res = await authFetchFirestore(`idiom_whitelist/${encodeURIComponent(email)}`, { method: "GET" });
      if (res.ok) {
        const doc = await res.json();
        const f = doc.fields || {};
        if (f.active && f.active.booleanValue === false) {
          return { authorized: false, isAdmin: false, reason: "not_whitelisted", email };
        }
        return {
          authorized: true,
          isAdmin: false,
          email,
          idToken,
          whitelistInfo: {
            name: f.name?.stringValue || user.displayName || "",
            classId: f.classId?.stringValue || "",
            seatNum: parseInt(f.seatNum?.integerValue || "0", 10)
          }
        };
      }
      return {
        authorized: false,
        isAdmin: false,
        reason: res.status === 404 || res.status === 403 ? "not_whitelisted" : "error",
        status: res.status,
        email
      };
    } catch (err) {
      return { authorized: false, isAdmin: false, reason: "network_error", error: err.message, email };
    }
  }

  async function loadProtectedFlashcards() {
    const metaRes = await authFetchFirestore("idiom_protected_bank/fc_meta", { method: "GET" });
    if (!metaRes.ok) {
      throw new Error(`無法載入受保護成語閃卡庫 (HTTP ${metaRes.status})`);
    }
    const metaDoc = await metaRes.json();
    const totalChunks = parseInt(metaDoc.fields?.totalChunks?.integerValue || "0", 10);
    if (!totalChunks) throw new Error("雲端閃卡設定異常 (totalChunks=0)");

    const reqs = [];
    for (let i = 0; i < totalChunks; i++) {
      reqs.push(
        authFetchFirestore(`idiom_protected_bank/fc_chunk_${i}`, { method: "GET" })
          .then(async r => {
            if (!r.ok) throw new Error(`Chunk ${i} 讀取失敗 (${r.status})`);
            const d = await r.json();
            return JSON.parse(d.fields.data.stringValue);
          })
      );
    }
    const parts = await Promise.all(reqs);
    const merged = [].concat(...parts);
    window.all_flashcards_data = merged;
    return merged;
  }

  async function loadProtectedQuestions() {
    const metaRes = await authFetchFirestore("idiom_protected_bank/qs_meta", { method: "GET" });
    if (!metaRes.ok) {
      throw new Error(`無法載入受保護會考題庫 (HTTP ${metaRes.status})`);
    }
    const metaDoc = await metaRes.json();
    const totalChunks = parseInt(metaDoc.fields?.totalChunks?.integerValue || "0", 10);
    if (!totalChunks) throw new Error("雲端題庫設定異常 (totalChunks=0)");

    const reqs = [];
    for (let i = 0; i < totalChunks; i++) {
      reqs.push(
        authFetchFirestore(`idiom_protected_bank/qs_chunk_${i}`, { method: "GET" })
          .then(async r => {
            if (!r.ok) throw new Error(`Chunk ${i} 讀取失敗 (${r.status})`);
            const d = await r.json();
            return JSON.parse(d.fields.data.stringValue);
          })
      );
    }
    const parts = await Promise.all(reqs);
    const merged = {};
    parts.forEach(obj => Object.assign(merged, obj));
    window.all_sets_data = merged;
    return merged;
  }

  function injectGateStylesAndDOM() {
    if (document.getElementById("schoolAuthGateOverlay")) return;

    const style = document.createElement("style");
    style.textContent = `
      .school-auth-gate {
        position: fixed;
        inset: 0;
        background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans TC", "Microsoft JhengHei", sans-serif;
      }
      .school-auth-card {
        background: #ffffff;
        color: #0f172a;
        max-width: 460px;
        width: 100%;
        border-radius: 22px;
        padding: 32px 26px;
        box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
        text-align: center;
      }
      .school-auth-badge {
        display: inline-block;
        background: #dbeafe;
        color: #1d4ed8;
        font-weight: 800;
        font-size: 0.82rem;
        padding: 4px 12px;
        border-radius: 999px;
        margin-bottom: 12px;
      }
      .school-auth-card h2 {
        font-size: 1.45rem;
        font-weight: 900;
        margin: 0 0 10px;
        color: #0f172a;
      }
      .school-auth-desc {
        font-size: 0.92rem;
        color: #475569;
        line-height: 1.6;
        margin: 0 0 22px;
      }
      .btn-google-login {
        width: 100%;
        padding: 14px 18px;
        border-radius: 14px;
        border: 1.5px solid #cbd5e1;
        background: #ffffff;
        color: #0f172a;
        font-size: 1rem;
        font-weight: 800;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        transition: all 0.2s;
      }
      .btn-google-login:hover {
        background: #f8fafc;
        border-color: #2563eb;
        transform: translateY(-1px);
      }
      .school-auth-status-box {
        margin-top: 16px;
        padding: 14px;
        border-radius: 12px;
        font-size: 0.88rem;
        line-height: 1.55;
        text-align: left;
      }
      .school-auth-error {
        background: #fef2f2;
        border: 1px solid #fecaca;
        color: #991b1b;
      }
      .school-auth-loading {
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        color: #1e40af;
        text-align: center;
        font-weight: 700;
      }
      .school-auth-actions {
        display: flex;
        gap: 8px;
        margin-top: 14px;
      }
      .school-auth-btn-sec {
        flex: 1;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-weight: 800;
        font-size: 0.88rem;
        cursor: pointer;
      }
      .school-auth-btn-pri {
        flex: 1;
        padding: 10px 12px;
        border-radius: 10px;
        border: none;
        background: #2563eb;
        color: #ffffff;
        font-weight: 800;
        font-size: 0.88rem;
        cursor: pointer;
      }
    `;
    document.head.appendChild(style);

    const gate = document.createElement("div");
    gate.id = "schoolAuthGateOverlay";
    gate.className = "school-auth-gate";
    gate.innerHTML = `
      <div class="school-auth-card">
        <div class="school-auth-badge">🔒 六和高中校內師生專屬系統</div>
        <h2>🎓 國中國文成語智能學習庫</h2>
        <p class="school-auth-desc">
          本系統題庫受學校授權保護，僅限 <strong>@s.lhvs.tyc.edu.tw</strong> 且經<strong>張慧玲老師白名單開通</strong>之班級學生登入使用。
        </p>

        <div id="authGateActionArea">
          <button class="btn-google-login" id="btnGoogleSignIn" onclick="window.IdiomAuth.triggerLogin()">
            <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
            <span>使用學校 Google 帳號登入</span>
          </button>
        </div>

        <div id="authGateStatusBox" class="school-auth-status-box school-auth-loading">
          ⏳ 正在檢查登入狀態與授權權限...
        </div>
      </div>
    `;
    document.body.appendChild(gate);
  }

  function setStatusHTML(html, isError = false, showLoginBtn = false) {
    const box = document.getElementById("authGateStatusBox");
    const actionArea = document.getElementById("authGateActionArea");
    if (box) {
      box.style.display = html ? "block" : "none";
      box.className = `school-auth-status-box ${isError ? "school-auth-error" : "school-auth-loading"}`;
      box.innerHTML = html;
    }
    if (actionArea) {
      actionArea.style.display = showLoginBtn ? "block" : "none";
    }
  }

  async function triggerLogin() {
    setStatusHTML("🔄 正在開啟 Google 學校帳號驗證視窗...", false, false);
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      await firebase.auth().signInWithPopup(provider);
    } catch (err) {
      console.error("Google Sign-In error:", err);
      if (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-browser") {
        await firebase.auth().signInWithRedirect(provider);
        return;
      }
      if (err.code === "auth/unauthorized-domain") {
        setStatusHTML(
          `⚠️ <strong>網域尚未授權 (${window.location.hostname})</strong><br>` +
          `請老師前往 Firebase Console → Authentication → Settings → Authorized domains，將 <code>${window.location.hostname}</code> 加入授權網域後重新整理即可！`,
          true,
          true
        );
        return;
      }
      if (err.code === "auth/popup-closed-by-user") {
        setStatusHTML("您取消了登入，請點擊上方按鈕重新使用學校帳號登入。", false, true);
        return;
      }
      setStatusHTML(`登入發生錯誤：${err.message}`, true, true);
    }
  }

  async function switchAccount() {
    await firebase.auth().signOut();
    localStorage.removeItem("current_idiom_student");
    triggerLogin();
  }

  async function signOutOnly() {
    await firebase.auth().signOut();
    localStorage.removeItem("current_idiom_student");
    window.location.reload();
  }

  // 解析雜亂名單文字 (支援 Gmail 複製格式、CSV、純 Email)
  function smartParseWhitelistText(rawText, defaultClass = "910") {
    const lines = rawText.split(/\r?\n|[,;]+(?![^()]*\))/);
    const results = [];
    const seen = new Set();

    // 亦支援整段文字中抓取所有 email 與緊鄰前面的姓名
    const pairRegex = /([^\n,;<>()\[\]]{0,30})\s*[<(]?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\s*[>)]?/g;
    let match;
    while ((match = pairRegex.exec(rawText)) !== null) {
      const email = match[2].toLowerCase().trim();
      if (seen.has(email)) continue;
      seen.add(email);

      let rawName = (match[1] || "").trim();
      rawName = rawName.replace(/\[國中部\]/g, "").replace(/\[.*?\]/g, "").replace(/["'<>()]/g, "").trim();
      // 若為 CSV 前面可能有班級座號數字，取最後中文姓名
      const zhMatch = rawName.match(/[\u4e00-\u9fa5]{2,5}$/);
      const cleanName = zhMatch ? zhMatch[0] : (rawName.length <= 12 ? rawName : "");

      results.push({
        email,
        name: cleanName,
        classId: defaultClass
      });
    }
    return results;
  }

  let _onReadyCallback = null;

  function requireSchoolAuth(mode /* 'flashcards' | 'questions' */, onReady) {
    _onReadyCallback = onReady;
    injectGateStylesAndDOM();

    firebase.auth().getRedirectResult().catch(err => console.warn("Redirect check:", err));

    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) {
        setStatusHTML("請點擊上方按鈕，登入您的學校 Google 帳號 (<code>@s.lhvs.tyc.edu.tw</code>)。", false, true);
        return;
      }

      setStatusHTML(`🔍 正在核對帳號權限：<strong>${user.email}</strong> ...`, false, false);
      const authRes = await checkWhitelistAccess(user);
      window.currentAuthResult = authRes;

      if (!authRes.authorized) {
        if (authRes.reason === "wrong_domain") {
          setStatusHTML(
            `⛔ <strong>非授權學校帳號</strong><br>` +
            `目前登入為 <code>${authRes.email}</code>，本系統僅限六和高中 <strong>@s.lhvs.tyc.edu.tw</strong> 學生與授權教師使用。<br>` +
            `<div class="school-auth-actions">` +
            `<button class="school-auth-btn-pri" onclick="window.IdiomAuth.switchAccount()">🔄 改用學校帳號登入</button>` +
            `</div>`,
            true,
            false
          );
        } else if (authRes.reason === "not_whitelisted") {
          setStatusHTML(
            `🔒 <strong>此帳號尚未加入授權白名單</strong><br>` +
            `您的學校帳號 <code>${authRes.email}</code> 目前不在授課教師的班級授權名單中。<br>` +
            `請通知 <strong>張慧玲老師</strong> 於後台白名單開通您的帳號後，點擊下方「重新檢查」。` +
            `<div class="school-auth-actions">` +
            `<button class="school-auth-btn-pri" onclick="window.location.reload()">🔄 重新檢查權限</button>` +
            `<button class="school-auth-btn-sec" onclick="window.IdiomAuth.switchAccount()">🚪 切換其他帳號</button>` +
            `</div>`,
            true,
            false
          );
        } else {
          setStatusHTML(
            `⚠️ 驗證連線異常 (${authRes.reason})，請重試。` +
            `<div class="school-auth-actions">` +
            `<button class="school-auth-btn-pri" onclick="window.location.reload()">🔄 重試</button>` +
            `<button class="school-auth-btn-sec" onclick="window.IdiomAuth.switchAccount()">🚪 切換帳號</button>` +
            `</div>`,
            true,
            false
          );
        }
        return;
      }

      // 驗證通過！從雲端讀取受保護題庫
      setStatusHTML(`✅ 驗證通過（${authRes.isAdmin ? "👑 教師管理員" : "🎓 授權學生"}），正在安全載入雲端題庫...`, false, false);
      try {
        if (mode === "flashcards") {
          await loadProtectedFlashcards();
        } else if (mode === "questions") {
          await loadProtectedQuestions();
        }
        const gate = document.getElementById("schoolAuthGateOverlay");
        if (gate) gate.style.display = "none";
        if (typeof _onReadyCallback === "function") {
          _onReadyCallback(authRes);
        }
      } catch (err) {
        setStatusHTML(
          `❌ 雲端題庫載入失敗：${err.message}` +
          `<div class="school-auth-actions">` +
          `<button class="school-auth-btn-pri" onclick="window.location.reload()">🔄 重新載入</button>` +
          `<button class="school-auth-btn-sec" onclick="window.IdiomAuth.switchAccount()">🚪 切換帳號</button>` +
          `</div>`,
          true,
          false
        );
      }
    });
  }

  window.IdiomAuth = {
    ADMIN_EMAILS,
    ALLOWED_DOMAINS,
    FIRESTORE_DOC_BASE,
    FB_API_KEY,
    isAdminEmail,
    isSchoolDomain,
    getFreshIdToken,
    authFetchFirestore,
    triggerLogin,
    switchAccount,
    signOutOnly,
    smartParseWhitelistText,
    requireSchoolAuth
  };
})();
