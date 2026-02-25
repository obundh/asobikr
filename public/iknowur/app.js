const state = {
  playerId: getOrCreatePlayerId(),
  name: localStorage.getItem("iknowur_name") || "",
  partyId: localStorage.getItem("iknowur_party_id") || "",
  party: null,
  socket: null,
  pollTimer: null,
  activeTab: localStorage.getItem("iknowur_active_tab") || "status",
  noticeTimer: null,
};

const el = {
  nameInput: document.getElementById("name-input"),
  createPartyBtn: document.getElementById("create-party-btn"),
  partyCodeInput: document.getElementById("party-code-input"),
  joinPartyBtn: document.getElementById("join-party-btn"),
  authPanel: document.getElementById("auth-panel"),
  partyPanel: document.getElementById("party-panel"),
  partyCode: document.getElementById("party-code"),
  partyMeta: document.getElementById("party-meta"),
  copyCodeBtn: document.getElementById("copy-code-btn"),
  refreshBtn: document.getElementById("refresh-btn"),
  leavePartyBtn: document.getElementById("leave-party-btn"),
  statMembers: document.getElementById("stat-members"),
  statSubmitted: document.getElementById("stat-submitted"),
  statOpenClaims: document.getElementById("stat-open-claims"),
  tabNav: document.getElementById("tab-nav"),
  tabButtons: Array.from(document.querySelectorAll(".tab-btn")),
  tabPanels: Array.from(document.querySelectorAll(".tab-panel")),
  membersList: document.getElementById("members-list"),
  predictionProgress: document.getElementById("prediction-progress"),
  predictionForm: document.getElementById("prediction-form"),
  submitPredictionsBtn: document.getElementById("submit-predictions-btn"),
  predictionStatus: document.getElementById("prediction-status"),
  claimBox: document.getElementById("claim-box"),
  claimsList: document.getElementById("claims-list"),
  logList: document.getElementById("log-list"),
  notice: document.getElementById("notice"),
};

el.nameInput.value = state.name;

bindEvents();
render();

if (state.partyId) {
  fetchParty();
}

function bindEvents() {
  el.nameInput.addEventListener("input", () => {
    state.name = el.nameInput.value.trim();
    localStorage.setItem("iknowur_name", state.name);
  });

  el.createPartyBtn.addEventListener("click", createParty);
  el.joinPartyBtn.addEventListener("click", joinParty);
  el.refreshBtn.addEventListener("click", () => fetchParty(true));
  el.submitPredictionsBtn.addEventListener("click", submitPredictions);
  el.copyCodeBtn.addEventListener("click", copyPartyCode);
  el.leavePartyBtn.addEventListener("click", leaveParty);

  el.tabNav.addEventListener("click", (event) => {
    const target = event.target.closest(".tab-btn");
    if (!target) {
      return;
    }

    const tab = target.dataset.tab;
    if (tab) {
      setActiveTab(tab);
    }
  });
}

function getOrCreatePlayerId() {
  const existing = localStorage.getItem("iknowur_player_id");
  if (existing) {
    return existing;
  }

  const id = `player_${crypto.randomUUID()}`;
  localStorage.setItem("iknowur_player_id", id);
  return id;
}

