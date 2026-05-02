require("dotenv").config();

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

// Login safely
client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error("DISCORD LOGIN ERROR:", err);
});

// Ready event
  client.once("clientReady", () => {
  console.log("=================================");
  console.log("BOT LOGIN SUCCESS");
  console.log("Bot tag:", client.user.tag);
  console.log("Bot ID:", client.user.id);
  console.log("=================================");
});

// ===============================
// EXPORT → PDF
// ===============================
const archiver = require("archiver");

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

    // Fetch messages (max ~2000)
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
    // SPLIT INTO SAFE CHUNKS
    // ===============================
    const chunkSize = 300;
    const chunks = [];

    for (let i = 0; i < filtered.length; i += chunkSize) {
      chunks.push(filtered.slice(i, i + chunkSize));
    }

    // ===============================
    // ZIP RESPONSE
    // ===============================
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="LOG_CHATS_${clientName || "export"}.zip"`
    );

    const archive = archiver("zip");
    archive.pipe(res);

    // ===============================
    // GENERATE MULTIPLE PDFs
    // ===============================
    for (let i = 0; i < chunks.length; i++) {
      const doc = new PDFDocument({ margin: 20 });

      let buffers = [];

      doc.on("data", (chunk) => buffers.push(chunk));

      doc.on("end", () => {
        const pdfData = Buffer.concat(buffers);

        archive.append(pdfData, {
          name: `part_${i + 1}.pdf`
        });
      });

      doc.fontSize(14).text(`Chat Export - Part ${i + 1}`, { underline: true });
      doc.moveDown();

      chunks[i].reverse().forEach((msg) => {
        const time = new Date(msg.createdTimestamp).toLocaleString();

        let content = msg.content || "";

        // emoji
        content = content.replace(/<a?:\w+:\d+>/g, "[emoji]");

        // links
        content = content.replace(/(https?:\/\/[^\s]+)/g, "$1");

        // attachments
        if (msg.attachments && msg.attachments.size > 0) {
          msg.attachments.forEach((att) => {
            content += `\n📎 ${att.name || "file"}`;
          });
        }

        doc.text(`[${time}] ${msg.author?.username || "Unknown"}: ${content}`);
        doc.moveDown(0.4);
      });

      doc.end();
    }

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

    console.log("CLONE REQUEST:", channelId);

    if (!channelId) {
      return res.status(400).json({ error: "Missing channelId" });
    }

    const oldChannel = await client.channels.fetch(channelId).catch(err => {
      console.log("Fetch error:", err);
      return null;
    });

    if (!oldChannel) {
      console.log("Channel fetch failed:", channelId);
      return res.status(400).json({ error: "Channel not found" });
    }

    console.log("Channel found:", oldChannel.name);

    const newChannel = await oldChannel.clone();
    await oldChannel.delete();

    console.log("Channel cloned:", newChannel.id);

    res.json({ newChannelId: newChannel.id });

  } catch (err) {
    console.error("CLONE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// HEALTH CHECK (VERY IMPORTANT)
// ===============================
app.get("/", (req, res) => {
  res.send("Server is running");
});

// ===============================
// START SERVER
// ===============================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// DEBUG
console.log("TOKEN:", process.env.DISCORD_TOKEN ? "Loaded" : "Missing");
