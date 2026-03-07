import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Block {
  id: string;
  pos: [number, number, number];
  type: string;
}

interface Game {
  id: string;
  name: string;
  blocks: Block[];
  scripts: string;
  creator: string;
  lastModified: number;
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

const PORT = 3000;

// In-memory store for public games
let publicGames: Game[] = [
  {
    id: 'starter-world',
    name: 'Official Starter World',
    blocks: [
      { id: 'b1', pos: [0, 0, 0], type: 'grass' },
      { id: 'b2', pos: [1, 0, 0], type: 'grass' },
      { id: 'b3', pos: [-1, 0, 0], type: 'grass' },
      { id: 'b4', pos: [0, 0, 1], type: 'grass' },
      { id: 'b5', pos: [0, 0, -1], type: 'grass' },
      { id: 'b6', pos: [0, 1, 0], type: 'stone' },
      { id: 'b7', pos: [1, 1, 0], type: 'stone' },
      { id: 'b8', pos: [-1, 1, 0], type: 'stone' },
      { id: 'b9', pos: [0, 2, 0], type: 'glass' },
    ],
    scripts: '// Welcome to BloxCraft Studio!\n// You can write game settings here.',
    creator: 'System',
    lastModified: Date.now()
  }
];

app.use(express.json());

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", env: process.env.NODE_ENV });
});

// API Routes
app.get("/api/games", (req, res) => {
  res.json(publicGames);
});

app.post("/api/games/publish", (req, res) => {
  const game = req.body;
  const existingIndex = publicGames.findIndex(g => g.id === game.id);
  if (existingIndex >= 0) {
    publicGames[existingIndex] = { ...game, lastModified: Date.now() };
  } else {
    publicGames.push({ ...game, lastModified: Date.now() });
  }
  res.json({ success: true });
});

// Socket.io for real-time collaboration
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-game", (gameId) => {
    socket.join(gameId);
    console.log(`User ${socket.id} joined game ${gameId}`);
    
    // Send current state of the game if it's a public one
    const game = publicGames.find(g => g.id === gameId);
    if (game) {
      socket.emit("game-state", game.blocks);
    }
  });

  socket.on("block-added", ({ gameId, block }) => {
    // Update server state if it's a public game
    const game = publicGames.find(g => g.id === gameId);
    if (game) {
      game.blocks.push(block);
    }
    socket.to(gameId).emit("block-added", block);
  });

  socket.on("block-removed", ({ gameId, blockId }) => {
    const game = publicGames.find(g => g.id === gameId);
    if (game) {
      game.blocks = game.blocks.filter(b => b.id !== blockId);
    }
    socket.to(gameId).emit("block-removed", blockId);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

async function startServer() {
  console.log("Starting server in", process.env.NODE_ENV || "development", "mode");
  try {
    if (process.env.NODE_ENV !== "production") {
      console.log("Initializing Vite middleware...");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      console.log("Vite middleware initialized.");
    } else {
      console.log("Serving static files from dist...");
      app.use(express.static(path.join(__dirname, "dist")));
      app.get("*", (req, res) => {
        res.sendFile(path.join(__dirname, "dist", "index.html"));
      });
    }

    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
  }
}

startServer();
