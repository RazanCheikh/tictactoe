const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const rooms = {}; // store room state

// ✅ Function to check winner dynamically for any grid size
function checkWinner(cells, playerImg, size) {
  const lines = [];

  // rows
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) row.push(r * size + c);
    lines.push(row);
  }

  // columns
  for (let c = 0; c < size; c++) {
    const col = [];
    for (let r = 0; r < size; r++) col.push(r * size + c);
    lines.push(col);
  }

  // diagonals
  const diag1 = [];
  const diag2 = [];
  for (let i = 0; i < size; i++) {
    diag1.push(i * size + i);
    diag2.push(i * size + (size - 1 - i));
  }
  lines.push(diag1, diag2);

  // check all lines
  return lines.some((line) => line.every((idx) => cells[idx] === playerImg));
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // =====================
  // Create Room
  // =====================
  socket.on("createRoom", ({ playerImg, gridSize, pair }, callback) => {
    const roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    rooms[roomCode] = {
      gridSize,
      pair,
      cells: Array(gridSize * gridSize).fill(null),
      players: [{ id: socket.id, playerImg, moves: [] }], // ✅ track moves per player
      turn: 0,
    };

    socket.join(roomCode);
    console.log(`Room ${roomCode} created by ${socket.id}`);

    // Notify waiting
    socket.emit("waiting", { message: "Waiting for opponent to join..." });

    callback({ roomCode, playerId: socket.id });
  });

  // =====================
  // Join Room
  // =====================
  socket.on("joinRoom", ({ roomCode }, callback) => {
    const room = rooms[roomCode];
    if (!room) return callback({ error: "Room not found" });
    if (room.players.length >= 2) return callback({ error: "Room full" });

    const creatorImg = room.players[0].playerImg;
    const assignedImg = room.pair.find((img) => img !== creatorImg);

    room.players.push({ id: socket.id, playerImg: assignedImg, moves: [] });
    socket.join(roomCode);

    console.log(`Player ${socket.id} joined room ${roomCode}`);

    // Broadcast game start to both players
    io.to(roomCode).emit("startGame", {
      gridSize: room.gridSize,
      players: room.players.map((p) => ({ id: p.id, playerImg: p.playerImg })),
      cells: room.cells,
      turn: room.turn,
    });

    callback({
      success: true,
      playerImg: assignedImg,
      playerId: socket.id,
      gridSize: room.gridSize,
    });
  });

  // =====================
  // Make Move
  // =====================
  socket.on("makeMove", ({ roomCode, index }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const size = room.gridSize;
    const playerIndex = room.players.findIndex((p) => p.id === socket.id);
    if (playerIndex !== room.turn) return; // not your turn
    if (room.cells[index] && room.cells[index] !== room.players[playerIndex].playerImg) return;

    const player = room.players[playerIndex];
    const otherPlayer = room.players[(playerIndex + 1) % 2];

    // ✅ add move
    player.moves.push(index);
    room.cells[index] = player.playerImg;

    // ✅ limit moves per player (e.g., gridSize = 3 → 3 moves max)
    if (player.moves.length > size) {
      const oldest = player.moves.shift();
      room.cells[oldest] = null;
    }

    // ✅ check winner
    if (checkWinner(room.cells, player.playerImg, size)) {
      io.to(roomCode).emit("gameOver", { winner: player.playerImg });
      return;
    }

    // ✅ check draw
    if (room.cells.every((c) => c !== null)) {
      io.to(roomCode).emit("gameOver", { winner: "Draw" });
      return;
    }

    // ✅ switch turns
    room.turn = (room.turn + 1) % 2;

    // ✅ broadcast update
    io.to(roomCode).emit("update", {
      cells: room.cells,
      turn: room.turn,
      players: room.players.map((p) => ({ id: p.id, playerImg: p.playerImg })),
    });
  });

  // =====================
  // Disconnect
  // =====================
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

server.listen(3000, () => console.log("Server running on port 3000"));
