require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Client, GatewayIntentBits } = require("discord.js");
const PDFDocument = require("pdfkit");
const archiver = require("archiver");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

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

client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error("DISCORD LOGIN ERROR:", err);
});

client.once("clientReady", () => {
  console.log("=================================");
  console.log("BOT LOGIN SUCCESS");
  console.log("Bot tag:", client.user.tag);
  console.log("Bot ID:", client.user.id);
  console.log("=================================");
});

// ===============================
// EXPORT → ZIP (MULTI PDF SAFE)
// ===============================
app.post("/export", async (req, res) => {
  try {
    const { channelId, from, to, clientName } = req.body;

    if (!channelId) {
      return res.status(400).json({ error: "Missing channelId" });
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);

    if (!channel || !channel.messages) {
      return res.status(400).json({ error: "Channel not accessible" });
    }

    let messages = [];
    let lastId = null;

    // Fetch messages (~2000 max)
    for (let i = 0; i < 20; i++) {
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
      return (!from || t >= fromDate) && (!to || t <= toDate);
    });

    // ===============================
    // SPLIT INTO CHUNKS
    // ===============================
    const chunkSize = 300;
    const chunks = [];

    const sorted = filtered.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    for (let i = 0; i < sorted.length; i += chunkSize) {
    chunks.push(sorted.slice(i, i + chunkSize));
    }
    
    // ===============================
    // PREPARE ZIP
    // ===============================
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="LOG_CHATS_${clientName || "export"}.zip"`
    );

    const archive = archiver("zip");
    archive.pipe(res);

// ===============================
// RENDER (ASYNC ENABLED)
// ===============================
for (const { msg, username } of processed) {

  const d = new Date(msg.createdTimestamp);

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear()).slice(-2);

  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");

  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;

  const time = `${day}/${month}/${year}, ${hours}:${minutes} ${ampm}`;

  let content = msg.cleanContent || msg.content || "";

  // remove bad characters (keep emoji safe)
  content = content.replace(/[\u0000-\u001F\u007F]/g, "");

  // discord emoji fallback
  content = content.replace(/<a?:\w+:\d+>/g, "[emoji]");

  // links
  content = content.replace(/(https?:\/\/[^\s]+)/g, "$1");

  const y = doc.y;

  // TIME
  doc.font("Helvetica")
    .fontSize(8)
    .text(`[${time}]`, timeX, y);

  // USERNAME
  doc.font("Helvetica-Bold")
    .fontSize(9)
    .text(username.padEnd(maxUserLength, " "), userX, y);

  // MESSAGE
  doc.font("Helvetica")
    .fontSize(9)
    .text(`: ${content}`, msgX, y, {
      width: 300
    });

  doc.moveDown(0.4);

  // ===============================
  // 🖼️ ATTACHMENTS (IMAGE PREVIEW)
  // ===============================
  if (msg.attachments && msg.attachments.size > 0) {
    for (const att of msg.attachments.values()) {
      try {
        if (att.contentType && att.contentType.startsWith("image")) {
          const res = await fetch(att.url);
          const arr = await res.arrayBuffer();
          const buf = Buffer.from(arr);

          doc.image(buf, {
            fit: [400, 400]
          });

          doc.moveDown(0.5);
        } else {
          doc.fontSize(8).text(`📎 ${att.name}`);
          doc.moveDown(0.3);
        }
      } catch {
        doc.text("[image failed]");
      }
    }
  }

  // ===============================
  // 🌐 EMBEDS (YOUTUBE / LINKS)
  // ===============================
  if (msg.embeds && msg.embeds.length > 0) {
    for (const embed of msg.embeds) {

      if (embed.thumbnail?.url) {
        try {
          const res = await fetch(embed.thumbnail.url);
          const arr = await res.arrayBuffer();
          const buf = Buffer.from(arr);

          doc.image(buf, {
            fit: [400, 300]
          });

          doc.moveDown(0.5);
        } catch {
          doc.text("[preview failed]");
        }
      }

      if (embed.url) {
        doc.fontSize(8).text(`🔗 ${embed.url}`);
        doc.moveDown(0.3);
      }
    }
  }
}

// ===============================
// CLONE CHANNEL
// ===============================
app.post("/clone", async (req, res) => {
  try {
    const { channelId } = req.body;

    if (!channelId) {
      return res.status(400).json({ error: "Missing channelId" });
    }

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
app.get("/", (req, res) => {
  res.send("Server is running");
});

// ===============================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// DEBUG
console.log("TOKEN:", process.env.DISCORD_TOKEN ? "Loaded" : "Missing");
