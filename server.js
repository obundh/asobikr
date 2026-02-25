const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(PUBLIC_DIR));

const store = loadStore();

function loadStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    const initial = { parties: {} };
    fs.writeFileSync(STORE_FILE, JSON.stringify(initial, null, 2), "utf8");
    return initial;
  }

  try {
    const raw = fs.readFileSync(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed.parties || typeof parsed.parties !== "object") {
      return { parties: {} };
    }
    return parsed;
  } catch (err) {
    console.error("store load failed:", err);
    return { parties: {} };
  }
}

function saveStore() {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

function now() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function createPartyCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (Object.values(store.parties).some((party) => party.code === code));
  return code;
}

function hashCommit(text, salt) {
  return crypto.createHash("sha256").update(`${text}::${salt}`, "utf8").digest("hex");
}

function getPartyByCode(code) {
  return Object.values(store.parties).find((party) => party.code === String(code || "").toUpperCase());
}

function requireMember(party, playerId) {
  return party.members.find((member) => member.id === playerId);
}

function updateStage(party) {
  if (party.stage !== "collecting") {
    return;
  }

  if (party.members.length < 2) {
    return;
  }

  const allSubmitted = party.members.every((member) => Boolean(party.submittedBy[member.id]));
  if (allSubmitted) {
    party.stage = "active";
    party.activatedAt = now();
  }
}

function calculateVoteSummary(claim) {
  let yes = 0;
  let no = 0;
  for (const vote of claim.votes) {
    if (vote.vote === "yes") {
      yes += 1;
    } else if (vote.vote === "no") {
      no += 1;
    }
  }
  return { yes, no };
}

function maybeFinalizeClaim(party, claim) {
  if (claim.status !== "open") {
    return;
  }

  const prediction = party.predictions.find((item) => item.id === claim.predictionId);
  if (!prediction) {
    return;
  }

  const { yes, no } = calculateVoteSummary(claim);
  claim.yesVotes = yes;
  claim.noVotes = no;

  const eligibleVoters = party.members.length - 1;
  const majority = Math.floor(eligibleVoters / 2) + 1;

  if (yes >= majority) {
    claim.status = "approved";
    claim.resolvedAt = now();
    prediction.claimStatus = "scored";
    party.scores[claim.claimantId] = (party.scores[claim.claimantId] || 0) + 1;
    return;
  }

  const allVoted = claim.votes.length >= eligibleVoters;
  if (no >= majority || allVoted) {
    claim.status = "rejected";
    claim.resolvedAt = now();
    prediction.claimStatus = "rejected";
    party.scores[claim.claimantId] = (party.scores[claim.claimantId] || 0) - 1;
  }
}

function sanitizePartyForViewer(party, viewerId) {
  const memberById = Object.fromEntries(party.members.map((member) => [member.id, member]));

  const predictions = party.predictions.map((prediction) => {
    const base = {
      id: prediction.id,
      authorId: prediction.authorId,
      authorName: memberById[prediction.authorId]?.name || "Unknown",
      targetId: prediction.targetId,
      targetName: memberById[prediction.targetId]?.name || "Unknown",
      claimStatus: prediction.claimStatus,
      createdAt: prediction.createdAt,
    };

    if (prediction.authorId === viewerId) {
      return {
        ...base,
        ciphertext: prediction.ciphertext,
        iv: prediction.iv,
        algorithm: prediction.algorithm,
        commitHash: prediction.commitHash,
      };
    }

    return base;
  });

  const claims = party.claims.map((claim) => {
    const prediction = party.predictions.find((item) => item.id === claim.predictionId);
    return {
      id: claim.id,
      predictionId: claim.predictionId,
      predictionTargetId: prediction?.targetId,
      predictionTargetName: prediction ? (memberById[prediction.targetId]?.name || "Unknown") : "Unknown",
      claimantId: claim.claimantId,
      claimantName: memberById[claim.claimantId]?.name || "Unknown",
      status: claim.status,
      revealedText: claim.revealedText,
      yesVotes: claim.yesVotes || 0,
      noVotes: claim.noVotes || 0,
      votes: claim.votes.map((vote) => ({
        voterId: vote.voterId,
        voterName: memberById[vote.voterId]?.name || "Unknown",
        vote: vote.vote,
      })),
      createdAt: claim.createdAt,
      resolvedAt: claim.resolvedAt || null,
    };
  });

  const members = party.members.map((member) => ({
    id: member.id,
    name: member.name,
    joinedAt: member.joinedAt,
    submittedPredictions: Boolean(party.submittedBy[member.id]),
    score: party.scores[member.id] || 0,
  }));

  return {
    id: party.id,
    code: party.code,
    stage: party.stage,
    createdAt: party.createdAt,
    activatedAt: party.activatedAt || null,
    predictionLimit: 5,
    members,
    predictions,
    claims,
  };
}

