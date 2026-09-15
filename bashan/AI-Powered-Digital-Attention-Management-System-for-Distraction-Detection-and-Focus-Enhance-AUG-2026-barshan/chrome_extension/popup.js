document.addEventListener("DOMContentLoaded", async () => {
  const token = await getAuthToken();
  const loginSec = document.getElementById("loginSection");
  const statsSec = document.getElementById("statsSection");
  const authStatus = document.getElementById("authStatus");

  if (!token) {
    loginSec.classList.remove("hidden");
    statsSec.classList.add("hidden");
    authStatus.textContent = "Disconnected";
    authStatus.className = "status-indicator offline";
  } else {
    loginSec.classList.add("hidden");
    statsSec.classList.remove("hidden");
    authStatus.textContent = "Connected";
    authStatus.className = "status-indicator online";

    // Load quick sync stat
    try {
      const summary = await fetchTodayBrowsingSummary();
      const countEl = document.getElementById("todaySyncCount");
      if (countEl && summary) {
        const mins = Math.round((summary.total_time_secs || 0) / 60);
        countEl.textContent = mins > 0 ? `${mins}m tracked today` : "Connected & Ready";
      }
    } catch (e) {}
  }

  // Connect / Login to App
  document.getElementById("loginBtn").addEventListener("click", async () => {
    const user = document.getElementById("usernameInput").value.trim();
    const pass = document.getElementById("passwordInput").value.trim();
    const errEl = document.getElementById("loginError");
    errEl.textContent = "";

    const baseUrl = await getApiBase();

    try {
      const res = await fetch(`${baseUrl}/auth/token/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, password: pass })
      });
      if (res.ok) {
        const data = await res.json();
        await setAuthTokens(data.access, data.refresh);
        location.reload();
      } else {
        errEl.textContent = "Invalid username or password";
      }
    } catch (e) {
      errEl.textContent = "Cannot connect to FocusGuard App (is Django running?)";
    }
  });

  // Disconnect
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await chrome.storage.local.remove(["jwtAccessToken", "jwtRefreshToken"]);
    location.reload();
  });

  // Open the main Web App
  document.getElementById("openAppBtn").addEventListener("click", async () => {
    const baseUrl = await getApiBase();
    const appUrl = baseUrl.replace(/\/api\/?$/, "/");
    chrome.tabs.create({ url: appUrl });
  });
});
