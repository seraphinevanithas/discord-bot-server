require("dotenv").config({ path: __dirname + "/.env" });

const express = require("express");
const cors = require("cors");
const { Client, GatewayIntentBits } = require("discord.js");
const PDFDocument = require("pdfkit");

const app = express();
app.use(cors());
app.use(express.json());

// ===============================
// DISCORD CLIENT
// ===============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.login(process.env.DISCORD_TOKEN);

// ✅ FIXED EVENT
client.once("ready", () => {
  console.log(`Bot logged in as ${client.user.tag}`);
});

// ===============================
// EXPORT → PDF (STREAM RESPONSE)
// ===============================
app.post("/export", async (req, res) => {
  try {
    const { channelId, from, to, clientName } = req.body;

    console.log("EXPORT REQUEST:", req.body);

    const channel = await client.channels.fetch(channelId).catch(() => null);

    if (!channel) {
      return res.status(400).json({ error: "Channel not found" });
    }

    let messages = [];
    let lastId = null;

    // ===============================
    // FETCH MESSAGES (SAFE LOOP)
    // ===============================
    while (true) {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;

      const fetched = await channel.messages.fetch(options);

      if (!fetched || fetched.size === 0) break;

      messages.push(...fetched.values());
      lastId = fetched.last().id;

      if (fetched.size < 100) break;
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);

    const filtered = messages.filter(msg => {
      const t = new Date(msg.createdTimestamp);
      return t >= fromDate && t <= toDate;
    });

    // ===============================
    // PDF STREAM
    // ===============================
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="LOG_CHATS_${clientName || "export"}.pdf"`
    );

    const doc = new PDFDocument();
    doc.pipe(res);

    // Header
    doc.fontSize(16).text(`Chat Export: ${clientName || "Unknown"}`, {
      underline: true
    });

    doc.moveDown();

    // Messages
    filtered.reverse().forEach(msg => {
  const time = new Date(msg.createdTimestamp).toLocaleString();

  let content = msg.content || "";

  // emoji cleanup
  content = content.replace(/<a?:\w+:\d+>/g, "[emoji]");

  // highlight links
  content = content.replace(/(https?:\/\/[^\s]+)/g, "🔗 $1");

  doc
    .fontSize(10)
    .text(`[${time}] ${msg.author.username}: ${content}`);

  doc.moveDown(0.3);
});

    doc.end();

  } catch (err) {
    console.error("EXPORT ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// CLONE CHANNEL
// ===============================
app.post("/clone", async (req, res) => {
  try {
    const { channelId } = req.body;

    const oldChannel = await client.channels.fetch(channelId).catch(() => null);

    if (!oldChannel) {
      return res.status(400).json({ error: "Channel not found" });
    }

    const newChannel = await oldChannel.clone();

    await oldChannel.delete();

    res.json({ newChannelId: newChannel.id });

  } catch (err) {
    console.error("CLONE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// START SERVER
// ===============================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// DEBUG
console.log("TOKEN:", process.env.DISCORD_TOKEN ? "Loaded" : "Missing");
console.log("PORT:", PORT);