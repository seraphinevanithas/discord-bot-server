require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Client, GatewayIntentBits } = require("discord.js");
const PDFDocument = require("pdfkit");
const archiver = require("archiver");

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
// GENERATE PDFs PROPERLY (ENHANCED)
// ===============================
const pdfPromises = chunks.map((chunk, index) => {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 20 });

    let buffers = [];
    doc.on("data", (d) => buffers.push(d));

    doc.on("end", () => {
      const pdfData = Buffer.concat(buffers);

      resolve({
        name: `part_${index + 1}.pdf`,
        data: pdfData
      });
    });

    // ===============================
    // HEADER
    // ===============================
    doc.font("Courier-Bold").fontSize(11)
      .text(`Chat Export - Part ${index + 1}`, { underline: true });

    doc.moveDown(0.8);

    // ===============================
    // PREPROCESS (for dynamic width)
    // ===============================
    const processed = chunk
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map(msg => {
        let username = (msg.author?.username || "Unknown").slice(0, 15);
        return {
          msg,
          username
        };
      });

    // detect longest username
    const maxUserLength = Math.max(
      ...processed.map(p => p.username.length),
      5
    );

    // dynamic spacing (monospace friendly)
    const charWidth = 6; // Courier approx width
    const timeWidth = 130;
    const userWidth = maxUserLength * charWidth + 10;

    const startX = 20;
    const timeX = startX;
    const userX = timeX + timeWidth;
    const msgX = userX + userWidth + 10;

    // ===============================
    // RENDER
    // ===============================
    processed.forEach(({ msg, username }) => {
      const time = new Date(msg.createdTimestamp).toLocaleString();

      let content = msg.content || "";

      content = content.replace(/<a?:\w+:\d+>/g, "[emoji]");
      content = content.replace(/(https?:\/\/[^\s]+)/g, "$1");

      if (msg.attachments && msg.attachments.size > 0) {
        msg.attachments.forEach((att) => {
          content += `\n📎 ${att.name || "file"}`;
        });
      }

      const y = doc.y;

      // TIME (monospace)
      doc.font("Courier")
        .fontSize(8)
        .text(`[${time}]`, timeX, y);

      // USERNAME (BOLD)
      doc.font("Courier-Bold")
        .fontSize(9)
        .text(username.padEnd(maxUserLength, " "), userX, y);

      // MESSAGE
      doc.font("Courier")
        .fontSize(9)
        .text(`: ${content}`, msgX, y, {
          width: 320
        });

      // spacing (clean + compact)
      doc.moveDown(0.4);
    });

    doc.end();
  });
});
    
// ===============================
// WAIT ALL PDFs
// ===============================
const pdfFiles = await Promise.all(pdfPromises);

// ADD FILES TO ZIP
pdfFiles.forEach((file) => {
  archive.append(file.data, { name: file.name });
});

// FINALIZE ZIP (VERY IMPORTANT)
archive.finalize();

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
