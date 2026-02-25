let app;

try {
  app = require("../app");
} catch (err) {
  console.error("server bootstrap failed:", err);
  app = (_req, res) => {
    res.status(500).json({
      error: "server bootstrap failed",
    });
  };
}

module.exports = app;