function log(message) {
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString()} - ${message}`;
  el.logList.prepend(item);

  while (el.logList.children.length > 25) {
    el.logList.removeChild(el.logList.lastChild);
  }
}

function showNotice(message, type = "info") {
  el.notice.textContent = message;
  el.notice.classList.remove("hidden", "info", "error");
  el.notice.classList.add(type);

  if (state.noticeTimer) {
    clearTimeout(state.noticeTimer);
  }

  state.noticeTimer = setTimeout(() => {
    el.notice.classList.add("hidden");
  }, 2400);
}

async function api(method, url, body) {
  const options = { method, headers: {} };
  if (body) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

function requireName() {
  if (!state.name) {
    throw new Error("닉네임을 먼저 입력하세요.");
  }
}

function clearPartySession() {
  stopRealtimeSync();
  state.party = null;
  state.partyId = "";
  localStorage.removeItem("iknowur_party_id");
}

async function createParty() {
  try {
    requireName();
    setButtonBusy(el.createPartyBtn, true, "생성 중...");

    const data = await api("POST", "/api/parties", {
      playerId: state.playerId,
      name: state.name,
    });

    state.party = data.party;
    state.partyId = data.party.id;
    localStorage.setItem("iknowur_party_id", state.partyId);

    connectSocket();
    setActiveTab("status");
    render();

    log(`파티 생성 완료: ${state.party.code}`);
    showNotice(`파티 ${state.party.code} 생성 완료`);
  } catch (err) {
    log(`파티 생성 실패: ${err.message}`);
    showNotice(err.message, "error");
  } finally {
    setButtonBusy(el.createPartyBtn, false);
  }
}

async function joinParty() {
  try {
    requireName();

    const partyCode = el.partyCodeInput.value.trim().toUpperCase();
    if (!partyCode) {
      throw new Error("파티 코드를 입력하세요.");
    }

    setButtonBusy(el.joinPartyBtn, true, "참가 중...");

    const data = await api("POST", "/api/parties/join", {
      partyCode,
      playerId: state.playerId,
      name: state.name,
    });

    state.party = data.party;
    state.partyId = data.party.id;
    localStorage.setItem("iknowur_party_id", state.partyId);

    connectSocket();
    setActiveTab("status");
    render();

    log(`파티 참가 완료: ${state.party.code}`);
    showNotice(`파티 ${state.party.code} 참가 완료`);
  } catch (err) {
    log(`파티 참가 실패: ${err.message}`);
    showNotice(err.message, "error");
  } finally {
    setButtonBusy(el.joinPartyBtn, false);
  }
}

async function fetchParty(fromManualRefresh = false) {
  if (!state.partyId) {
    return;
  }

  try {
    const data = await api("GET", `/api/parties/${state.partyId}?playerId=${encodeURIComponent(state.playerId)}`);
    state.party = data.party;

    connectSocket();
    render();

    if (fromManualRefresh) {
      log("파티 상태 갱신 완료");
      showNotice("최신 상태를 불러왔습니다.");
    }
  } catch (err) {
    const brokenSession = err.message.includes("party not found") || err.message.includes("only party members");
    if (brokenSession) {
      clearPartySession();
      render();
      showNotice("저장된 파티 세션이 만료되어 초기화했습니다.", "error");
      return;
    }

    log(`파티 조회 실패: ${err.message}`);
    showNotice(err.message, "error");
  }
}

function connectSocket() {
  if (!state.partyId) {
    return;
  }

  if (typeof window.io !== "function") {
    startPolling();
    return;
  }

  stopPolling();

  if (!state.socket) {
    state.socket = window.io();
    state.socket.on("partyChanged", (payload) => {
      if (!payload || payload.partyId !== state.partyId) {
        return;
      }
      fetchParty();
    });
  }

  state.socket.emit("joinParty", { partyId: state.partyId });
}

function startPolling() {
  if (state.pollTimer || !state.partyId) {
    return;
  }

  state.pollTimer = setInterval(() => {
    fetchParty();
  }, 5000);
}

function stopPolling() {
  if (!state.pollTimer) {
    return;
  }

  clearInterval(state.pollTimer);
  state.pollTimer = null;
}

function stopRealtimeSync() {
  stopPolling();

  if (!state.socket) {
    return;
  }

  try {
    state.socket.disconnect();
  } catch (_err) {
    // no-op
  }

  state.socket = null;
}

function leaveParty() {
  clearPartySession();
  render();
  showNotice("이 기기에서 파티를 나갔습니다.");
  log("파티 세션 종료");
}

async function copyPartyCode() {
  if (!state.party?.code) {
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(state.party.code);
    } else {
      copyTextFallback(state.party.code);
    }

    showNotice(`코드 ${state.party.code} 복사 완료`);
    log("파티 코드 복사");
  } catch {
    showNotice("코드 복사에 실패했습니다.", "error");
  }
}

function copyTextFallback(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "readonly");
  area.style.position = "absolute";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  document.body.removeChild(area);
}

function setActiveTab(tab) {
  const validTabs = ["status", "predict", "claims", "log"];
  state.activeTab = validTabs.includes(tab) ? tab : "status";
  localStorage.setItem("iknowur_active_tab", state.activeTab);

  el.tabButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === state.activeTab);
  });

  el.tabPanels.forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.panel !== state.activeTab);
  });
}

function render() {
  const hasParty = Boolean(state.party);
  el.authPanel.classList.toggle("hidden", hasParty);
  el.partyPanel.classList.toggle("hidden", !hasParty);

  if (!hasParty) {
    return;
  }

  const party = state.party;
  const memberCount = party.members.length;
  const submittedCount = party.members.filter((member) => member.submittedPredictions).length;
  const openClaims = party.claims.filter((claim) => claim.status === "open").length;

  el.partyCode.textContent = party.code;
  el.partyMeta.textContent = `단계: ${party.stage === "collecting" ? "예측 수집" : "일상 플레이"}`;
  el.statMembers.textContent = String(memberCount);
  el.statSubmitted.textContent = `${submittedCount}/${memberCount}`;
  el.statOpenClaims.textContent = String(openClaims);

  renderMembers();
  renderPredictionForm();
  renderClaimBox();
  renderClaims();
  setActiveTab(state.activeTab);
}

function renderMembers() {
  const party = state.party;
  el.membersList.innerHTML = "";

  const sorted = [...party.members].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  sorted.forEach((member) => {
    const li = document.createElement("li");
    li.className = "member-card";

    const main = document.createElement("div");
    main.className = "member-main";

    const name = document.createElement("strong");
    name.textContent = member.id === state.playerId ? `${member.name} (나)` : member.name;

    const meta = document.createElement("p");
    const submitLabel = member.submittedPredictions ? "예측 제출 완료" : "예측 미제출";
    meta.textContent = submitLabel;

    main.appendChild(name);
    main.appendChild(meta);

    const score = document.createElement("div");
    score.className = "score-badge";
    score.textContent = `${member.score}점`;

    li.appendChild(main);
    li.appendChild(score);
    el.membersList.appendChild(li);
  });
}

function renderPredictionForm() {
  const party = state.party;
  el.predictionForm.innerHTML = "";

  const submitted = party.members.find((member) => member.id === state.playerId)?.submittedPredictions;

  if (party.stage !== "collecting") {
    el.submitPredictionsBtn.classList.add("hidden");
    el.predictionProgress.textContent = "예측 제출 단계가 종료되었습니다.";
    el.predictionStatus.textContent = "";
    return;
  }

  if (submitted) {
    el.submitPredictionsBtn.classList.add("hidden");
    el.predictionProgress.textContent = "내 예측 5개 제출 완료";
    el.predictionStatus.textContent = "다른 멤버가 제출을 마치면 자동으로 일상 플레이 단계로 전환됩니다.";
    return;
  }

  const others = party.members.filter((member) => member.id !== state.playerId);
  if (others.length === 0) {
    el.submitPredictionsBtn.classList.add("hidden");
    el.predictionProgress.textContent = "다른 멤버가 들어오면 예측 입력이 열립니다.";
    el.predictionStatus.textContent = "";
    return;
  }

  const existingDraft = getPredictionDraft();
  if (existingDraft.length !== 5) {
    const empty = Array.from({ length: 5 }, () => ({ targetId: others[0].id, text: "" }));
    setPredictionDraft(empty);
  }

  const rows = getPredictionDraft();
  const filledCount = rows.filter((row) => String(row.text || "").trim().length > 0).length;
  el.predictionProgress.textContent = `작성 진행: ${filledCount} / 5`;

  rows.forEach((row, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "prediction-row";

    const label = document.createElement("label");
    label.textContent = `${index + 1}. 예측 타겟`;

    const select = document.createElement("select");
    others.forEach((member) => {
      const option = document.createElement("option");
      option.value = member.id;
      option.textContent = member.name;
      option.selected = row.targetId === member.id;
      select.appendChild(option);
    });

    select.addEventListener("change", () => {
      const next = getPredictionDraft();
      next[index].targetId = select.value;
      setPredictionDraft(next);
    });

    const text = document.createElement("textarea");
    text.maxLength = 200;
    text.placeholder = "검증 가능한 행동 예측 문장을 적어주세요.";
    text.value = row.text;
    text.addEventListener("input", () => {
      const next = getPredictionDraft();
      next[index].text = text.value;
      setPredictionDraft(next);
      const count = next.filter((item) => String(item.text || "").trim().length > 0).length;
      el.predictionProgress.textContent = `작성 진행: ${count} / 5`;
    });

    wrapper.appendChild(label);
    wrapper.appendChild(select);
    wrapper.appendChild(text);
    el.predictionForm.appendChild(wrapper);
  });

  el.submitPredictionsBtn.classList.remove("hidden");
  el.predictionStatus.textContent = "제출 후 문장은 수정되지 않으며, 해시 커밋 검증으로 위변조가 방지됩니다.";
}

async function submitPredictions() {
  try {
    if (!state.party) {
      throw new Error("파티에 먼저 입장하세요.");
    }

    const draft = getPredictionDraft();
    if (!Array.isArray(draft) || draft.length !== 5) {
      throw new Error("예측 5개를 모두 작성하세요.");
    }

    setButtonBusy(el.submitPredictionsBtn, true, "암호화 제출 중...");

    const payload = [];
    const localRefs = [];

    for (const row of draft) {
      const text = String(row.text || "").trim();
      const targetId = row.targetId;

      if (!text || !targetId) {
        throw new Error("모든 예측에 타겟과 문장을 입력하세요.");
      }

      const salt = randomSalt();
      const commitHash = await hashCommit(text, salt);
      const encrypted = await encryptPrediction(text);

      payload.push({
        targetId,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        commitHash,
        algorithm: "AES-GCM",
      });

      localRefs.push({ targetId, text, salt });
    }

    const data = await api("POST", `/api/parties/${state.party.id}/predictions/submit`, {
      playerId: state.playerId,
      predictions: payload,
    });

    if (Array.isArray(data.predictionRefs)) {
      const storage = getPredictionLocalStore();
      data.predictionRefs.forEach((ref, index) => {
        storage[ref.id] = localRefs[index];
      });
      setPredictionLocalStore(storage);
    }

    clearPredictionDraft();
    state.party = data.party;
    render();

    log("예측 5개 암호화 제출 완료");
    showNotice("예측 5개 제출 완료");
    setActiveTab("status");
  } catch (err) {
    log(`예측 제출 실패: ${err.message}`);
    showNotice(err.message, "error");
  } finally {
    setButtonBusy(el.submitPredictionsBtn, false);
  }
}

function renderClaimBox() {
  el.claimBox.innerHTML = "";
  const party = state.party;

  if (party.stage !== "active") {
    const text = document.createElement("p");
    text.className = "hint";
    text.textContent = "모든 멤버가 예측 제출을 마치면 Claim이 열립니다.";
    el.claimBox.appendChild(text);
    return;
  }

  const myAvailable = party.predictions.filter((prediction) => {
    return prediction.authorId === state.playerId && prediction.claimStatus === "available";
  });

  if (myAvailable.length === 0) {
    const text = document.createElement("p");
    text.className = "hint";
    text.textContent = "등록 가능한 내 예측이 없습니다.";
    el.claimBox.appendChild(text);
    return;
  }

  const localStore = getPredictionLocalStore();
  const selectable = myAvailable.filter((prediction) => Boolean(localStore[prediction.id]));

  if (selectable.length === 0) {
    const text = document.createElement("p");
    text.className = "hint";
    text.textContent = "이 기기에 원문/솔트가 없어 Claim을 등록할 수 없습니다.";
    el.claimBox.appendChild(text);
    return;
  }

  const select = document.createElement("select");
  selectable.forEach((prediction) => {
    const option = document.createElement("option");
    const local = localStore[prediction.id];
    option.value = prediction.id;
    option.textContent = `${prediction.targetName} | ${local.text.slice(0, 42)}`;
    select.appendChild(option);
  });

  const preview = document.createElement("p");
  preview.className = "hint";

  const updatePreview = () => {
    const selected = localStore[select.value];
    preview.textContent = selected ? `선택 문장: ${selected.text}` : "";
  };

  select.addEventListener("change", updatePreview);
  updatePreview();

  const button = document.createElement("button");
  button.textContent = "선택한 예측 Claim 등록";
  button.addEventListener("click", async () => {
    try {
      const predictionId = select.value;
      const local = localStore[predictionId];
      if (!local) {
        throw new Error("로컬 원문 정보가 없습니다.");
      }

      setButtonBusy(button, true, "등록 중...");

      const data = await api("POST", `/api/parties/${party.id}/claims`, {
        playerId: state.playerId,
        predictionId,
        revealedText: local.text,
        salt: local.salt,
      });

      state.party = data.party;
      render();

      log("Claim 등록 완료");
      showNotice("Claim 등록 완료");
    } catch (err) {
      log(`Claim 등록 실패: ${err.message}`);
      showNotice(err.message, "error");
    } finally {
      setButtonBusy(button, false);
    }
  });

  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = "과반 찬성: +1점, 거절: -1점. 예측은 1회만 점수화됩니다.";

  el.claimBox.appendChild(select);
  el.claimBox.appendChild(preview);
  el.claimBox.appendChild(button);
  el.claimBox.appendChild(note);
}

function renderClaims() {
  el.claimsList.innerHTML = "";
  const party = state.party;

  if (!party.claims || party.claims.length === 0) {
    const li = document.createElement("li");
    li.textContent = "아직 Claim이 없습니다.";
    el.claimsList.appendChild(li);
    return;
  }

  const sorted = [...party.claims].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  sorted.forEach((claim) => {
    const li = document.createElement("li");
    li.className = "claim-card";

    const header = document.createElement("div");
    header.className = "claim-title";
    header.innerHTML = `<strong>${escapeHtml(claim.claimantName)}</strong> -> ${escapeHtml(claim.predictionTargetName)}`;

    const body = document.createElement("div");
    body.className = "claim-text";
    body.textContent = claim.revealedText || "";

    const status = document.createElement("div");
    status.className = `status-${claim.status}`;
    status.textContent = claim.status.toUpperCase();

    const meta = document.createElement("div");
    meta.className = "claim-meta";
    meta.textContent = `YES ${claim.yesVotes} / NO ${claim.noVotes}`;

    li.appendChild(header);
    li.appendChild(body);
    li.appendChild(status);
    li.appendChild(meta);

    const alreadyVoted = claim.votes.some((vote) => vote.voterId === state.playerId);
    const canVote = claim.status === "open" && claim.claimantId !== state.playerId && !alreadyVoted;

    if (canVote) {
      const actions = document.createElement("div");
      actions.className = "claim-actions";

      const yesBtn = document.createElement("button");
      yesBtn.textContent = "YES";
      yesBtn.addEventListener("click", () => voteClaim(claim.id, "yes", yesBtn));

      const noBtn = document.createElement("button");
      noBtn.className = "ghost";
      noBtn.textContent = "NO";
      noBtn.addEventListener("click", () => voteClaim(claim.id, "no", noBtn));

      actions.appendChild(yesBtn);
      actions.appendChild(noBtn);
      li.appendChild(actions);
    }

    if (claim.status === "open" && alreadyVoted) {
      const voted = document.createElement("div");
      voted.className = "hint";
      voted.textContent = "이미 투표했습니다.";
      li.appendChild(voted);
    }

    el.claimsList.appendChild(li);
  });
}

async function voteClaim(claimId, vote, button) {
  try {
    setButtonBusy(button, true, "투표 중...");

    const data = await api("POST", `/api/parties/${state.party.id}/claims/${claimId}/votes`, {
      playerId: state.playerId,
      vote,
    });

    state.party = data.party;
    render();

    log(`투표 완료: ${vote.toUpperCase()}`);
    showNotice(`투표 완료: ${vote.toUpperCase()}`);
  } catch (err) {
    log(`투표 실패: ${err.message}`);
    showNotice(err.message, "error");
  } finally {
    setButtonBusy(button, false);
  }
}

function setButtonBusy(button, isBusy, busyText = "처리 중...") {
  if (!button) {
    return;
  }

  if (isBusy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
    return;
  }

  button.textContent = button.dataset.originalText || button.textContent;
  button.disabled = false;
}

function getPredictionDraft() {
  const key = `iknowur_draft_${state.partyId}_${state.playerId}`;
  const raw = localStorage.getItem(key);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setPredictionDraft(value) {
  const key = `iknowur_draft_${state.partyId}_${state.playerId}`;
  localStorage.setItem(key, JSON.stringify(value));
}

function clearPredictionDraft() {
  const key = `iknowur_draft_${state.partyId}_${state.playerId}`;
  localStorage.removeItem(key);
}

function getPredictionLocalStore() {
  const key = `iknowur_local_pred_${state.partyId}_${state.playerId}`;
  const raw = localStorage.getItem(key);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function setPredictionLocalStore(value) {
  const key = `iknowur_local_pred_${state.partyId}_${state.playerId}`;
  localStorage.setItem(key, JSON.stringify(value));
}

function randomSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toBase64(bytes);
}

async function hashCommit(text, salt) {
  const content = `${text}::${salt}`;
  const buf = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function encryptPrediction(text) {
  const key = await getOrCreatePartyKey();
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const plaintext = new TextEncoder().encode(text);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);

  return {
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    iv: toBase64(iv),
  };
}

async function getOrCreatePartyKey() {
  const storageKey = `iknowur_party_key_${state.partyId}_${state.playerId}`;
  let rawBase64 = localStorage.getItem(storageKey);

  if (!rawBase64) {
    const keyBytes = new Uint8Array(32);
    crypto.getRandomValues(keyBytes);
    rawBase64 = toBase64(keyBytes);
    localStorage.setItem(storageKey, rawBase64);
  }

  const raw = fromBase64(rawBase64);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt"]);
}

function toBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function fromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
