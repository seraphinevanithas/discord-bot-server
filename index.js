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
// EXPORT → ZIP (LIGHTWEIGHT + STABLE)
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

    // ===============================
    // FETCH MESSAGES
    // ===============================
    let messages = [];
    let lastId = null;

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

    const sorted = filtered.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

// ===============================
// BUILD RAW JSON (FOR EVIDENCE)
// ===============================
const rawData = sorted.map(msg => ({
  id: msg.id,
  timestamp: msg.createdTimestamp,
  author: {
    id: msg.author?.id || null,
    username: msg.author?.username || "Unknown"
  },
  content: msg.cleanContent || msg.content || "",
  attachments: msg.attachments
    ? Array.from(msg.attachments.values()).map(att => ({
        name: att.name,
        url: att.url,
        type: att.contentType || null
      }))
    : []
}));
    
    // ===============================
    // SPLIT INTO CHUNKS
    // ===============================
    const chunkSize = 300;
    const chunks = [];
    for (let i = 0; i < sorted.length; i += chunkSize) {
      chunks.push(sorted.slice(i, i + chunkSize));
    }

    // ===============================
    // SET ZIP HEADERS
    // ===============================
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="LOG_CHATS_${clientName || "export"}.zip"`
    );

    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("error", err => {
      console.error("ARCHIVE ERROR:", err);
      res.status(500).end();
    });

    archive.pipe(res);

    // ===============================
    // GENERATE PDF PER CHUNK
    // ===============================
    for (let i = 0; i < chunks.length; i++) {
      const doc = new PDFDocument({ margin: 20 });
      let buffers = [];

      doc.on("data", d => buffers.push(d));

      const chunk = chunks[i];

      const processed = chunk.map(msg => ({
        msg,
        username: (msg.author?.username || "Unknown").slice(0, 15)
      }));

      const maxUserLength = Math.max(...processed.map(p => p.username.length), 5);

      const charWidth = 5.5;
      const sampleTime = "[88/88/88, 88:88 PM]";
      const timeWidth = sampleTime.length * charWidth;
      const userWidth = maxUserLength * charWidth;
      const gap = charWidth * 3;

      const timeX = 20;
      const userX = timeX + timeWidth + gap;
      const msgX = userX + userWidth + gap;

      // HEADER
      doc.font("Helvetica-Bold").fontSize(11)
        .text(`Chat Export - Part ${i + 1}`, { underline: true });

      doc.moveDown(0.8);

      // ===============================
      // RENDER MESSAGES (LIGHTWEIGHT)
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

        // ===============================
        // CLEAN CONTENT
        // ===============================
        let content = msg.cleanContent || msg.content || "";

        content = content.replace(/[\u0000-\u001F\u007F]/g, ""); // remove control chars
        content = content.replace(/<a?:\w+:\d+>/g, ""); // remove emojis

        const y = doc.y;

        doc.font("Helvetica").fontSize(8).text(`[${time}]`, timeX, y);
        doc.font("Helvetica-Bold").fontSize(9).text(username.padEnd(maxUserLength, " "), userX, y);
        doc.font("Helvetica").fontSize(9).text(`: ${content}`, msgX, y, { width: 300 });

        doc.moveDown(0.4);

        // ===============================
        // ATTACHMENTS → CLICKABLE URL
        // ===============================
        if (msg.attachments?.size > 0) {
          for (const att of msg.attachments.values()) {

            const url = att.url;

            doc
              .fillColor("blue")
              .fontSize(8)
              .text(`🔗 ${url}`, msgX, doc.y, {
                link: url,
                underline: true
              });

            doc.fillColor("black");
            doc.moveDown(0.4);
          }
        }
      }

      doc.end();

      const pdfData = await new Promise((resolve, reject) => {
        doc.on("end", () => resolve(Buffer.concat(buffers)));
        doc.on("error", reject);
      });

      archive.append(pdfData, { name: `part_${i + 1}.pdf` });
    }

// ===============================
// ADD RAW JSON TO ZIP
// ===============================
archive.append(
  Buffer.from(JSON.stringify(rawData, null, 2)),
  { name: `RAW_${clientName || "export"}.json` }
);
    
    // ===============================
    // FINALIZE ZIP
    // ===============================
    await archive.finalize();

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
