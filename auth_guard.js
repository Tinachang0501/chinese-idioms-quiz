/**
 * auth_guard.js — 嚴格 Google 學校信箱綁定門禁系統
 * 規則：強制學生使用六和高中 Google 帳號 (@s.lhvs.tyc.edu.tw) 登入驗證
 * 杜絕學生互相猜學號冒名，雲端題庫與個人作答歷程嚴格綁定
 * 最高管理員：taboogirl@mail.lhvs.tyc.edu.tw, tinachang19790501@gmail.com
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

  // 永遠使用標準 Firebase Auth Domain，避免 Google OAuth 重新導向網址不匹配
  const firebaseConfig = {
    apiKey: FB_API_KEY,
    authDomain: "smartclass-tinachang-0501.firebaseapp.com",
    projectId: "smartclass-tinachang-0501",
    storageBucket: "smartclass-tinachang-0501.firebasestorage.app",
    messagingSenderId: "643663499622",
    appId: "1:643663499622:web:eb4554c230c0095a2b38a7"
  };

  if (typeof firebase !== "undefined" && !firebase.apps.length) {
    try {
      firebase.initializeApp(firebaseConfig);
    } catch (e) {
      console.warn("Firebase init warning:", e);
    }
  }

  function isAdminEmail(email) {
    return ADMIN_EMAILS.includes((email || "").toLowerCase().trim());
  }

  function isSchoolDomain(email) {
    const lower = (email || "").toLowerCase().trim();
    return ALLOWED_DOMAINS.some(d => lower.endsWith(d));
  }

  async function getFreshIdToken(forceRefresh = false) {
    try {
      const user = firebase.auth().currentUser;
      if (!user) return null;
      return await user.getIdToken(forceRefresh);
    } catch (e) {
      return null;
    }
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

    if (!isSchoolDomain(email)) {
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
            classId: f.classId?.stringValue || "國中",
            seatNum: parseInt(f.seatNum?.integerValue || "1", 10)
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
        box-sizing: border-box;
      }
      .school-auth-badge {
        display: inline-block;
        background: #eff6ff;
        color: #2563eb;
        padding: 4px 12px;
        border-radius: 999px;
        font-size: 0.8rem;
        font-weight: 800;
        margin-bottom: 10px;
        border: 1px solid #bfdbfe;
      }
      .school-auth-card h2 {
        font-size: 1.35rem;
        font-weight: 900;
        margin: 0 0 8px 0;
        color: #0f172a;
      }
      .school-auth-desc {
        font-size: 0.86rem;
        color: #64748b;
        line-height: 1.5;
        margin: 0 0 20px 0;
      }
      .btn-google-login {
        width: 100%;
        padding: 13px 16px;
        background: #ffffff;
        color: #1e293b;
        border: 2px solid #cbd5e1;
        border-radius: 12px;
        font-size: 0.98rem;
        font-weight: 800;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.06);
        transition: all 0.15s ease;
      }
      .btn-google-login:hover {
        background: #f8fafc;
        border-color: #94a3b8;
      }
      .school-auth-status-box {
        margin-top: 16px;
        padding: 12px 14px;
        border-radius: 10px;
        font-size: 0.88rem;
        line-height: 1.5;
        display: none;
      }
      .school-auth-loading {
        background: #f8fafc;
        color: #475569;
        border: 1px solid #e2e8f0;
      }
      .school-auth-error {
        background: #fef2f2;
        color: #b91c1c;
        border: 1px solid #fecaca;
        text-align: left;
      }
      .school-auth-actions {
        display: flex;
        gap: 8px;
        margin-top: 10px;
      }
      .school-auth-btn-pri {
        flex: 1;
        padding: 9px 12px;
        border-radius: 8px;
        border: none;
        background: #2563eb;
        color: #ffffff;
        font-weight: 800;
        font-size: 0.86rem;
        cursor: pointer;
      }
      .school-auth-btn-sec {
        flex: 1;
        padding: 9px 12px;
        border-radius: 8px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-weight: 800;
        font-size: 0.86rem;
        cursor: pointer;
      }
    `;
    document.head.appendChild(style);

    const ua = (navigator.userAgent || "").toLowerCase();
    const isInApp = ua.includes("line") || ua.includes("fbav") || ua.includes("fban") || ua.includes("instagram") || ua.includes("micromessenger");

    const gate = document.createElement("div");
    gate.id = "schoolAuthGateOverlay";
    gate.className = "school-auth-gate";
    gate.innerHTML = `
      <div class="school-auth-card">
        <div class="school-auth-badge">🔒 六和高中校內專屬系統</div>
        <h2>🎓 國中國文成語智能學習庫</h2>
        <p class="school-auth-desc">
          為防範冒名使用並保護每位同學的作答紀錄，本系統<strong>嚴格綁定 Google 學校帳號</strong>。<br>
          請點擊下方按鈕登入您的 <strong>@s.lhvs.tyc.edu.tw</strong> 帳號。
        </p>

        ${isInApp ? `
        <div style="background:#fffbeb; border:1px solid #fde68a; color:#92400e; border-radius:10px; padding:10px 12px; font-size:0.82rem; margin-bottom:14px; text-align:left; line-height:1.45;">
          📲 <strong>偵測到您在 LINE / 社群 App 內建瀏覽器中</strong><br>
          Google 基於安全規範會阻擋在 App 內部登入。<br>
          👉 請點擊右上角「<code>⋮</code>」或「<code>⋯</code>」，選擇<strong>「在 Chrome 或 Safari 瀏覽器中開啟」</strong>。
        </div>` : ''}

        <div id="authGateActionArea">
          <button class="btn-google-login" id="btnGoogleSignIn" onclick="window.IdiomAuth.triggerLogin()">
            <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
            <span>使用學校 Google 帳號登入</span>
          </button>
        </div>

        <div id="authGateStatusBox" class="school-auth-status-box school-auth-loading">
          ⏳ 正在檢查身分驗證狀態...
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

  // 登入觸發：優先採用最相容且零白畫面的 signInWithPopup
  function triggerLogin() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    setStatusHTML("🔄 正在開啟 Google 學校帳號驗證...", false, false);

    firebase.auth().signInWithPopup(provider)
      .then((result) => {
        if (result && result.user) {
          console.log("登入成功:", result.user.email);
        }
      })
      .catch((err) => {
        console.error("Google Sign-In error:", err);
        if (err.code === "auth/popup-closed-by-user") {
          setStatusHTML("您關閉了登入視窗，請點擊上方按鈕重新登入。", false, true);
          return;
        }
        if (err.code === "auth/popup-blocked" || err.code === "auth/cancelled-popup-request") {
          setStatusHTML(
            `⚠️ <strong>瀏覽器阻擋了登入彈窗</strong><br>` +
            `<span style="font-size:0.84rem;color:#64748b;">請允許彈窗，或點選下方按鈕改用跳轉登入：</span><br>` +
            `<button class="school-auth-btn-pri" style="margin-top:10px; width:100%;" onclick="window.IdiomAuth.triggerRedirectLogin()">🔄 改用直接跳轉方式登入</button>`,
            true,
            true
          );
          return;
        }
        if (err.code === "auth/unauthorized-domain") {
          setStatusHTML(
            `⛔ <strong>此網域尚未加入 Firebase 授權網域</strong><br>` +
            `<span style="font-size:0.84rem;color:#64748b;">請前往 Firebase 控制台將目前網址加入「授權網域」，或直接使用官方直達網址：</span><br>` +
            `<a href="https://smartclass-tinachang-0501.firebaseapp.com/idiom/${_currentMode === 'questions' ? 'index.html' : 'flashcards.html'}" style="display:inline-block; margin-top:8px; color:#2563eb; font-weight:bold;">🔗 點此開啟 Firebase 官方直達版</a>`,
            true,
            true
          );
          return;
        }
        setStatusHTML(`登入發生錯誤 (${err.code || '未知'})：${err.message}`, true, true);
      });
  }

  function triggerRedirectLogin() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    setStatusHTML("🔄 正在跳轉至 Google 驗證...", false, false);
    firebase.auth().signInWithRedirect(provider).catch(err => {
      setStatusHTML(`跳轉失敗：${err.message}`, true, true);
    });
  }

  async function switchAccount() {
    try {
      await firebase.auth().signOut();
    } catch (e) {}
    localStorage.removeItem("current_idiom_student");
    const gate = document.getElementById("schoolAuthGateOverlay");
    if (gate) gate.style.display = "flex";
    triggerLogin();
  }

  async function signOutOnly() {
    try {
      await firebase.auth().signOut();
    } catch (e) {}
    localStorage.removeItem("current_idiom_student");
  }

  let _currentMode = "flashcards";
  let _onReadyCallback = null;

  function requireSchoolAuth(mode /* 'flashcards' | 'questions' */, onReady) {
    _currentMode = mode;
    _onReadyCallback = onReady;
    injectGateStylesAndDOM();

    // 檢查是否有剛才 Redirect 回來的登入結果
    firebase.auth().getRedirectResult()
      .then(res => {
        if (res && res.user) {
          console.log("Redirect login completed for:", res.user.email);
        }
      })
      .catch(err => {
        console.warn("getRedirectResult warning:", err);
      });

    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) {
        setStatusHTML("請點擊上方按鈕，使用您的學校 Google 帳號 (<code>@s.lhvs.tyc.edu.tw</code>) 登入。", false, true);
        return;
      }

      setStatusHTML(`🔍 正在核對帳號權限：<strong>${user.email}</strong> ...`, false, false);
      const authRes = await checkWhitelistAccess(user);
      window.currentAuthResult = authRes;

      if (!authRes.authorized) {
        if (authRes.reason === "wrong_domain") {
          setStatusHTML(
            `⛔ <strong>非授權學校帳號</strong><br>` +
            `目前登入為 <code>${authRes.email}</code>。<br>` +
            `為保護學生作答個資，本系統僅限六和高中 <strong>@s.lhvs.tyc.edu.tw</strong> 學生使用。<br>` +
            `<div class="school-auth-actions">` +
            `<button class="school-auth-btn-pri" onclick="window.IdiomAuth.switchAccount()">🔄 切換為學校帳號</button>` +
            `</div>`,
            true,
            false
          );
        } else if (authRes.reason === "not_whitelisted") {
          setStatusHTML(
            `🔒 <strong>此帳號尚未加入授權名單</strong><br>` +
            `您的學校帳號 <code>${authRes.email}</code> 目前不在張慧玲老師的 904、905、910 班級名單中。<br>` +
            `請洽張慧玲老師於後台開通您的權限。` +
            `<div class="school-auth-actions">` +
            `<button class="school-auth-btn-pri" onclick="window.location.reload()">🔄 重新檢查</button>` +
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

      // 驗證成功！
      const wl = authRes.whitelistInfo || {};
      const verifiedStudent = {
        email: authRes.email,
        studentKey: authRes.email,
        classId: wl.classId || (authRes.isAdmin ? "教師" : "國中"),
        seatNum: wl.seatNum || 1,
        name: wl.name || authRes.email.split("@")[0],
        isAdmin: !!authRes.isAdmin,
        loginAt: new Date().toISOString()
      };
      localStorage.setItem("current_idiom_student", JSON.stringify(verifiedStudent));

      setStatusHTML(`✅ 驗證成功（${authRes.isAdmin ? "👑 教師管理員" : `🎓 ${wl.classId}班 ${wl.name}`}），正在安全載入雲端題庫...`, false, false);

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

  function smartParseWhitelistText(rawText, defaultClass = "未分類") {
    if (!rawText) return [];
    const lines = rawText.split(/[\r\n;,]+/);
    const results = [];
    const seen = new Set();

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      const emailMatch = line.match(/[a-zA-Z0-9._%+-]+@s\.lhvs\.tyc\.edu\.tw/i) || line.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (!emailMatch) continue;
      const email = emailMatch[0].toLowerCase();
      if (seen.has(email)) continue;
      seen.add(email);

      let rawName = line.replace(emailMatch[0], "");
      rawName = rawName.replace(/\[國中部\]/g, "").replace(/\[.*?\]/g, "").replace(/["'<>()]/g, "").trim();
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
    triggerRedirectLogin,
    switchAccount,
    signOutOnly,
    smartParseWhitelistText,
    requireSchoolAuth
  };
})();