function emitPartyChanged(partyId) {
  io.to(`party:${partyId}`).emit("partyChanged", { partyId, at: now() });
}

app.post("/api/parties", (req, res) => {
  const { playerId, name } = req.body || {};

  if (!playerId || !name || String(name).trim().length < 1) {
    return res.status(400).json({ error: "playerId and name are required" });
  }

  const cleanName = String(name).trim().slice(0, 24);
  const partyId = createId("party");
  const party = {
    id: partyId,
    code: createPartyCode(),
    createdAt: now(),
    stage: "collecting",
    activatedAt: null,
    members: [{ id: playerId, name: cleanName, joinedAt: now() }],
    submittedBy: {},
    predictions: [],
    claims: [],
    scores: { [playerId]: 0 },
  };

  store.parties[partyId] = party;
  saveStore();

  return res.status(201).json({
    party: sanitizePartyForViewer(party, playerId),
    playerId,
  });
});

app.post("/api/parties/join", (req, res) => {
  const { partyCode, playerId, name } = req.body || {};
  if (!partyCode || !playerId || !name) {
    return res.status(400).json({ error: "partyCode, playerId, name are required" });
  }

  const party = getPartyByCode(partyCode);
  if (!party) {
    return res.status(404).json({ error: "party not found" });
  }

  if (party.stage !== "collecting") {
    return res.status(400).json({ error: "party already active. joining is locked" });
  }

  const cleanName = String(name).trim().slice(0, 24);
  let member = requireMember(party, playerId);
  if (!member) {
    member = { id: playerId, name: cleanName, joinedAt: now() };
    party.members.push(member);
    party.scores[playerId] = party.scores[playerId] || 0;
  } else {
    member.name = cleanName;
  }

  saveStore();
  emitPartyChanged(party.id);

  return res.json({
    party: sanitizePartyForViewer(party, playerId),
    playerId,
  });
});

app.get("/api/parties/:partyId", (req, res) => {
  const { partyId } = req.params;
  const playerId = String(req.query.playerId || "");

  const party = store.parties[partyId];
  if (!party) {
    return res.status(404).json({ error: "party not found" });
  }

  if (!playerId || !requireMember(party, playerId)) {
    return res.status(403).json({ error: "only party members can access this party" });
  }

  return res.json({
    party: sanitizePartyForViewer(party, playerId),
    playerId,
  });
});

app.post("/api/parties/:partyId/predictions/submit", (req, res) => {
  const { partyId } = req.params;
  const { playerId, predictions } = req.body || {};

  const party = store.parties[partyId];
  if (!party) {
    return res.status(404).json({ error: "party not found" });
  }

  if (party.stage !== "collecting") {
    return res.status(400).json({ error: "prediction submission is closed" });
  }

  const member = requireMember(party, playerId);
  if (!member) {
    return res.status(403).json({ error: "only party members can submit predictions" });
  }

  if (party.submittedBy[playerId]) {
    return res.status(400).json({ error: "already submitted" });
  }

  if (!Array.isArray(predictions) || predictions.length !== 5) {
    return res.status(400).json({ error: "exactly 5 predictions are required" });
  }

  const createdPredictions = [];
  for (const item of predictions) {
    const { targetId, ciphertext, iv, commitHash, algorithm } = item || {};

    if (!targetId || !ciphertext || !iv || !commitHash) {
      return res.status(400).json({ error: "targetId, ciphertext, iv, commitHash are required" });
    }

    if (!requireMember(party, targetId)) {
      return res.status(400).json({ error: `invalid targetId: ${targetId}` });
    }

    if (targetId === playerId) {
      return res.status(400).json({ error: "self-target prediction is not allowed" });
    }

    if (!/^[a-f0-9]{64}$/i.test(String(commitHash))) {
      return res.status(400).json({ error: "commitHash must be 64-char sha256 hex" });
    }

    const prediction = {
      id: createId("pred"),
      authorId: playerId,
      targetId,
      ciphertext,
      iv,
      algorithm: algorithm || "AES-GCM",
      commitHash: String(commitHash).toLowerCase(),
      claimStatus: "available",
      createdAt: now(),
    };

    createdPredictions.push(prediction);
  }

  party.predictions.push(...createdPredictions);
  party.submittedBy[playerId] = true;
  updateStage(party);

  saveStore();
  emitPartyChanged(party.id);

  return res.status(201).json({
    predictionRefs: createdPredictions.map((prediction) => ({
      id: prediction.id,
      targetId: prediction.targetId,
    })),
    party: sanitizePartyForViewer(party, playerId),
  });
});

app.post("/api/parties/:partyId/claims", (req, res) => {
  const { partyId } = req.params;
  const { playerId, predictionId, revealedText, salt } = req.body || {};

  const party = store.parties[partyId];
  if (!party) {
    return res.status(404).json({ error: "party not found" });
  }

  if (party.stage !== "active") {
    return res.status(400).json({ error: "party is not active yet" });
  }

  if (!requireMember(party, playerId)) {
    return res.status(403).json({ error: "only party members can create claims" });
  }

  const prediction = party.predictions.find((item) => item.id === predictionId);
  if (!prediction) {
    return res.status(404).json({ error: "prediction not found" });
  }

  if (prediction.authorId !== playerId) {
    return res.status(403).json({ error: "only prediction author can claim" });
  }

  if (prediction.claimStatus !== "available") {
    return res.status(400).json({ error: "prediction already used" });
  }

  if (!revealedText || !salt) {
    return res.status(400).json({ error: "revealedText and salt are required" });
  }

  const computedCommit = hashCommit(String(revealedText), String(salt));
  if (computedCommit !== prediction.commitHash) {
    return res.status(400).json({ error: "commit verification failed" });
  }

  const claim = {
    id: createId("claim"),
    predictionId: prediction.id,
    claimantId: playerId,
    revealedText: String(revealedText).trim(),
    salt: String(salt),
    verified: true,
    status: "open",
    votes: [],
    yesVotes: 0,
    noVotes: 0,
    createdAt: now(),
    resolvedAt: null,
  };

  party.claims.push(claim);
  prediction.claimStatus = "pending";

  saveStore();
  emitPartyChanged(party.id);

  return res.status(201).json({
    claimId: claim.id,
    party: sanitizePartyForViewer(party, playerId),
  });
});

app.post("/api/parties/:partyId/claims/:claimId/votes", (req, res) => {
  const { partyId, claimId } = req.params;
  const { playerId, vote } = req.body || {};

  const party = store.parties[partyId];
  if (!party) {
    return res.status(404).json({ error: "party not found" });
  }

  if (!requireMember(party, playerId)) {
    return res.status(403).json({ error: "only party members can vote" });
  }

  const claim = party.claims.find((item) => item.id === claimId);
  if (!claim) {
    return res.status(404).json({ error: "claim not found" });
  }

  if (claim.status !== "open") {
    return res.status(400).json({ error: "claim is already finalized" });
  }

  if (claim.claimantId === playerId) {
    return res.status(400).json({ error: "claimant cannot vote on their own claim" });
  }

  if (vote !== "yes" && vote !== "no") {
    return res.status(400).json({ error: "vote must be yes or no" });
  }

  const alreadyVoted = claim.votes.some((item) => item.voterId === playerId);
  if (alreadyVoted) {
    return res.status(400).json({ error: "already voted" });
  }

  claim.votes.push({ voterId: playerId, vote, votedAt: now() });
  maybeFinalizeClaim(party, claim);

  saveStore();
  emitPartyChanged(party.id);

  return res.json({
    status: claim.status,
    yesVotes: claim.yesVotes,
    noVotes: claim.noVotes,
    party: sanitizePartyForViewer(party, playerId),
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, at: now() });
});

io.on("connection", (socket) => {
  socket.on("joinParty", ({ partyId } = {}) => {
    if (!partyId || !store.parties[partyId]) {
      return;
    }
    socket.join(`party:${partyId}`);
  });
});

app.get("/iknowur", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "iknowur", "index.html"));
});

app.get("/gussmymbti", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "gussmymbti", "index.html"));
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

server.listen(PORT, () => {
  console.log(`iknowur MVP listening on http://localhost:${PORT}`);
});
